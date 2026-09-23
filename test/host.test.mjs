/**
 * Host-half checks for dsh-plugin-jev: request validation, answer normalization,
 * transcript folding, credential resolution, and cost estimation — all pure
 * functions, no services.
 *
 * Usage: node test/host.test.mjs
 */
import assert from 'node:assert/strict'
import {
  parseQuestions,
  normalizeState,
  buildRequest,
  normalizeAnswers,
  normalizeModels,
  costOfUsage,
  foldTranscript,
  parseRetryAfter,
  resolveApiKey,
  describeCredential,
  DEFAULT_MODEL,
  DEFAULT_COST_PER_TOKEN,
} from '../lib/index.js'
import { JevStore, normalizeState as normalizeStoreState, emptyUsage } from '../lib/store.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
async function check(label, fn) {
  try { await fn(); console.log('  ok   ' + label) }
  catch (error) { failures += 1; console.log('  FAIL ' + label + '\n       ' + (error.stack ?? error.message)) }
}

await check('parseQuestions accepts a mixed Choice/Score/Noul map', () => {
  const questions = parseQuestions({
    is_urgent: { type: 'noul', instructions: 'Does this convey urgency?', criteria: { true: 'Time-sensitive', false: 'Not urgent' } },
    topic: { type: 'choice', instructions: 'Which area?', criteria: { billing: 'payments', technical: null } },
    tone: { type: 'score', instructions: 'How negative?', criteria: ['Neutral', 'Mild', 'Strong'] },
  })
  assert.deepEqual(Object.keys(questions), ['is_urgent', 'topic', 'tone'])
  assert.equal(questions.is_urgent.type, 'noul')
  assert.deepEqual(questions.is_urgent.criteria, { true: 'Time-sensitive', false: 'Not urgent' })
  assert.deepEqual(questions.topic.criteria, { billing: 'payments', technical: null })
  assert.deepEqual(questions.tone.criteria, ['Neutral', 'Mild', 'Strong'])
})

await check('parseQuestions drops unknown fields and trims ids/options', () => {
  const questions = parseQuestions({
    '  spaced  ': { type: 'noul', instructions: 'ok?', extra: 'ignored' },
    choicey: { type: 'choice', instructions: 'pick', criteria: { '  a  ': 'first' } },
  })
  assert.deepEqual(Object.keys(questions), ['spaced', 'choicey'])
  assert.deepEqual(questions.choicey.criteria, { a: 'first' })
  assert.equal('extra' in questions.spaced, false)
})

await check('parseQuestions rejects malformed questions', () => {
  assert.throws(() => parseQuestions({}), /at least one question/)
  assert.throws(() => parseQuestions({ a: { type: 'bogus', instructions: 'x' } }), /unknown type/)
  assert.throws(() => parseQuestions({ a: { type: 'noul', instructions: '   ' } }), /non-empty instructions/)
  assert.throws(() => parseQuestions({ a: { type: 'choice', instructions: 'x', criteria: {} } }), /at least one option/)
  assert.throws(() => parseQuestions({ a: { type: 'score', instructions: 'x', criteria: ['only'] } }), /at least two/)
  assert.throws(() => parseQuestions({ a: { type: 'noul', instructions: 'x' }, ' a ': { type: 'noul', instructions: 'y' } }), /duplicate question id/)
})

await check('normalizeState accepts string/object/array and rejects empty or scalar', () => {
  assert.equal(normalizeState('hello'), 'hello')
  assert.deepEqual(normalizeState({ a: 1 }), { a: 1 })
  assert.deepEqual(normalizeState(['x']), ['x'])
  assert.throws(() => normalizeState('   '), /non-empty/)
  assert.throws(() => normalizeState({}), /non-empty/)
  assert.throws(() => normalizeState([]), /non-empty/)
  assert.throws(() => normalizeState(42), /string, an object, or an array/)
  assert.throws(() => normalizeState(null), /string, an object, or an array/)
})

await check('buildRequest defaults the model and validates both parts', () => {
  const request = buildRequest({ state: 'hi', questions: { a: { type: 'noul', instructions: 'x?' } } })
  assert.equal(request.model, DEFAULT_MODEL)
  assert.equal(request.state, 'hi')
  const pinned = buildRequest({ state: 'hi', questions: { a: { type: 'noul', instructions: 'x?' } }, model: '  jev-1.13.0  ' })
  assert.equal(pinned.model, 'jev-1.13.0')
  assert.throws(() => buildRequest({ questions: { a: { type: 'noul', instructions: 'x?' } } }), /state/)
})

