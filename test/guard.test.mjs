/**
 * Checks for the tool-command guard (lib/guard.js): the deterministic
 * blocked-command layer, the Jev danger score and its decision table, the fused
 * single call, the fail modes, the cache, and the `tools/pre-execute` handler
 * as the registry actually drives it.
 *
 * Usage: node test/guard.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, mergeCommandBlocks, guardPayload } from '../lib/index.js'
import {
  commandFromExec,
  matchRules,
  semanticRules,
  severityAtLeast,
  dangerDecision,
  normalizeGuardConfig,
  normalizeRules,
  defaultGuardConfig,
  scoringCacheKey,
  blockedMessage,
  createCommandGuard,
  LruCache,
  SEVERITY_BANDS,
  DEFAULT_GUARD_TOOLS,
} from '../lib/guard.js'
import { JevStore } from '../lib/store.js'

let failures = 0
async function check(label, fn) {
  try { await fn(); console.log('  ok   ' + label) }
  catch (error) { failures += 1; console.log('  FAIL ' + label + '\n       ' + (error.stack ?? error.message)) }
}

/** A Jev answer envelope for a given severity/irreversibility/intent verdict. */
function reply({ score = 0, confidence = 1, irreversible = false, intentTrue = false, intentId = 'intent_x', usage } = {}) {
  const probabilities = {}
  SEVERITY_BANDS.forEach((band, index) => { probabilities[band] = index === score ? 1 : 0 })
  return {
    model: 'jev-1.13.0',
    answers: {
      severity: { type: 'score', score, confidence, legend: Object.fromEntries(SEVERITY_BANDS.map((b, i) => [i, b])), probabilities },
      irreversible: { type: 'noul', noul: irreversible ? 0.95 : 0.05 },
      ...(intentTrue ? { [intentId]: { type: 'noul', noul: 0.9 } } : {}),
    },
    usage: usage ?? { input_tokens: 500, output_tokens: 20 },
  }
}

function responseFor(payload) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, async text() { return JSON.stringify(payload) } }
}

/** A context that can resolve the sandbox mode and a store, plus a live service. */
function makeHarness(options = {}) {
  const stored = Object.assign({}, options.stored ?? { typesafe: 'k' })
  const calls = []
  const provided = new Map()
  const sandboxMode = options.sandboxMode ?? 'workspace-write'
  const store = options.store || new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-guard-')), 'state.json'))
  // Written BEFORE apply so the plugin reads it at creation, exactly as a
  // persisted config would be read on a real restart.
  if (options.guardConfig !== undefined) store.setGuard(options.guardConfig)

  const ctx = {
    get(name) {
      if (name === 'credentials') return { async resolve(ref) { const v = stored[ref]; return v ? { value: v, source: 'file' } : undefined } }
      if (name === 'launchEnvironment') return { get: () => undefined }
      if (name === 'sandboxPolicy') {
        if (options.noSandbox === true) return undefined
        return { resolve: () => ({ mode: sandboxMode, workspaceRoot: 'D:/ws' }) }
      }
      return provided.get(name)
    },
    provide: (name, value) => { provided.set(name, value); return () => {} },
    logger: { warn() {}, info() {}, error() {} },
    effect(fn) { return fn() },
    on(name, handler) { if (name === 'tools/pre-execute') handlers.push(handler); return () => {} },
    webServer: { register: (definition) => { routes.set(definition.path, definition); return () => {} } },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => () => {} },
    sessionProjections: { register: () => () => {} },
  }
  const handlers = []
  const routes = new Map()
  const fetchImpl = options.fetchImpl ?? (async (url, init) => { calls.push({ url: String(url), init }); return responseFor(options.reply ?? reply()) })
  apply(ctx, { store, fetchImpl, ...options.config })
  return { calls, handlers, routes, store, provided, guardHandler: handlers[0] }
}

