/**
 * Client-half checks for dsh-plugin-jev: drives the real bundle through the
 * same window.__ModuleLoader__.load factory the web shell uses, then asserts the
 * contribution directly — no renderer needed.
 *
 * The plugin is agent-facing, so the only browser contribution is the Settings
 * plugins tab (the API key + catalog); there is deliberately no composer-dock
 * pill under the chat.
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

await check('apply registers the Settings plugins tab and no composer dock', () => {
  const seen = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, contribute) => { contribute(); return () => {} },
      register: (options, component) => { seen.push({ options, component }); return () => {} },
    },
  }
  api.apply(ctx)
  assert.equal(seen.length, 1, 'exactly one slot contribution')
  const tab = seen[0]
  assert.equal(tab.options.name, 'settings.plugins.tab')
  assert.equal(tab.options.id, 'jev')
  assert.equal(tab.options.order, 40)
  assert.equal(tab.options.label, 'Jev (TypeSafe)')
  assert.equal(typeof tab.component, 'function')
  assert.equal(seen.find((entry) => entry.options.name === 'conversation.composer.dock'), undefined)
})

await check('the bundle source contains no composer dock wiring', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.doesNotMatch(source, /conversation\.composer\.dock/)
  assert.doesNotMatch(source, /JevDock/)
  assert.doesNotMatch(source, /dsh-client-ui-conversation/)
})

await check('the settings surface is exported', () => {
  assert.equal(typeof api.JevSettingsTab, 'function')
  assert.equal(typeof api.KeyMenu, 'function')
  assert.deepEqual(api.MODEL_FALLBACK, ['jev-latest', 'jev-preview', 'jev-1.13.0'])
})

console.log(failures === 0 ? '\nall client checks passed' : '\n' + failures + ' client check(s) failed')
if (failures > 0) process.exit(1)
