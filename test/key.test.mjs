/**
 * Host-route checks for dsh-plugin-jev: the status/key/model/ask/transcript
 * routes must back both the Settings tab and the dock console — reading the
 * "typesafe" credential first, writing it on POST, removing on DELETE, and
 * calling the TypeSafe API with it while never returning the literal.
 *
 * Drives the exported apply() with a fake ctx and a captured webServer, then
 * invokes the handlers directly with fake req/res objects.
 *
 * Usage: node test/key.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, TYPESAFE_CREDENTIAL_REF, DEFAULT_COST_PER_TOKEN } from '../lib/index.js'
import { JevStore } from '../lib/store.js'

let failures = 0
async function check(label, fn) {
  try { await fn(); console.log('  ok   ' + label) }
  catch (error) { failures += 1; console.log('  FAIL ' + label + '\n       ' + (error.stack ?? error.message)) }
}

function makeRes() {
  let status = 0
  let body = null
  return {
    res: {
      writeHead(code) { status = code },
      end(text) { body = typeof text === 'string' ? text : '' },
    },
    get status() { return status },
    get body() { return body === null ? null : JSON.parse(body) },
  }
}

function makeReq(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method: method || 'GET',
    url: url || '/',
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}

function responseFor(status, payload, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (name) => (headers && Object.prototype.hasOwnProperty.call(headers, name) ? headers[name] : null) },
    async text() { return typeof payload === 'string' ? payload : JSON.stringify(payload) },
  }
}

function makeHarness(options = {}) {
  const stored = Object.assign({}, options.stored)
  const calls = { set: [], unset: [] }
  const credentials = {
    async resolve(ref) { const value = stored[ref]; return value ? { value, source: 'file' } : undefined },
    async describe(ref) { return { configured: Object.prototype.hasOwnProperty.call(stored, ref), writable: true } },
    async set(ref, value) { calls.set.push([ref, value]); stored[ref] = value },
    async unset(ref) { calls.unset.push(ref); delete stored[ref] },
  }
  const routes = new Map()
  const webServer = { register: (definition) => { routes.set(definition.path, definition); return () => {} } }
  const launch = { get: (name) => (options.env && options.env[name] != null ? { value: options.env[name] } : undefined) }
  const sections = []
  const toolDefs = []
  const projections = []
  const store = options.store || new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-key-')), 'state.json'))
  const ctx = {
    get(key) {
      if (key === 'credentials') return credentials
      if (key === 'launchEnvironment') return launch
      if (key === 'sessions') return options.sessions
      return undefined
    },
    logger: { warn() {}, info() {}, error() {} },
    effect(fn) { fn() },
    webServer,
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    tools: { register: (definition) => { toolDefs.push(definition); return () => {} } },
    sessionProjections: { register: (definition) => { projections.push(definition); return () => {} } },
  }
  apply(ctx, { baseURL: 'https://api.typesafe.ai/v1', fetchImpl: options.fetchImpl, store, cacheMs: Number.isFinite(options.cacheMs) ? options.cacheMs : 0 })
  return { routes, calls, stored, sections, toolDefs, projections, store }
}

async function invoke(harness, path, req) {
  const route = harness.routes.get(path)
  assert.ok(route, 'route registered: ' + path)
  const capture = makeRes()
  await route.handler(req, capture.res)
  return capture
}

const ASK = '/plugins/dsh-plugin-jev/api/ask'
const MODELS = '/plugins/dsh-plugin-jev/api/models'
const STATUS = '/plugins/dsh-plugin-jev/api/status'
const KEY = '/plugins/dsh-plugin-jev/api/key'
const TRANSCRIPT = '/plugins/dsh-plugin-jev/api/transcript'
const SETTINGS = '/plugins/dsh-plugin-jev/api/settings'
const STATS = '/plugins/dsh-plugin-jev/api/stats'

const ASK_BODY = { state: 'Help! My payouts have been failing for 3 days.', questions: { is_urgent: { type: 'noul', instructions: 'Does this convey urgency?' } } }
const ASK_REPLY = { model: 'jev-latest', answers: { is_urgent: { type: 'noul', noul: 0.92 } }, usage: { input_tokens: 312, output_tokens: 48 } }

await check('status route reports an unconfigured key without its value', async () => {
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}) })
  const capture = await invoke(harness, STATUS, makeReq('GET', STATUS))
  assert.equal(capture.status, 200)
  assert.equal(capture.body.configured, false)
  assert.equal(capture.body.primaryRef, TYPESAFE_CREDENTIAL_REF)
  assert.equal('value' in capture.body, false)
})

await check('key route stores on POST and removes on DELETE', async () => {
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}) })
  const saved = await invoke(harness, KEY, makeReq('POST', KEY, { value: '  sk-123  ' }))
  assert.equal(saved.status, 200)
  assert.deepEqual(harness.calls.set, [[TYPESAFE_CREDENTIAL_REF, 'sk-123']])
  const empty = await invoke(harness, KEY, makeReq('POST', KEY, { value: '   ' }))
  assert.equal(empty.status, 400)
  const removed = await invoke(harness, KEY, makeReq('DELETE', KEY))
  assert.equal(removed.status, 200)
  assert.deepEqual(harness.calls.unset, [TYPESAFE_CREDENTIAL_REF])
})

await check('ask route refuses without a key', async () => {
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}) })
  const capture = await invoke(harness, ASK, makeReq('POST', ASK, ASK_BODY))
  assert.equal(capture.status, 401)
  assert.match(capture.body.error, /API key is not set/)
})

await check('ask route calls /systemone with a Bearer key and prices the usage', async () => {
  const seen = []
  const harness = makeHarness({
    stored: { typesafe: 'test-key' },
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), options })
      return responseFor(200, ASK_REPLY)
    },
  })
  const capture = await invoke(harness, ASK, makeReq('POST', ASK, ASK_BODY))
  assert.equal(capture.status, 200)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(seen[0].options.headers.Authorization, 'Bearer test-key')
  const sent = JSON.parse(seen[0].options.body)
  assert.equal(sent.model, 'jev-latest')
  assert.equal(sent.state, ASK_BODY.state)
  assert.deepEqual(sent.questions, ASK_BODY.questions)
  assert.equal(capture.body.answers.is_urgent.noul, 0.92)
  assert.ok(Math.abs(capture.body.costUsd - 312 * DEFAULT_COST_PER_TOKEN) < 1e-15)
  assert.equal(typeof capture.body.elapsedMs, 'number')
  assert.equal(capture.body.credential.ref, TYPESAFE_CREDENTIAL_REF)
})

await check('ask route surfaces a malformed question as 502 without calling upstream', async () => {
  let called = 0
  const harness = makeHarness({
    stored: { typesafe: 'test-key' },
    fetchImpl: async () => { called += 1; return responseFor(200, ASK_REPLY) },
  })
  const capture = await invoke(harness, ASK, makeReq('POST', ASK, { state: 'x', questions: { a: { type: 'score', instructions: 'x', criteria: ['one'] } } }))
  assert.equal(capture.status, 502)
  assert.match(capture.body.error, /at least two/)
  assert.equal(called, 0)
})

await check('models route normalizes and caches the catalog', async () => {
  let called = 0
  const harness = makeHarness({
    stored: { typesafe: 'test-key' },
    cacheMs: 60_000,
    fetchImpl: async (url) => {
      called += 1
      assert.match(String(url), /\/v1\/models$/)
      return responseFor(200, { models: [{ name: 'jev-latest', description: 'flagship', release_date: '2026-09-01' }] })
    },
  })
  const first = await invoke(harness, MODELS, makeReq('GET', MODELS))
  assert.equal(first.status, 200)
  assert.equal(first.body.models[0].name, 'jev-latest')
  assert.equal(first.body.cached, false)
  const second = await invoke(harness, MODELS, makeReq('GET', MODELS))
  assert.equal(second.body.cached, true)
  assert.equal(called, 1)
})

await check('ask route retries once on a 429 honoring retry-after', async () => {
  let called = 0
  const harness = makeHarness({
    stored: { typesafe: 'test-key' },
    fetchImpl: async () => {
      called += 1
      if (called === 1) return responseFor(429, { error: 'slow down' }, { 'retry-after': '0' })
      return responseFor(200, ASK_REPLY)
    },
  })
  const capture = await invoke(harness, ASK, makeReq('POST', ASK, ASK_BODY))
  assert.equal(capture.status, 200)
  assert.equal(called, 2)
})

await check('transcript route folds a session and degrades without one', async () => {
  const without = makeHarness({ fetchImpl: async () => responseFor(500, {}) })
  const degraded = await invoke(without, TRANSCRIPT, makeReq('GET', TRANSCRIPT + '?session=abc'))
  assert.equal(degraded.status, 200)
  assert.equal(degraded.body.available, false)
  assert.equal(degraded.body.reason, 'no-session-store')

  const sessions = {
    get(id) {
      if (id !== 's1') return undefined
      return {
        snapshotEvents() {
          return [
            { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'the payout failed' }], source: { kind: 'user' } } },
            { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Checking now.' }] } } },
          ]
        },
      }
    },
  }
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}), sessions })
  const capture = await invoke(harness, TRANSCRIPT, makeReq('GET', TRANSCRIPT + '?session=s1'))
  assert.equal(capture.status, 200)
  assert.equal(capture.body.available, true)
  assert.match(capture.body.text, /USER: the payout failed/)
  assert.match(capture.body.text, /ASSISTANT: Checking now\./)

  const unknown = await invoke(harness, TRANSCRIPT, makeReq('GET', TRANSCRIPT + '?session=nope'))
  assert.equal(unknown.body.reason, 'unknown-session')
})

await check('settings route reads and writes the model preference', async () => {
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}) })
  const initial = await invoke(harness, SETTINGS, makeReq('GET', SETTINGS))
  assert.equal(initial.status, 200)
  assert.equal(initial.body.model, 'jev-latest')
  const saved = await invoke(harness, SETTINGS, makeReq('POST', SETTINGS, { model: '  jev-preview  ' }))
  assert.equal(saved.status, 200)
  assert.equal(saved.body.storedModel, 'jev-preview')
  const empty = await invoke(harness, SETTINGS, makeReq('POST', SETTINGS, { model: '   ' }))
  assert.equal(empty.status, 400)
})

await check('stats route reports the aggregate and the projection key', async () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-key-')), 'state.json'))
  store.record({ sessionId: 's1', model: 'jev-1.13.0', inputTokens: 312, outputTokens: 48, costUsd: 312 * DEFAULT_COST_PER_TOKEN })
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}), store })
  const stats = await invoke(harness, STATS, makeReq('GET', STATS))
  assert.equal(stats.status, 200)
  assert.equal(stats.body.totals.calls, 1)
  assert.equal(stats.body.totals.inputTokens, 312)
  assert.equal(stats.body.sessionsTracked, 1)
  assert.equal(stats.body.projectionKey, 'jevUsage')
  assert.equal(typeof stats.body.costPerToken, 'number')
})

console.log(failures === 0 ? '\nall route checks passed' : '\n' + failures + ' route check(s) failed')
if (failures > 0) process.exit(1)