/** A pending tool execution the way the registry builds one. */
function exec(name, args, extra = {}) {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: 'tok',
    name,
    arguments: args,
    agent: { session: { header: { cwd: 'D:/ws' }, id: 's-1' } },
    signal: new AbortController().signal,
    ...extra,
  }
}

// ---------------------------------------------------------------- pure helpers

await check('commandFromExec reads the command for guard tools only', () => {
  const tools = DEFAULT_GUARD_TOOLS
  assert.equal(commandFromExec('pwsh', { command: 'echo hi' }, tools), 'echo hi')
  assert.equal(commandFromExec('bash', { command: 'echo hi' }, tools), 'echo hi')
  assert.equal(commandFromExec('pwsh_persistent', { command: 'ls' }, tools), 'ls')
  assert.equal(commandFromExec('read', { command: 'echo hi' }, tools), null, 'non-shell tool is not scored')
  assert.equal(commandFromExec('pwsh', { file_path: '/x' }, tools), null, 'no command argument')
  assert.equal(commandFromExec('pwsh', { command: '   ' }, tools), null, 'blank command')
  assert.equal(commandFromExec('pwsh', '{"command":"echo parsed"}', tools), 'echo parsed', 'JSON-string arguments (nested dispatch)')
  assert.equal(commandFromExec('pwsh', 'not json', tools), null)
  assert.equal(commandFromExec(null, { command: 'x' }, tools), null)
})

await check('normalizeRules drops unusable rules and bounds patterns', () => {
  const rules = normalizeRules([
    { id: 'a', patterns: ['Git Push'], intent: 'push', scope: 'nope', absolute: true },
    { id: 'a', patterns: ['dup'] },
    { id: '', patterns: ['no-id'] },
    { id: 'b' },
    { id: 'c', patterns: ['x'.repeat(500)] },
    { id: 'd', patterns: [], intent: 'intent only' },
    null,
  ])
  assert.deepEqual(rules.map((r) => r.id), ['a', 'd'], 'only usable, uniquely identified rules survive')
  assert.deepEqual(rules[0].patterns, ['git push'], 'patterns are lowercased')
  assert.equal(rules[0].scope, 'global', 'an unknown scope falls back to global')
  assert.equal(rules[0].absolute, true)
  assert.equal(rules[0].enabled, true)
  assert.deepEqual(rules[1].patterns, [], 'intent-only rule keeps an empty pattern list')
})

await check('matchRules matches case-insensitive substrings, including --dry-run', () => {
  const rules = normalizeRules([{ id: 'no-push', patterns: ['git push'], intent: 'push' }])
  assert.equal(matchRules('git push origin master', rules, 'D:/ws').id, 'no-push')
  assert.equal(matchRules('GIT PUSH origin', rules, 'D:/ws').id, 'no-push', 'case-insensitive')
  // The documented surprise: substring matching is not argument-aware.
  assert.equal(matchRules('git push --dry-run', rules, 'D:/ws').id, 'no-push', 'substring semantics also catch --dry-run')
  assert.equal(matchRules('echo hello', rules, 'D:/ws'), null)
  assert.equal(matchRules('', rules, 'D:/ws'), null)
})

await check('matchRules honours scope and the enabled flag', () => {
  const rules = normalizeRules([
    { id: 'ws', patterns: ['rm -rf build'], scope: 'workspace', workspaceRoot: 'D:\\WS\\' },
    { id: 'off', patterns: ['anything'], enabled: false },
  ])
  assert.equal(matchRules('rm -rf build', rules, 'D:/ws').id, 'ws', 'path normalization ignores separators, case, trailing slash')
  assert.equal(matchRules('rm -rf build', rules, 'D:/other'), null, 'workspace rule does not apply elsewhere')
  assert.equal(matchRules('anything', rules, 'D:/ws'), null, 'a disabled rule never matches')
})

