/**
 * Verify docs/ claims against the actual library, no network.
 * Each check is a statement made in a docs file; a failure means a doc lie.
 */
import assert from 'node:assert/strict'
import {
  parseQuestions,
  normalizeState,
  buildRequest,
  costOfUsage,
  DEFAULT_COST_PER_TOKEN,
  foldTranscript,
} from '../lib/index.js'
import { ServiceInputError } from '../lib/service.js'
import { JevStore, GUARD_COUNTER_KEYS } from '../lib/store.js'
import { emptyJevUsage, foldJevUsage } from '../lib/usage.js'
import { normalizeGuardConfig, dangerDecision, SEVERITY_BANDS } from '../lib/guard.js'

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log('  ok   ' + label) }
  catch (e) { failures += 1; console.log('  FAIL ' + label + '\n       ' + (e.stack ?? e.message)) }
}

// --- doc 01: question validation ---

check('doc01: noul WITHOUT criteria is valid (criteria optional)', () => {
  const q = parseQuestions({ a: { type: 'noul', instructions: 'x' } })
  assert.equal(q.a.type, 'noul')
  assert.equal(q.a.criteria, undefined)
})

check('doc01: noul with only a `true` description is valid', () => {
  const q = parseQuestions({ a: { type: 'noul', instructions: 'x', criteria: { true: 'yes-side' } } })
  assert.deepEqual(q.a.criteria, { true: 'yes-side' })
})

check('doc01: noul criteria non-string value is refused', () => {
  assert.throws(() => parseQuestions({ a: { type: 'noul', instructions: 'x', criteria: { true: 5 } } }), /must be a string/)
})

check('doc01: duplicate question id is refused', () => {
  assert.throws(() => parseQuestions({ a: { type: 'noul', instructions: 'x' }, ' a ': { type: 'noul', instructions: 'y' } }), /duplicate question id/)
})

check('doc01: 65 questions refused, 64 accepted', () => {
  const tooMany = {}
  for (let i = 0; i < 65; i += 1) tooMany['q' + i] = { type: 'noul', instructions: 'x' }
  assert.throws(() => parseQuestions(tooMany), /too many questions/)
  const exactly = {}
  for (let i = 0; i < 64; i += 1) exactly['q' + i] = { type: 'noul', instructions: 'x' }
  assert.equal(Object.keys(parseQuestions(exactly)).length, 64)
})

check('doc01: empty state forms are refused, non-empty accepted', () => {
  assert.throws(() => normalizeState(''), /state must be non-empty/)
  assert.throws(() => normalizeState({}), /state must be non-empty/)
  assert.throws(() => normalizeState([]), /state must be non-empty/)
  assert.equal(normalizeState('x'), 'x')
  assert.deepEqual(normalizeState({ a: 1 }), { a: 1 })
})

check('doc01: unknown question type refused with exact message shape', () => {
  assert.throws(() => parseQuestions({ a: { type: 'boolean', instructions: 'x' } }), /unknown type; expected choice, score, or noul/)
})

check('doc01: score needs >= 2 levels; choice needs >= 1 option', () => {
  assert.throws(() => parseQuestions({ a: { type: 'score', instructions: 'x', criteria: ['one'] } }), /at least two/)
  assert.throws(() => parseQuestions({ a: { type: 'choice', instructions: 'x', criteria: {} } }), /at least one option/)
  assert.throws(() => parseQuestions({ a: { type: 'choice', instructions: 'x', criteria: { opt: 7 } } }), /string or null/)
})

check('doc01: over-400k-char request refused by buildRequest', () => {
  assert.throws(() => buildRequest({ state: 'x'.repeat(400_001), questions: { q: { type: 'noul', instructions: 'x' } } }), /request is too large/)
})

check('doc01: ServiceInputError carries code bad-input', () => {
  const e = new ServiceInputError('test')
  assert.equal(e.code, 'bad-input')
})

// --- doc 01: pricing ---

check('doc01: cost is input_tokens x 4.2e-8 exactly', () => {
  assert.equal(costOfUsage({ input_tokens: 414, output_tokens: 44 }), 414 * DEFAULT_COST_PER_TOKEN)
  assert.equal(DEFAULT_COST_PER_TOKEN, 4.2e-8)
  assert.equal(costOfUsage({ input_tokens: 414, output_tokens: 999_999 }), 414 * DEFAULT_COST_PER_TOKEN, 'output tokens are free')
})

