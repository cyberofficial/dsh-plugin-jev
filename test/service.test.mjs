/**
 * Checks for the host-side Jev decision service (lib/service.js): sibling
 * plugins can get a calibrated judgment without spending a main-model round
 * trip, malformed input is refused at the seam before any network work, and a
 * host call is recorded in the aggregate under its own source so the Settings
 * totals stay honest.
 *
 * Usage: node test/service.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, DEFAULT_COST_PER_TOKEN, costOfUsage } from '../lib/index.js'
import { JEV_SERVICE_NAME, MAX_SERVICE_STATE_CHARS } from '../lib/service.js'
import { JevStore } from '../lib/store.js'

let failures = 0
async function check(label, fn) {
  try { await fn(); console.log('  ok   ' + label) }
  catch (error) { failures += 1; console.log('  FAIL ' + label + '\n       ' + (error.stack ?? error.message)) }
}

function responseFor(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => null },
    async text() { return typeof payload === 'string' ? payload : JSON.stringify(payload) },
  }
}

const REPLY = {
  model: 'jev-1.13.0',
  answers: { urgent: { type: 'noul', noul: 0.93 } },
  usage: { input_tokens: 900, output_tokens: 40 },
}

/** A context that offers the service seam and captures what was provided. */
function makeHarness(options = {}) {
  const stored = Object.assign({}, options.stored)
  const provided = new Map()
  const credentials = {
    async resolve(ref) { const value = stored[ref]; return value ? { value, source: 'file' } : undefined },
    async describe() { return { configured: Object.keys(stored).length > 0, writable: true } },
  }
  const store = options.store || new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-svc-')), 'state.json'))
  const guardHandlers = []
  const ctx = {
    get(key) {
      if (key === 'credentials') return credentials
      if (key === 'launchEnvironment') return { get: () => undefined }
      return undefined
    },
    provide(name, value) { provided.set(name, value); return () => provided.delete(name) },
    logger: { warn() {}, info() {}, error() {} },
    effect(fn) { return fn() },
    // apply() also registers the tools/pre-execute command guard. This suite is
    // about the service, so the guard listener is captured and not driven.
    on(event, handler) { if (event === 'tools/pre-execute') guardHandlers.push(handler); return () => {} },
    webServer: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
    sessionProjections: { register: () => () => {} },
  }
  apply(ctx, Object.assign({ baseURL: 'https://api.typesafe.ai/v1', fetchImpl: options.fetchImpl, store }, options.config))
  return { provided, store, service: provided.get(JEV_SERVICE_NAME) }
}

await check('mounting provides the host service under the documented name', () => {
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => responseFor(200, REPLY) })
  assert.equal(typeof harness.service, 'object', 'ctx.provide must register the service')
  assert.equal(typeof harness.service.ask, 'function')
  assert.equal(harness.provided.has(JEV_SERVICE_NAME), true)
})

await check('ask performs one validated call and returns typed answers', async () => {
  const seen = []
  const harness = makeHarness({
    stored: { typesafe: 'host-key' },
    fetchImpl: async (url, options) => { seen.push({ url: String(url), options }); return responseFor(200, REPLY) },
  })
  const result = await harness.service.ask({
    state: 'Deploy failed twice today',
    questions: { urgent: { type: 'noul', instructions: 'Is this urgent?' } },
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(seen[0].options.headers.Authorization, 'Bearer host-key')
  assert.equal(JSON.parse(seen[0].options.body).state, 'Deploy failed twice today')
  assert.equal(result.answers.urgent.noul, 0.93)
  assert.equal(result.usage.input_tokens, 900)
  // The credential must never leak into the value a caller can log.
  assert.equal(JSON.stringify(result).includes('host-key'), false)
})

await check('ask prices the call at the published rate', async () => {
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => responseFor(200, REPLY) })
  const result = await harness.service.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } })
  assert.equal(result.costUsd, costOfUsage({ input_tokens: 900, output_tokens: 40 }))
  assert.equal(result.costUsd, 900 * DEFAULT_COST_PER_TOKEN)
  assert.equal(typeof result.elapsedMs, 'number')
})

await check('a host call is recorded in the aggregate under source host', async () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-svc-')), 'state.json'))
  const harness = makeHarness({ stored: { typesafe: 'k' }, store, fetchImpl: async () => responseFor(200, REPLY) })
  await harness.service.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } })
  const snapshot = store.snapshot()
  assert.equal(snapshot.totals.calls, 1)
  assert.equal(snapshot.totals.inputTokens, 900)
  assert.equal(snapshot.bySource.host.calls, 1, 'host bucket carries the call')
  assert.equal(snapshot.bySource.tool.calls, 0, 'tool bucket untouched')
  assert.equal(snapshot.lastCall.source, 'host')
  assert.equal(snapshot.byModel['jev-1.13.0'].calls, 1)
})

