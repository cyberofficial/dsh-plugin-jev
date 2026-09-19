/**
 * Client-half checks for dsh-plugin-jev: drives the real bundle through the
 * same window.__ModuleLoader__.load factory the web shell uses, then asserts the
 * contributions and pure form helpers directly — no renderer needed.
 *
 * Usage: node test/client.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')

const registrations = []
globalThis.window = { __ModuleLoader__: { load: (record) => registrations.push(record) } }
globalThis.document = {
  documentElement: { lang: 'en' },
  visibilityState: 'visible',
  head: { appendChild: () => {} },
  createElement: () => ({ dataset: {}, textContent: '' }),
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
}

const React = () => {}
;(0, eval)(readFileSync(bundlePath, 'utf8'))

assert.equal(registrations.length, 1, 'bundle must register exactly one __ModuleLoader__ record')
const record = registrations[0]
assert.equal(record.id, 'dsh-plugin-jev')
const api = record.factory(() => React)
assert.equal(typeof api.apply, 'function')
assert.ok(api.inject.includes('slots'))

let failures = 0
async function check(label, fn) {
  try { await fn(); console.log('  ok   ' + label) }
  catch (error) { failures += 1; console.log('  FAIL ' + label + '\n       ' + (error.stack ?? error.message)) }
}

await check('apply registers the dock console and the Settings plugins tab', () => {
  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, contribute) => { contribute(); return () => {} },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  }
  api.apply(ctx)
  const dock = registrations.find((entry) => entry.options.name === 'conversation.composer.dock')
  const tab = registrations.find((entry) => entry.options.name === 'settings.plugins.tab')
  assert.ok(dock, 'dock entry registered')
  assert.equal(dock.options.id, 'jev')
  assert.equal(typeof dock.component, 'function')
  assert.ok(tab, 'settings tab registered')
  assert.equal(tab.options.label, 'Jev (TypeSafe)')
  assert.equal(typeof tab.component, 'function')
})

await check('questionsFromForm maps the default rows to the API shape', () => {
  const { questions } = api.questionsFromForm(api.defaultRows())
  assert.deepEqual(Object.keys(questions), ['is_urgent', 'topic', 'tone'])
  assert.equal(questions.is_urgent.type, 'noul')
  assert.deepEqual(questions.is_urgent.criteria, { true: 'Explicitly time-sensitive', false: 'No urgency expressed' })
  assert.deepEqual(questions.topic.criteria, { billing: 'payments, refunds, invoices', technical: 'bugs, outages, integrations', other: null })
  assert.deepEqual(questions.tone.criteria, ['Neutral', 'Mildly negative', 'Strongly negative'])
})

await check('questionsFromForm rejects malformed rows', () => {
  const base = () => [{ uid: 1, id: 'a', type: 'noul', instructions: 'x?' }]
  assert.throws(() => api.questionsFromForm([]), /at least one question/)
  assert.throws(() => api.questionsFromForm([{ uid: 1, id: '', type: 'noul', instructions: 'x?' }]), /needs an id/)
  assert.throws(() => api.questionsFromForm([{ uid: 1, id: 'a', type: 'noul', instructions: '  ' }]), /needs instructions/)
  assert.throws(() => api.questionsFromForm(base().concat([{ uid: 2, id: 'a', type: 'noul', instructions: 'y?' }])), /duplicate question id/)
  assert.throws(() => api.questionsFromForm([{ uid: 1, id: 'a', type: 'choice', instructions: 'x?', options: [{ key: '', desc: '' }] }]), /at least one option/)
  assert.throws(() => api.questionsFromForm([{ uid: 1, id: 'a', type: 'score', instructions: 'x?', levels: ['one'] }]), /at least two/)
})

await check('presets expand into complete rows', () => {
  assert.equal(api.PRESETS.length, 3)
  const rows = api.presetRows(api.PRESETS[0])
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => Number.isFinite(row.uid)))
  const { questions } = api.questionsFromForm(rows)
  assert.equal(questions.topic.type, 'choice')
  assert.equal(questions.tone.type, 'score')
})

await check('formatting helpers read correctly', () => {
  assert.equal(api.estimateTokens('abcd'), 1)
  assert.equal(api.estimateTokens(''), 0)
  assert.equal(api.formatTokens(312), '312')
  assert.equal(api.formatTokens(12400), '12.4k')
  assert.equal(api.formatPercent(0.92), '92%')
  assert.equal(api.formatPercent(0.159), '16%')
  assert.equal(api.formatCost(0), '$0')
  assert.ok(api.formatCost(312 * 4.2e-8).startsWith('$0.00001'))
  assert.equal(api.formatCost(NaN), '—')
})

await check('model fallback aliases are present', () => {
  assert.deepEqual(api.MODEL_FALLBACK, ['jev-latest', 'jev-preview', 'jev-1.13.0'])
})

console.log(failures === 0 ? '\nall client checks passed' : '\n' + failures + ' client check(s) failed')
if (failures > 0) process.exit(1)