await check('semanticRules keeps only rules with an intent, scoped correctly', () => {
  const rules = normalizeRules([
    { id: 'literal-only', patterns: ['x'] },
    { id: 'with-intent', patterns: [], intent: 'commit' },
    { id: 'ws-intent', patterns: [], intent: 'wipe', scope: 'workspace', workspaceRoot: 'D:/ws' },
  ])
  assert.deepEqual(semanticRules(rules, 'D:/ws').map((r) => r.id), ['with-intent', 'ws-intent'])
  assert.deepEqual(semanticRules(rules, 'D:/other').map((r) => r.id), ['with-intent'])
})

await check('severityAtLeast sums the tail of the distribution', () => {
  const answer = { probabilities: { safe: 0.1, low: 0.2, moderate: 0.3, high: 0.3, critical: 0.1 } }
  assert.ok(Math.abs(severityAtLeast(answer, 'safe') - 1) < 1e-9)
  assert.ok(Math.abs(severityAtLeast(answer, 'moderate') - 0.7) < 1e-9)
  assert.ok(Math.abs(severityAtLeast(answer, 'critical') - 0.1) < 1e-9)
  assert.equal(severityAtLeast({}, 'high'), null, 'no distribution means no opinion')
  assert.equal(severityAtLeast({ probabilities: { bogus: 0.5 } }, 'high'), null, 'unknown bands are ignored')
})

await check('dangerDecision follows the documented table', () => {
  const base = normalizeGuardConfig({ enabled: true, mode: 'enforce', blockThreshold: 'high', blockIrreversible: true, confidenceFloor: 0.7 })
  const at = (severity, p) => ({ ...base, blockThreshold: severity, confidenceFloor: 0 })
  // At or over the threshold blocks.
  assert.equal(dangerDecision({ severity: 'high', severityAtLeast: 0.9, irreversible: false, confidence: 1, config: base }).action, 'block')
  assert.equal(dangerDecision({ severity: 'critical', severityAtLeast: 0.9, irreversible: false, confidence: 1, config: base }).action, 'block')
  // Under threshold and reversible allows.
  assert.equal(dangerDecision({ severity: 'safe', severityAtLeast: 0.01, irreversible: false, confidence: 1, config: base }).action, 'allow')
  assert.equal(dangerDecision({ severity: 'low', severityAtLeast: 0.2, irreversible: false, confidence: 1, config: base }).action, 'allow')
  // Under threshold but irreversible AND at least moderate blocks.
  const irrev = dangerDecision({ severity: 'moderate', severityAtLeast: 0.1, irreversible: true, confidence: 1, config: base })
  assert.equal(irrev.action, 'block')
  assert.match(irrev.reason, /irreversible/)
  // The same command with blockIrreversible off allows.
  const off = { ...base, blockIrreversible: false }
  assert.equal(dangerDecision({ severity: 'moderate', severityAtLeast: 0.1, irreversible: true, confidence: 1, config: off }).action, 'allow')
  // Low severity + irreversible stays allowed: severity still gates that arm.
  assert.equal(dangerDecision({ severity: 'low', severityAtLeast: 0.1, irreversible: true, confidence: 1, config: base }).action, 'allow')
  // Threshold moves the boundary.
  assert.equal(dangerDecision({ severity: 'high', severityAtLeast: 0.9, irreversible: false, confidence: 1, config: at('critical') }).action, 'allow')
})

await check('dangerDecision downgrades a low-confidence block to a warning', () => {
  const config = normalizeGuardConfig({ enabled: true, mode: 'enforce', confidenceFloor: 0.7 })
  const verdict = dangerDecision({ severity: 'high', severityAtLeast: 0.9, irreversible: false, confidence: 0.4, config })
  assert.equal(verdict.action, 'allow', 'a coin-flip judgment must not block real work')
  assert.equal(verdict.downgraded, true)
  assert.equal(verdict.trigger, 'danger')
  assert.match(verdict.reason, /unsure/)
  // Exactly at the floor still blocks.
  assert.equal(dangerDecision({ severity: 'high', severityAtLeast: 0.9, irreversible: false, confidence: 0.7, config }).action, 'block')
  // A missing confidence does not downgrade (we cannot claim it was unsure).
  assert.equal(dangerDecision({ severity: 'high', severityAtLeast: 0.9, irreversible: false, confidence: null, config }).action, 'block')
})