await check('the tool path and the host path land in separate buckets', async () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-svc-')), 'state.json'))
  const harness = makeHarness({ stored: { typesafe: 'k' }, store, fetchImpl: async () => responseFor(200, REPLY) })
  await harness.service.ask({ state: 'host call', questions: { q: { type: 'noul', instructions: 'x' } } })
  store.record({ model: 'jev-1.13.0', inputTokens: 100, outputTokens: 1, costUsd: 100 * DEFAULT_COST_PER_TOKEN, source: 'tool' })
  const snapshot = store.snapshot()
  assert.equal(snapshot.bySource.host.calls, 1)
  assert.equal(snapshot.bySource.tool.calls, 1)
  assert.equal(snapshot.totals.calls, 2)
  assert.equal(snapshot.totals.inputTokens, 1000)
})

await check('a call recorded without a source defaults to the tool bucket', () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-svc-')), 'state.json'))
  store.record({ model: 'm', inputTokens: 10, outputTokens: 1, costUsd: 0 })
  assert.equal(store.snapshot().bySource.tool.calls, 1)
  assert.equal(store.snapshot().bySource.host.calls, 0)
})

await check('the service refuses malformed input without calling upstream', async () => {
  let called = 0
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => { called += 1; return responseFor(200, REPLY) } })
  const ask = harness.service.ask
  const questions = { q: { type: 'noul', instructions: 'x' } }
  await assert.rejects(() => ask(), /requires an options object/)
  await assert.rejects(() => ask({ questions }), /state is required/)
  await assert.rejects(() => ask('nope'), /requires an options object/)
  await assert.rejects(() => ask({ state: 's' }), /questions is required/)
  await assert.rejects(() => ask({ state: 's', questions: [] }), /must be a JSON object/)
  await assert.rejects(() => ask({ state: 's', questions: {}, model: 7 }), /model must be a string/)
  // The shape seam reports every structural problem before buildRequest's own
  // value validation runs, so an empty state surfaces only once questions is
  // at least the right kind of thing.
  await assert.rejects(() => ask({ state: '', questions }), /state must be non-empty/)
  await assert.rejects(() => ask({ state: {}, questions }), /state must be non-empty/)
  assert.equal(called, 0, 'no network work before validation')
})

await check('the service refuses an over-budget state without calling upstream', async () => {
  let called = 0
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => { called += 1; return responseFor(200, REPLY) } })
  await assert.rejects(
    () => harness.service.ask({ state: 'x'.repeat(MAX_SERVICE_STATE_CHARS + 1), questions: { q: { type: 'noul', instructions: 'x' } } }),
    /over the .* service budget/,
  )
  assert.equal(called, 0)
})

await check('the service refuses too many questions without calling upstream', async () => {
  let called = 0
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => { called += 1; return responseFor(200, REPLY) } })
  const questions = {}
  for (let i = 0; i < 65; i += 1) questions['q' + i] = { type: 'noul', instructions: 'x' }
  await assert.rejects(() => harness.service.ask({ state: 's', questions }), /too many questions/)
  assert.equal(called, 0)
})

await check('a missing key surfaces as a typed no-key failure', async () => {
  const harness = makeHarness({ fetchImpl: async () => responseFor(500, {}) })
  const code = await harness.service.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } })
    .then(() => null, (error) => error.code)
  assert.equal(code, 'no-key')
})

await check('a malformed question is refused before any network work', async () => {
  let called = 0
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => { called += 1; return responseFor(200, REPLY) } })
  await assert.rejects(
    () => harness.service.ask({ state: 's', questions: { a: { type: 'score', instructions: 'x', criteria: ['one'] } } }),
    /at least two/,
  )
  assert.equal(called, 0)
})

await check('a failed accounting write cannot fail the decision', async () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-svc-')), 'state.json'))
  store.record = () => { throw new Error('disk full') }
  const harness = makeHarness({ stored: { typesafe: 'k' }, store, fetchImpl: async () => responseFor(200, REPLY) })
  const result = await harness.service.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } })
  assert.equal(result.answers.urgent.noul, 0.93, 'the caller still gets its answer')
})

await check('an upstream failure propagates so callers can fail open', async () => {
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => responseFor(500, { error: 'boom' }) })
  await assert.rejects(
    () => harness.service.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } }),
    /HTTP 500/,
  )
})

await check('the service honours a stored model default', async () => {
  const seen = []
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-svc-')), 'state.json'))
  store.setModel('jev-preview')
  const harness = makeHarness({
    stored: { typesafe: 'k' },
    store,
    fetchImpl: async (url, options) => { seen.push(JSON.parse(options.body)); return responseFor(200, REPLY) },
  })
  await harness.service.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } })
  assert.equal(seen[0].model, 'jev-preview')
})

console.log(failures === 0 ? '\nall service checks passed' : '\n' + failures + ' service check(s) failed')
if (failures > 0) process.exit(1)