await check('normalizeAnswers keeps structured answers and defaults usage', () => {
  const normalized = normalizeAnswers({
    model: 'jev-latest',
    answers: { is_urgent: { type: 'noul', noul: 0.92 }, dept: { type: 'choice', choice: 'billing', probabilities: { billing: 1 }, confidence: 0.9 } },
    usage: { input_tokens: 312, output_tokens: 48 },
  })
  assert.equal(normalized.model, 'jev-latest')
  assert.equal(normalized.usage.input_tokens, 312)
  assert.equal(normalized.answers.is_urgent.noul, 0.92)
  const bare = normalizeAnswers({ answers: {} })
  assert.deepEqual(bare.usage, { input_tokens: 0, output_tokens: 0 })
  assert.equal(bare.model, DEFAULT_MODEL)
  assert.throws(() => normalizeAnswers({}), /no answers object/)
})

await check('normalizeModels reads the documented list shape', () => {
  const { models } = normalizeModels({ models: [{ name: 'jev-latest', description: 'flagship', release_date: '2026-09-01' }, null] })
  assert.equal(models.length, 1)
  assert.deepEqual(models[0], { name: 'jev-latest', description: 'flagship', releaseDate: '2026-09-01' })
})

await check('costOfUsage prices input tokens only', () => {
  const cost = costOfUsage({ input_tokens: 1000, output_tokens: 999 })
  assert.ok(Math.abs(cost - 1000 * DEFAULT_COST_PER_TOKEN) < 1e-15)
  assert.equal(costOfUsage(null), 0)
})

await check('foldTranscript renders the recent conversation with tools', () => {
  const events = [
    { type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'system rules' }] } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'My payouts fail.' }], source: { kind: 'user' } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'Let me check.' }] } } },
    { type: 'tool/call', data: { name: 'lookup', arguments: '{"id":7}' } },
    // Session format v4 flattened tool results: the result's own blocks sit
    // directly under `message.content`, and failure rides `message.isError`.
    { type: 'tool/result', data: { message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'payout 7 failed' }] } } },
    { type: 'tool/result', data: { message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'connection refused' }] } } },
    // Injected context, in the kinds session format v4 actually writes. The
    // pre-v4 catch-all `{ kind: 'plugin', plugin }` was rewritten away by the
    // v3->v4 migration, so `!== 'user'` is the discriminator that holds.
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'please fix it fast' }], source: { kind: 'runtime-context' } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'AGENTS.md changed' }], source: { kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }] } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'third-party plugin note' }], source: { kind: 'plugin:some-plugin' } } },
  ]
  const folded = foldTranscript(events)
  assert.match(folded.text, /USER: My payouts fail\./)
  assert.match(folded.text, /ASSISTANT: Let me check\./)
  assert.doesNotMatch(folded.text, /hidden/)
  assert.match(folded.text, /TOOL CALL lookup/)
  assert.match(folded.text, /TOOL RESULT: payout 7 failed/)
  assert.match(folded.text, /TOOL ERROR: connection refused/)
  assert.match(folded.text, /CONTEXT: please fix it fast/)
  assert.match(folded.text, /CONTEXT: AGENTS\.md changed/)
  assert.match(folded.text, /CONTEXT: third-party plugin note/)
  // The genuine prompt is the only USER line in the whole transcript.
  assert.equal(folded.text.match(/USER: /g)?.length, 1)
  assert.equal(folded.messages, 8)
  assert.equal(folded.omitted, 0)
})

await check('foldTranscript treats a message with no attributable source as injected', () => {
  const events = [
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'attributed to nobody' }] } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'bad source' }], source: 'nonsense' } },
  ]
  const folded = foldTranscript(events)
  assert.equal(folded.text.match(/CONTEXT: /g)?.length, 2)
  assert.doesNotMatch(folded.text, /USER: /)
})

await check('foldTranscript reads the flattened v4 tool-result shape', () => {
  // The pre-v4 wrapper block (`content: [{ type: 'tool-result', content: [...] }]`)
  // is gone: a transcript built from it produced an empty TOOL RESULT line and
  // could never report a tool failure.
  const legacy = foldTranscript([{ type: 'tool/result', data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'lost' }] }] } } }])
  assert.doesNotMatch(legacy.text, /lost/, 'the retired wrapper block carries no readable text')
  assert.match(legacy.text, /^TOOL RESULT:$/m)

  const current = foldTranscript([
    { type: 'tool/result', data: { message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'kept' }] } } },
    { type: 'tool/result', data: { message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'boom' }] } } },
    { type: 'tool/result', data: { message: { role: 'tool', isError: false, content: [{ type: 'image', attachment: { id: 'x' } }] } } },
  ])
  assert.match(current.text, /TOOL RESULT: kept/)
  assert.match(current.text, /TOOL ERROR: boom/)
  assert.match(current.text, /TOOL RESULT: \[image\]/)
})