await check('dangerDecision falls back to the point estimate without a distribution', () => {
  const config = normalizeGuardConfig({ enabled: true, blockThreshold: 'high', confidenceFloor: 0 })
  assert.equal(dangerDecision({ severity: 'critical', severityAtLeast: null, irreversible: false, confidence: 1, config }).action, 'block')
  assert.equal(dangerDecision({ severity: 'safe', severityAtLeast: null, irreversible: false, confidence: 1, config }).action, 'allow')
  // An unreadable severity is not treated as safe.
  const unknown = normalizeGuardConfig({ enabled: true, blockThreshold: 'high', confidenceFloor: 0 })
  assert.equal(dangerDecision({ severity: 'unknown', severityAtLeast: null, irreversible: false, confidence: 1, config: unknown }).action, 'allow')
})

await check('normalizeGuardConfig ships observe-only defaults and clamps input', () => {
  const defaults = defaultGuardConfig()
  assert.equal(defaults.enabled, false, 'off by default: no spend until opted in')
  assert.equal(defaults.mode, 'monitor', 'monitor by default: nothing is blocked until opted in')
  assert.equal(defaults.blockThreshold, 'high')
  assert.equal(defaults.blockIrreversible, true)
  assert.equal(defaults.confidenceFloor, 0.7)
  assert.deepEqual(defaults.tools, DEFAULT_GUARD_TOOLS)
  const coerced = normalizeGuardConfig({ enabled: 'yes', mode: 'bogus', blockThreshold: 'nope', confidenceFloor: 5, tools: [] })
  assert.equal(coerced.enabled, false)
  assert.equal(coerced.mode, 'monitor')
  assert.equal(coerced.blockThreshold, 'high')
  assert.equal(coerced.confidenceFloor, 0.7)
  assert.deepEqual(coerced.tools, DEFAULT_GUARD_TOOLS, 'an empty tools list falls back rather than scoring nothing')
  assert.equal(normalizeGuardConfig(null).enabled, false)
})

await check('LruCache bounds its size and refreshes recency on read', () => {
  const cache = new LruCache(2)
  cache.set('a', 1); cache.set('b', 2)
  assert.equal(cache.get('a'), 1, 'a hit returns the value')
  cache.set('c', 3)
  assert.equal(cache.size, 2)
  assert.equal(cache.get('b'), undefined, 'the least recently used entry was evicted')
  assert.equal(cache.get('a'), 1, 'the recently read entry survived')
  cache.clear()
  assert.equal(cache.size, 0)
})

await check('blockedMessage names the rule and warns against disguise', () => {
  const text = blockedMessage({ reason: 'matched', rule: { id: 'no-push', intent: 'push a repo' } })
  assert.match(text, /no-push/)
  assert.match(text, /push a repo/)
  assert.match(text, /not a tool failure/i)
  assert.match(text, /disguised form/)
  const noRule = blockedMessage({ reason: 'too dangerous' })
  assert.match(noRule, /too dangerous/)
  assert.doesNotMatch(noRule, /undefined/)
})

// ------------------------------------------------------- handler through apply

await check('mounting registers a tools/pre-execute handler and a guard route', () => {
  const harness = makeHarness({})
  assert.equal(typeof harness.guardHandler, 'function')
  assert.ok(harness.routes.has('/plugins/dsh-plugin-jev/api/guard'))
})

