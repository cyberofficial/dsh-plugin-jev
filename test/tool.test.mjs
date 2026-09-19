/**
 * Agent-facing checks for dsh-plugin-jev: mounting the plugin registers exactly
 * one `jev_ask` tool plus its guidance section, the tool validates through the
 * same request builder as the route, it prices usage, and it renders calibrated
 * answers back to the model - while the HTTP routes are unaffected.
 *
 * Usage: node test/tool.test.mjs
 */
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
import { JEV_TOOL_NAME, JEV_TOOL_PROMPT_ORDER, formatJevAnswers, renderJevResult } from '../lib/tool.js'

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

function makeHarness(options = {}) {
  const stored = Object.assign({}, options.stored)
  const credentials = {
    async resolve(ref) { const value = stored[ref]; return value ? { value, source: 'file' } : undefined },
    async describe(ref) { return { configured: Object.prototype.hasOwnProperty.call(stored, ref), writable: true } },
  }
  const sections = []
  const toolDefs = []
  const ctx = {
    get(key) {
      if (key === 'credentials') return credentials
      if (key === 'launchEnvironment') return { get: () => undefined }
      return undefined
    },
    logger: { warn() {}, info() {}, error() {} },
    effect(fn) { fn() },
    webServer: { register: () => () => {} },
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    tools: { register: (definition) => { toolDefs.push(definition); return () => {} } },
  }
  apply(ctx, Object.assign({ baseURL: 'https://api.typesafe.ai/v1', fetchImpl: options.fetchImpl }, options.config))
  return { sections, toolDefs }
}

const REPLY = {
  model: 'jev-1.13.0',
  answers: {
    is_urgent: { type: 'noul', noul: 0.98 },
    department: { type: 'choice', choice: 'technical', confidence: 0.55, probabilities: { technical: 0.7, billing: 0.3, sales: 0 } },
    frustration: { type: 'score', score: 1, confidence: 1, legend: { 0: 'calm', 1: 'annoyed', 2: 'angry' }, probabilities: { 0: 0, 1: 1, 2: 0 } },
  },
  usage: { input_tokens: 453, output_tokens: 73 },
}
const ARGS = { state: 'Payouts failing for 3 days', questions: { is_urgent: { type: 'noul', instructions: 'Urgent?' } } }

await check('mounting registers one jev_ask tool and its guidance section', () => {
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => responseFor(200, REPLY) })
  assert.equal(harness.toolDefs.length, 1)
  assert.equal(harness.toolDefs[0].name, JEV_TOOL_NAME)
  assert.match(harness.toolDefs[0].description, /calibrated probabilities instead of a guess/)
  assert.equal(harness.sections.length, 1)
  assert.equal(harness.sections[0].name, 'tool:' + JEV_TOOL_NAME)
  assert.equal(harness.sections[0].order, JEV_TOOL_PROMPT_ORDER)
  assert.match(harness.sections[0].text, /default to calling jev_ask/)
  assert.match(harness.sections[0].text, /MAJORITY of substantive user questions/)
})

await check('execute validates, calls /systemone with the key, and omits the credential', async () => {
  const seen = []
  const harness = makeHarness({
    stored: { typesafe: 'test-key' },
    fetchImpl: async (url, options) => { seen.push({ url: String(url), options }); return responseFor(200, REPLY) },
  })
  const value = await harness.toolDefs[0].execute(ARGS)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(seen[0].options.headers.Authorization, 'Bearer test-key')
  const sent = JSON.parse(seen[0].options.body)
  assert.equal(sent.model, 'jev-latest')
  assert.equal(sent.state, ARGS.state)
  assert.deepEqual(sent.questions, ARGS.questions)
  assert.equal(value.model, 'jev-1.13.0')
  assert.equal(value.answers.department.choice, 'technical')
  assert.equal('credential' in value, false)
  assert.equal(typeof value.costUsd, 'number')
})

await check('render turns answers into model-facing probability lines', async () => {
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => responseFor(200, REPLY) })
  const tool = harness.toolDefs[0]
  const value = await tool.execute(ARGS)
  const blocks = tool.output.render(ARGS, value)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /Jev \(jev-1\.13\.0\) answered:/)
  assert.match(blocks[0].text, /\[noul\] -> TRUE \(p=0\.980\)/)
  assert.match(blocks[0].text, /\[choice\] -> technical/)
  assert.match(blocks[0].text, /probabilities: technical 0\.700, billing 0\.300/)
  assert.match(blocks[0].text, /\[score\] -> 1/)
  assert.match(blocks[0].text, /legend: 0="calm", 1="annoyed", 2="angry"/)
  assert.match(blocks[0].text, /453 input \/ 73 output tokens/)
})

await check('execute fails loudly without a key and never calls upstream', async () => {
  let called = 0
  const harness = makeHarness({ fetchImpl: async () => { called += 1; return responseFor(500, {}) } })
  await assert.rejects(() => harness.toolDefs[0].execute(ARGS), /API key is not set/)
  const code = await harness.toolDefs[0].execute(ARGS).then(() => null, (error) => error.code)
  assert.equal(code, 'no-key')
  assert.equal(called, 0)
})

await check('execute surfaces a malformed question without calling upstream', async () => {
  let called = 0
  const harness = makeHarness({ stored: { typesafe: 'k' }, fetchImpl: async () => { called += 1; return responseFor(200, REPLY) } })
  await assert.rejects(() => harness.toolDefs[0].execute({ state: 'x', questions: { a: { type: 'score', instructions: 'x', criteria: ['one'] } } }), /at least two/)
  assert.equal(called, 0)
})

await check('toolEnabled:false mounts no agent surface; toolName renames it', () => {
  const off = makeHarness({ stored: { typesafe: 'k' }, config: { toolEnabled: false }, fetchImpl: async () => responseFor(200, REPLY) })
  assert.equal(off.toolDefs.length, 0)
  assert.equal(off.sections.length, 0)
  const named = makeHarness({ stored: { typesafe: 'k' }, config: { toolName: 'jev' }, fetchImpl: async () => responseFor(200, REPLY) })
  assert.equal(named.toolDefs[0].name, 'jev')
  assert.equal(named.sections[0].name, 'tool:jev')
  assert.match(named.sections[0].text, /default to calling jev\b/)
})

await check('formatters tolerate sparse answers', () => {
  assert.match(formatJevAnswers({ a: { type: 'choice', choice: 'x', probabilities: {} } }), /a \[choice\] -> x \(p=n\/a\)/)
  assert.match(formatJevAnswers({ b: { type: 'weird' } }), /b \[weird\]:/)
  assert.match(renderJevResult({ model: 'm', answers: {}, usage: {}, costUsd: 0, elapsedMs: 5 }), /Jev \(m\) answered:/)
  assert.match(renderJevResult({}), /unknown model/)
})

console.log(failures === 0 ? '\nall tool checks passed' : '\n' + failures + ' tool check(s) failed')
if (failures > 0) process.exit(1)