await check('foldTranscript bounds message count and total size', () => {
  const events = []
  for (let i = 0; i < 10; i += 1) events.push({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'message ' + i }], source: { kind: 'user' } } })
  const folded = foldTranscript(events, { maxMessages: 3, maxChars: 10_000 })
  assert.equal(folded.messages, 3)
  assert.equal(folded.omitted, 7)
  assert.match(folded.text, /message 9/)
  assert.doesNotMatch(folded.text, /message 1:/)
  const tight = foldTranscript(events, { maxChars: 40 })
  assert.ok(tight.chars <= 80)
  assert.match(tight.text, /omitted/)
})

await check('parseRetryAfter reads seconds and dates', () => {
  assert.equal(parseRetryAfter('2'), 2000)
  assert.equal(parseRetryAfter('0.5'), 500)
  assert.equal(parseRetryAfter(null), null)
  const soon = new Date(Date.now() + 5000).toUTCString()
  const parsed = parseRetryAfter(soon)
  assert.ok(parsed !== null && parsed > 3000 && parsed <= 5000)
})

await check('the store keeps a tool/host source split and reads older files', () => {
  const store = new JevStore(join(mkdtempSync(join(tmpdir(), 'jev-host-')), 'state.json'))
  assert.deepEqual(store.snapshot().bySource, {
    tool: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    host: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    guard: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  })
  store.record({ model: 'm', inputTokens: 10, outputTokens: 2, costUsd: 0.1, source: 'tool' })
  store.record({ model: 'm', inputTokens: 5, outputTokens: 1, costUsd: 0.2, source: 'host' })
  store.record({ model: 'm', inputTokens: 2, outputTokens: 1, costUsd: 0.3, source: 'guard' })
  const snapshot = store.snapshot()
  assert.equal(snapshot.bySource.tool.calls, 1)
  assert.equal(snapshot.bySource.host.calls, 1)
  assert.equal(snapshot.bySource.guard.calls, 1, 'the guard has its own bucket')
  assert.equal(snapshot.bySource.tool.inputTokens, 10)
  assert.equal(snapshot.bySource.host.inputTokens, 5)
  assert.equal(snapshot.bySource.guard.inputTokens, 2)
  assert.equal(snapshot.totals.calls, 3, 'totals still count every call')
  assert.equal(snapshot.lastCall.source, 'guard')

  // A file written before the split has no bySource: those calls were all
  // model-driven, so they must reconstruct into the tool bucket rather than
  // vanish or inflate the host count.
  const legacy = normalizeStoreState({ totals: { calls: 3, inputTokens: 30, outputTokens: 3, costUsd: 0.3 }, byModel: {}, sessions: {} })
  assert.equal(legacy.bySource.tool.calls, 0, 'normalizeState does not invent per-source history')
  assert.equal(legacy.bySource.host.calls, 0)
  // An unknown source marker is coerced, never dropped silently into a new key.
  const coerced = normalizeStoreState({ totals: emptyUsage(), bySource: { bogus: { calls: 9 } } })
  assert.equal(coerced.bySource.tool.calls, 0)
  assert.equal(coerced.bySource.host.calls, 0)
  assert.equal('bogus' in coerced.bySource, false)
})

await check('resolveApiKey prefers the credential service over the environment', async () => {
  const ctx = {
    get(key) {
      if (key === 'credentials') return { async resolve(ref) { return ref === 'typesafe' ? { value: 'from-store', source: 'file' } : undefined } }
      if (key === 'launchEnvironment') return { get: () => ({ value: 'from-env' }) }
      return undefined
    },
  }
  assert.deepEqual(await resolveApiKey(ctx), { ref: 'typesafe', source: 'file', value: 'from-store' })
  const envOnly = { get(key) { return key === 'launchEnvironment' ? { get: (name) => (name === 'TYPESAFE_API_KEY' ? { value: 'env' } : undefined) } : undefined } }
  assert.deepEqual(await resolveApiKey(envOnly), { ref: 'typesafe', source: 'launch-environment', value: 'env' })
  assert.equal(await resolveApiKey({ get() { return undefined } }), null)
})

await check('describeCredential reports configured/writable without a value', async () => {
  const ctx = {
    get(key) {
      if (key === 'credentials') return {
        async resolve() { return undefined },
        async describe() { return { configured: false, writable: true } },
      }
      return undefined
    },
  }
  const info = await describeCredential(ctx)
  assert.deepEqual(info, { configured: false, ref: null, source: null, writable: true })
})

console.log(failures === 0 ? '\nall host checks passed' : '\n' + failures + ' host check(s) failed')
if (failures > 0) process.exit(1)