await check('a disabled guard delegates without any upstream call', async () => {
  const harness = makeHarness({})
  const decision = await harness.guardHandler(exec('pwsh', { command: 'rm -rf /' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'allow' })
  assert.equal(harness.calls.length, 0)
})

await check('layer 1 blocks a literal match with zero upstream calls', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', commandBlocks: [{ id: 'no-commit', patterns: ['git commit'], intent: 'commit' }] },
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'git commit -m x' }), async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /no-commit/)
  assert.equal(harness.calls.length, 0, 'the deterministic layer must never need the network')
  // A command that hides the words behind a substitution dodges the pattern, so
  // layer 1 stays silent and the semantic layer gets its chance. (`bash -c 'git
  // commit'` would NOT dodge it: substring matching still sees "git commit".)
  const obfuscated = await harness.guardHandler(exec('pwsh', { command: 'git $(echo commit) -m x' }), async () => ({ kind: 'allow' }))
  assert.notEqual(obfuscated.kind, 'deny', 'no literal hit means the call is left to the semantic layer')
})

await check('monitor mode records but never blocks', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'monitor', commandBlocks: [{ id: 'no-commit', patterns: ['git commit'] }] },
    reply: reply({ score: 4, confidence: 1 }),
  })
  const literal = await harness.guardHandler(exec('pwsh', { command: 'git commit -m x' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(literal, { kind: 'allow' }, 'monitor mode must not deny')
  const stored = harness.store.snapshot().guard
  assert.equal(stored.mode, 'monitor', 'the configured mode is what is stored')
  assert.equal(stored.commandBlocks[0].id, 'no-commit', 'a monitor decision never rewrites the rules')
})

await check('a clean command under threshold delegates with one scored call', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', commandBlocks: [] },
    reply: reply({ score: 0, confidence: 0.9 }),
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'echo hello' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'allow' })
  assert.equal(harness.calls.length, 1)
  const sent = JSON.parse(harness.calls[0].init.body)
  assert.equal(sent.questions.severity.type, 'score')
  assert.deepEqual(sent.questions.severity.criteria, SEVERITY_BANDS)
  assert.equal(sent.questions.irreversible.type, 'noul')
  assert.equal(sent.state.command, 'echo hello')
  assert.equal(sent.state.cwd, 'D:/ws', 'the working directory reaches Jev')
  assert.equal(sent.state.sandboxMode, 'workspace-write', 'the sandbox mode reaches Jev')
})

await check('a dangerous command is denied with a usable reason', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', blockThreshold: 'high' },
    reply: reply({ score: 4, confidence: 0.95, irreversible: true }),
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'rm -rf /' }), async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /danger/i)
  assert.match(decision.reason, /critical|high/)
})

await check('the danger path fails open when Jev errors', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce' },
    fetchImpl: async () => { throw new Error('network down') },
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'rm -rf /' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'allow' }, 'a Jev outage must not make the shell unusable')
})

await check('the danger path fails open when no key is configured', async () => {
  const harness = makeHarness({ stored: {}, guardConfig: { enabled: true, mode: 'enforce' } })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'rm -rf /' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'allow' })
})

await check('layer 2 denies on a semantic match that dodges the patterns', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', commandBlocks: [{ id: 'no-commit', patterns: ['git commit'], intent: 'commit or push' }] },
    reply: reply({ score: 0, confidence: 0.9, intentTrue: true, intentId: 'intent_no-commit' }),
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'git $(echo commit) -m x' }), async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /no-commit/)
  // And the intent question was fused into the same single call.
  assert.equal(harness.calls.length, 1)
  const sent = JSON.parse(harness.calls[0].init.body)
  assert.ok(sent.questions['intent_no-commit'], 'the intent question rode the same call')
})

