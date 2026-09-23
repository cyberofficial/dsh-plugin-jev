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

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  // Just enough hook surface for JevSettingsTab to render once with its initial
  // state and no effects, so the element tree can be inspected with no renderer
  // and no network. Nothing here is stateful: a setter is a no-op.
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useEffect: () => {},
}
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

/**
 * Every string in an element tree, joined. Component functions are not invoked
 * by the fake createElement, so a function-typed node is called with its props
 * and walked — that way the assertion holds whether a section is inlined in the
 * tab or lives in a sub-component.
 */
function textOf(node) {
  const out = []
  const walk = (value) => {
    if (value === null || value === undefined || typeof value === 'boolean') return
    if (typeof value === 'string' || typeof value === 'number') { out.push(String(value)); return }
    if (Array.isArray(value)) { for (const child of value) walk(child); return }
    if (typeof value !== 'object') return
    if (typeof value.type === 'function') { walk(value.type(value.props || {})); return }
    walk(value.children)
  }
  walk(node)
  return out.join('\n')
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

await check('the stats chip label is pure, total-aware, and never empty', () => {
  assert.equal(api.formatJevStats({ calls: 0, costUsd: 0 }), 'Jev · 0 calls · $0')
  assert.equal(api.formatJevStats(null), 'Jev · 0 calls · $0')
  assert.equal(api.formatJevStats({ calls: 1, costUsd: 0.000019 }), 'Jev · 1 call · $0.000019')
  assert.equal(api.formatJevStats({ calls: 4, costUsd: 0.5 }), 'Jev · 4 calls · $0.5000')
})

await check('the dock chip always renders, even with no calls', () => {
  const empty = api.JevStatsPill({ useProjection: () => undefined })
  assert.ok(empty, 'chip renders before any call')
  assert.equal(empty.type, 'div')
  const withCalls = api.JevStatsPill({ useProjection: () => ({ calls: 2, costUsd: 0.0000315 }) })
  assert.ok(withCalls)
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

await check('the guard defaults ship in monitor mode with nothing blocked', () => {
  assert.deepEqual(api.DEFAULT_GUARD_CONFIG, {
    enabled: false,
    mode: 'monitor',
    blockThreshold: 'high',
    blockIrreversible: true,
    confidenceFloor: 0.7,
    tools: ['pwsh', 'bash', 'pwsh_persistent', 'bash_persistent'],
    scoreNested: true,
    commandBlocks: [],
  })
  assert.equal(api.DEFAULT_GUARD_CONFIG.enabled, false)
  assert.equal(api.DEFAULT_GUARD_CONFIG.mode, 'monitor')
  assert.equal(api.DEFAULT_GUARD_CONFIG.blockThreshold, 'high')
})

await check('the severity scale is the five bands, in order', () => {
  assert.deepEqual(api.SEVERITY_BANDS, ['safe', 'low', 'moderate', 'high', 'critical'])
})

await check('guardLabelFor names both modes and never returns empty', () => {
  assert.equal(api.guardLabelFor('monitor'), 'Log only (nothing blocked)')
  assert.equal(api.guardLabelFor('enforce'), 'Blocking')
  for (const value of [undefined, null, '', 'nonsense', 7]) {
    const label = api.guardLabelFor(value)
    assert.equal(typeof label, 'string')
    assert.notEqual(label.trim(), '', 'a label for ' + String(value) + ' must not be empty')
  }
})

await check('blockToDraft turns a rule into a form draft, patterns one per line', () => {
  const draft = api.blockToDraft({
    id: 'no-commit',
    intent: 'Commit or push changes to a git repository',
    patterns: ['git commit', 'git push'],
    scope: 'workspace',
    absolute: true,
    enabled: false,
  })
  assert.equal(draft.id, 'no-commit')
  assert.equal(draft.intent, 'Commit or push changes to a git repository')
  assert.equal(draft.patternsText, 'git commit\ngit push')
  assert.equal(draft.scope, 'workspace')
  assert.equal(draft.absolute, true)
  assert.equal(draft.enabled, false)

  const noPatterns = api.blockToDraft({ id: 'x', intent: 'Delete the build output' })
  assert.equal(noPatterns.patternsText, '')
  assert.equal(noPatterns.scope, 'global')
  assert.equal(noPatterns.absolute, false)
  assert.equal(noPatterns.enabled, true)

  const nothing = api.blockToDraft(null)
  assert.equal(nothing.patternsText, '')
  assert.equal(nothing.intent, '')
  assert.equal(nothing.id, '')
})

await check('matchRuleNote states the substring semantics and is never empty', () => {
  const note = api.matchRuleNote('git push')
  assert.ok(note.includes('git push'), 'the note names its own pattern')
  assert.match(note, /substring/i)
  for (const value of ['', '   ', undefined, null]) {
    const fallback = api.matchRuleNote(value)
    assert.equal(typeof fallback, 'string')
    assert.notEqual(fallback.trim(), '', 'a note for ' + String(value) + ' must not be empty')
  }
})

await check('the built bundle carries the substring-matching warning', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.ok(source.includes('--dry-run'), 'the git push --dry-run example must survive the build')
  assert.match(source, /case-insensitive/i)
  assert.match(source, /substring/i)
})

await check('the Settings tab renders both guard panels and their copy', () => {
  const text = textOf(api.JevSettingsTab({}))
  assert.ok(text.includes('Tool danger detection'), 'danger-detection panel heading')
  assert.ok(text.includes('Blocked commands'), 'blocked-commands panel heading')
  assert.ok(text.includes('In monitor mode nothing is blocked'), 'monitor-vs-enforce copy')
  assert.ok(text.includes('shipped default is monitor'), 'the default-posture note')
  assert.ok(text.includes('git push --dry-run'), 'the substring caveat is adjacent to the patterns field')
  assert.ok(text.includes('fail closed'), 'the absolute fail-mode is explained')
  assert.match(text, /git commit/, 'the two-layer explanation names an obfuscated form')
})

console.log(failures === 0 ? '\nall client checks passed' : '\n' + failures + ' client check(s) failed')
if (failures > 0) process.exit(1)