// --- doc 01 example from the live call: 414 tokens -> 0.000017388 ---

check('doc05: the /ask worked example cost is arithmetically right', () => {
  assert.equal(Math.abs(414 * 4.2e-8 - 0.000017388) < 1e-15, true)
})

// --- doc 05/07: transcript fold labels ---

check('doc05: fold labels user vs CONTEXT, tool call/result/error', () => {
  const folded = foldTranscript([
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'injected' }], source: { kind: 'runtime-context' } } },
    { type: 'tool/call', data: { name: 'pwsh', arguments: '{"command":"echo hi"}' } },
    { type: 'tool/result', data: { message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'boom' }] } } },
  ])
  assert.match(folded.text, /USER: hello/)
  assert.match(folded.text, /CONTEXT: injected/)
  assert.match(folded.text, /TOOL CALL pwsh/)
  assert.match(folded.text, /TOOL ERROR: boom/)
})

// --- doc 06: guard config normalization ---

check('doc06: defaults are enabled:false, mode:monitor, threshold:high, floor:0.7', () => {
  const c = normalizeGuardConfig(undefined)
  assert.equal(c.enabled, false)
  assert.equal(c.mode, 'monitor')
  assert.equal(c.blockThreshold, 'high')
  assert.equal(c.confidenceFloor, 0.7)
  assert.equal(c.scoreDanger, true)
  assert.deepEqual(c.tools, ['pwsh', 'bash', 'pwsh_persistent', 'bash_persistent'])
})

check('doc06: bands are the five, in order', () => {
  assert.deepEqual(SEVERITY_BANDS, ['safe', 'low', 'moderate', 'high', 'critical'])
})

check('doc06: dangerDecision table - over threshold blocks; sub-floor confidence downgrades; irreversible moderate+ blocks', () => {
  const cfg = normalizeGuardConfig({ blockThreshold: 'high' })
  const block = dangerDecision({ severity: 'critical', severityAtLeast: 1, irreversible: false, confidence: 0.97, config: cfg })
  assert.equal(block.action, 'block')
  assert.equal(block.trigger, 'danger')
  const downgrade = dangerDecision({ severity: 'critical', severityAtLeast: 1, irreversible: false, confidence: 0.5, config: cfg })
  assert.equal(downgrade.action, 'allow')
  assert.equal(downgrade.downgraded, true)
  const irreversible = dangerDecision({ severity: 'moderate', severityAtLeast: 0, irreversible: true, confidence: 0.9, config: normalizeGuardConfig({ blockThreshold: 'critical', blockIrreversible: true }) })
  assert.equal(irreversible.action, 'block')
  const safe = dangerDecision({ severity: 'low', severityAtLeast: 0, irreversible: false, confidence: 0.9, config: cfg })
  assert.equal(safe.action, 'allow')
})

// --- doc 07: store shape ---

check('doc07: GUARD_COUNTER_KEYS match the documented counter names', () => {
  assert.deepEqual(GUARD_COUNTER_KEYS, ['evaluated', 'blockedLiteral', 'blockedSemantic', 'blockedDanger', 'blockedOversize', 'downgraded', 'failures', 'cached', 'skipped'])
})

check('doc07: fresh store exposes guardCounters zeroed with last null', () => {
  const store = new JevStore('nonexistent-dir/definitely-missing.json')
  assert.deepEqual(store.snapshot().guardCounters, Object.assign(Object.fromEntries(GUARD_COUNTER_KEYS.map((k) => [k, 0])), { last: null }))
})

check('doc07: bySource has exactly tool/host/guard buckets', () => {
  const store = new JevStore('nonexistent-dir/definitely-missing.json')
  assert.deepEqual(Object.keys(store.snapshot().bySource), ['tool', 'host', 'guard'])
})

check('doc07: fold carries guardBlocks through a usage event', () => {
  const state = [{ type: 'tool/result', data: { message: { role: 'tool', isError: true, content: [{ type: 'text', text: '[jev-guard] denied' }] } } }].reduce(foldJevUsage, emptyJevUsage())
  assert.equal(state.guardBlocks, 1)
  assert.equal(state.calls, 0)
})

console.log(failures === 0 ? '\nall doc claims verified' : '\n' + failures + ' doc claim(s) WRONG')
process.exit(failures > 0 ? 1 : 0)