await check('a blocked decision still carries its cost and rule into the stats', async () => {
  // Regression: the semantic path used to overwrite the recorded decision
  // without the scored result, so a block showed no cost — the one place the
  // user can see what a block spent.
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', commandBlocks: [{ id: 'no-commit', patterns: ['never-matches'], intent: 'commit or push' }] },
    reply: reply({ score: 0, confidence: 0.9, intentTrue: true, intentId: 'intent_no-commit', usage: { input_tokens: 660, output_tokens: 35 } }),
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'git $(echo commit) -m x' }), async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'deny')
  let body = null
  await harness.routes.get('/plugins/dsh-plugin-jev/api/guard').handler({ method: 'GET', url: '/plugins/dsh-plugin-jev/api/guard' }, { writeHead() {}, end(t) { body = JSON.parse(t) } })
  assert.equal(body.stats.blockedSemantic, 1)
  assert.equal(body.stats.last.rule, 'no-commit', 'the deciding rule is named')
  assert.equal(body.stats.last.action, 'block', 'enforce mode records a block, not an allow')
  assert.ok(Number.isFinite(body.stats.last.costUsd), 'a block must report what it cost')
  assert.equal(body.stats.last.costUsd, 660 * 4.2e-8)
  assert.equal(body.stats.last.model, 'jev-1.13.0')
})

await check('a block in monitor mode records the allow that actually happened', async () => {
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'monitor', commandBlocks: [{ id: 'r', patterns: ['git commit'] }] },
  })
  const decision = await harness.guardHandler(exec('pwsh', { command: 'git commit -m x' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'allow' })
  let body = null
  await harness.routes.get('/plugins/dsh-plugin-jev/api/guard').handler({ method: 'GET', url: '/plugins/dsh-plugin-jev/api/guard' }, { writeHead() {}, end(t) { body = JSON.parse(t) } })
  assert.equal(body.stats.blockedLiteral, 1, 'the would-be block is counted')
  assert.equal(body.stats.last.action, 'allow', 'but the recorded action is what actually happened')
  assert.equal(body.stats.last.rule, 'r')
  assert.equal(body.stats.last.costUsd, null, 'a literal match makes no upstream call, so it costs nothing')
})

await check('an allowed command still records the last thing the guard looked at', async () => {
  const harness = makeHarness({ guardConfig: { enabled: true, mode: 'enforce' }, reply: reply({ score: 1, confidence: 0.93, usage: { input_tokens: 300, output_tokens: 10 } }) })
  await harness.guardHandler(exec('pwsh', { command: 'Get-ChildItem' }), async () => ({ kind: 'allow' }))
  let body = null
  await harness.routes.get('/plugins/dsh-plugin-jev/api/guard').handler({ method: 'GET', url: '/plugins/dsh-plugin-jev/api/guard' }, { writeHead() {}, end(t) { body = JSON.parse(t) } })
  assert.equal(body.stats.last.action, 'allow')
  assert.equal(body.stats.last.severity, 'low', 'the severity is visible even when nothing was blocked')
  assert.equal(body.stats.last.confidence, 0.93)
  assert.equal(body.stats.last.costUsd, 300 * 4.2e-8)
})

