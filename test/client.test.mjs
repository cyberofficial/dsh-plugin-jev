/**
 * Client-half checks for dsh-plugin-jev: drives the real bundle through the
 * same window.__ModuleLoader__.load factory the web shell uses, then asserts the
 * contributions directly — no renderer needed.
 *
 * The plugin is agent-facing: the browser contributes the Settings tab (key,
 * model, overall stats) and a read-only per-chat stats chip. There is no query
 * console.
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

await check('apply registers the Settings tab and the composer-dock stats chip', () => {
  const seen = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, contribute) => { contribute(); return () => {} },
      register: (options, component) => { seen.push({ options, component }); return () => {} },
    },
  }
  api.apply(ctx)
  assert.equal(seen.length, 2, 'exactly two slot contributions')
  const tab = seen.find((entry) => entry.options.name === 'settings.plugins.tab')
  assert.ok(tab)
  assert.equal(tab.options.id, 'jev')
  assert.equal(tab.options.order, 40)
  assert.equal(tab.options.label, 'Jev (TypeSafe)')
  assert.equal(typeof tab.component, 'function')
  const dock = seen.find((entry) => entry.options.name === 'conversation.composer.dock')
  assert.ok(dock, 'dock stats chip registered')
  assert.equal(dock.options.id, 'jev-stats')
  assert.equal(typeof dock.component, 'function')
})

await check('the bundle carries no query-console wiring', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.doesNotMatch(source, /questionsFromForm|PRESETS|dshJevModal|dshJevAnswer/)
})

await check('the stats chip label is pure and total-aware', () => {
  assert.equal(api.formatJevStats({ calls: 0, costUsd: 0 }), null)
  assert.equal(api.formatJevStats(null), null)
  assert.equal(api.formatJevStats({ calls: 1, costUsd: 0.000019 }), 'Jev · 1 call · $0.000019')
  assert.equal(api.formatJevStats({ calls: 4, costUsd: 0.5 }), 'Jev · 4 calls · $0.5000')
})

await check('the dock chip renders nothing without a projection value', () => {
  assert.equal(api.JevStatsPill({ useProjection: () => undefined }), null)
  assert.equal(api.JEV_USAGE_KEY, 'jevUsage')
})

await check('formatting helpers read correctly', () => {
  assert.equal(api.formatTokens(312), '312')
  assert.equal(api.formatTokens(12400), '12.4k')
  assert.equal(api.formatCost(0), '$0')
  assert.ok(api.formatCost(312 * 4.2e-8).startsWith('$0.00001'))
  assert.equal(api.formatCost(NaN), '—')
})

await check('model fallback aliases are present', () => {
  assert.deepEqual(api.MODEL_FALLBACK, ['jev-latest', 'jev-preview', 'jev-1.13.0'])
})

console.log(failures === 0 ? '\nall client checks passed' : '\n' + failures + ' client check(s) failed')
if (failures > 0) process.exit(1)