await check('an absolute rule blocks when Jev is unreachable; a normal one does not', async () => {
  const absolute = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', commandBlocks: [{ id: 'abs', patterns: ['never-matches-x'], intent: 'never push', absolute: true }] },
    fetchImpl: async () => { throw new Error('down') },
  })
  const blocked = await absolute.guardHandler(exec('pwsh', { command: 'git push' }), async () => ({ kind: 'allow' }))
  assert.equal(blocked.kind, 'deny', 'an absolute rule fails CLOSED')
  assert.match(blocked.reason, /abs/)

  const normal = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce', commandBlocks: [{ id: 'nabs', patterns: ['never-matches-x'], intent: 'never push', absolute: false }] },
    fetchImpl: async () => { throw new Error('down') },
  })
  const allowed = await normal.guardHandler(exec('pwsh', { command: 'git push' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(allowed, { kind: 'allow' }, 'a non-absolute rule fails OPEN')
})

await check('an identical command is scored once (cache)', async () => {
  const harness = makeHarness({ guardConfig: { enabled: true, mode: 'enforce' }, reply: reply({ score: 0 }) })
  const next = async () => ({ kind: 'allow' })
  await harness.guardHandler(exec('pwsh', { command: 'npm test' }), next)
  await harness.guardHandler(exec('pwsh', { command: 'npm test' }), next)
  assert.equal(harness.calls.length, 1, 'the second identical command is served from cache')
  await harness.guardHandler(exec('pwsh', { command: 'npm run build' }), next)
  assert.equal(harness.calls.length, 2, 'a different command is scored')
})

await check('a nested dispatch is scored, and scoreNested:false skips it', async () => {
  const on = makeHarness({ guardConfig: { enabled: true, mode: 'enforce', scoreNested: true }, reply: reply({ score: 0 }) })
  await on.guardHandler(exec('pwsh', { command: 'echo nested' }, { parent: 'parent-token' }), async () => ({ kind: 'allow' }))
  assert.equal(on.calls.length, 1, 'a run_code sub-dispatch is scored')

  const off = makeHarness({ guardConfig: { enabled: true, mode: 'enforce', scoreNested: false }, reply: reply({ score: 0 }) })
  await off.guardHandler(exec('pwsh', { command: 'echo nested' }, { parent: 'parent-token' }), async () => ({ kind: 'allow' }))
  assert.equal(off.calls.length, 0, 'scoreNested:false leaves nested dispatches alone')
})

await check('an unreadable sandbox mode is reported honestly, not defaulted', async () => {
  const harness = makeHarness({ noSandbox: true, guardConfig: { enabled: true, mode: 'enforce' }, reply: reply({ score: 0 }) })
  await harness.guardHandler(exec('pwsh', { command: 'echo hi' }), async () => ({ kind: 'allow' }))
  const sent = JSON.parse(harness.calls[0].init.body)
  assert.equal(sent.state.sandboxMode, 'unknown', 'never claim a containment we could not read')
  assert.match(sent.state.note, /assume no containment/)
})

await check('guard calls are accounted under their own source', async () => {
  const harness = makeHarness({ guardConfig: { enabled: true, mode: 'enforce' }, reply: reply({ score: 0, usage: { input_tokens: 700, output_tokens: 30 } }) })
  await harness.guardHandler(exec('pwsh', { command: 'echo accounted' }), async () => ({ kind: 'allow' }))
  const snapshot = harness.store.snapshot()
  assert.equal(snapshot.bySource.guard.calls, 1, 'the guard bucket carries it')
  assert.equal(snapshot.bySource.guard.inputTokens, 700)
  assert.equal(snapshot.bySource.tool.calls, 0, 'the tool bucket is untouched')
  assert.equal(snapshot.bySource.host.calls, 0)
  assert.equal(snapshot.totals.calls, 1)
  assert.equal(snapshot.lastCall.source, 'guard')
})

await check('the guard passes the caller signal to the upstream request', async () => {
  const harness = makeHarness({ guardConfig: { enabled: true, mode: 'enforce' }, reply: reply({ score: 0 }) })
  const controller = new AbortController()
  await harness.guardHandler(exec('pwsh', { command: 'echo signal' }, { signal: controller.signal }), async () => ({ kind: 'allow' }))
  assert.ok(harness.calls[0].init.signal, 'the request carries a signal so cancelling a turn aborts it')
})

await check('an aborted caller signal surfaces as a cancellation, not a timeout', async () => {
  const controller = new AbortController()
  const harness = makeHarness({
    guardConfig: { enabled: true, mode: 'enforce' },
    fetchImpl: async (url, init) => {
      // Mimic real fetch: reject when the passed signal aborts.
      return await new Promise((resolve, reject) => {
        if (init.signal.aborted) return reject(new Error('aborted'))
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(() => resolve(responseFor(reply({ score: 0 }))), 50)
      })
    },
  })
  const pending = harness.guardHandler(exec('pwsh', { command: 'echo abort' }, { signal: controller.signal }), async () => ({ kind: 'allow' }))
  controller.abort()
  const decision = await pending
  assert.deepEqual(decision, { kind: 'allow' }, 'an aborted guard call delegates rather than throwing')
})

await check('the guard never throws into the dispatch path', async () => {
  const harness = makeHarness({ guardConfig: { enabled: true, mode: 'enforce' } })
  // A malformed exec must not explode.
  const decision = await harness.guardHandler({ name: 'pwsh' }, async () => ({ kind: 'allow' }))
  assert.deepEqual(decision, { kind: 'allow' })
  // A throwing downstream next() is not ours to swallow, but a throwing guard is.
  const throwing = makeHarness({ guardConfig: { enabled: true, mode: 'enforce' }, fetchImpl: async () => { throw new Error('boom') } })
  const result = await throwing.guardHandler(exec('pwsh', { command: 'x' }), async () => ({ kind: 'allow' }))
  assert.deepEqual(result, { kind: 'allow' })
})

await check('guard stats expose counters and the last decision', async () => {
  const harness = makeHarness({ guardConfig: { enabled: true, mode: 'enforce', blockThreshold: 'high' }, reply: reply({ score: 4, confidence: 0.99 }) })
  await harness.guardHandler(exec('pwsh', { command: 'rm -rf /' }), async () => ({ kind: 'allow' }))
  const stats = harness.routes.get('/plugins/dsh-plugin-jev/api/guard') && null
  const payload = guardPayload({ getConfig: () => ({ enabled: true }), stats: () => ({ evaluated: 1, blockedDanger: 1, last: { command: 'rm -rf /' } }) }, harness.store)
  assert.equal(payload.config.enabled, true)
  assert.equal(payload.stats.blockedDanger, 1)
  assert.equal(payload.defaults.severityBands.length, 5)
  assert.ok(stats === null)
})

await check('mergeCommandBlocks upserts by id and preserves the untouched list', () => {
  const current = [{ id: 'a', patterns: ['x'] }, { id: 'b', patterns: ['y'] }]
  const merged = mergeCommandBlocks(current, [{ id: 'a', patterns: ['z'] }, { patterns: ['new'] }])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[0].patterns, ['z'], 'an existing id is updated in place')
  assert.notEqual(merged[1].id, 'a', 'a new rule gets a fresh id')
  assert.deepEqual(merged[1].patterns, ['new'])
  // A non-array leaves the rules untouched.
  assert.deepEqual(mergeCommandBlocks(current, 'nope'), current)
  // Duplicate ids in one post are separated.
  const dupes = mergeCommandBlocks([], [{ id: 'same', patterns: ['1'] }, { id: 'same', patterns: ['2'] }])
  assert.notEqual(dupes[0].id, dupes[1].id)
})

await check('the stored guard config survives a recorded call', async () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-guard-')), 'state.json'))
  store.setGuard({ enabled: true, mode: 'enforce' })
  store.record({ model: 'm', inputTokens: 10, outputTokens: 1, costUsd: 0, source: 'guard' })
  assert.equal(store.snapshot().guard.enabled, true, 'record() must not erase the guard config')
  assert.equal(store.snapshot().guard.mode, 'enforce')
})

await check('a bad guard patch is refused by the route', async () => {
  const harness = makeHarness({})
  const route = harness.routes.get('/plugins/dsh-plugin-jev/api/guard')
  const res = { writeHead() {}, end() {} }
  let status = null
  res.writeHead = (code) => { status = code }
  const req = { method: 'POST', url: '/plugins/dsh-plugin-jev/api/guard', async * [Symbol.asyncIterator]() { yield Buffer.from('["not an object"]') } }
  await route.handler(req, res)
  assert.equal(status, 400)
})

console.log(failures === 0 ? '\nall guard checks passed' : '\n' + failures + ' guard check(s) failed')
if (failures > 0) process.exit(1)
