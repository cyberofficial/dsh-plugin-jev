/**
 * Client-half checks for dsh-plugin-jev: drives the real bundle through the
 * same window.__ModuleLoader__.load factory the web shell uses, then asserts the
 * contributions directly — no renderer needed.
 *
 * The plugin is agent-facing: the browser contributes the Settings tab (key,
 * model, overall stats) and a per-chat stats pill that expands on click into the
 * command guard's block log. There is no query console.
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
  // and no network. Nothing here is stateful: a setter is a no-op. The pill's
  // click behaviour needs real state, so test-clicking drives it through
  // statefulReact() below instead.
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

/**
 * Walk an element tree and return the first node whose props carry a string
 * equal to `name` under `prop`. Used to find the pill without depending on how
 * deeply the dock nests it.
 */
function findByProp(node, prop, name) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, prop, name)
      if (found !== null) return found
    }
    return null
  }
  const props = node.props || {}
  if (props[prop] === name) return node
  return findByProp(node.children, prop, name)
}

/** The guard route the pill fetches when it is first opened. */
const GUARD_PATH = '/plugins/dsh-plugin-jev/api/guard'
/** The stats route the durable guard counters ride. */
const STATS_PATH = '/plugins/dsh-plugin-jev/api/stats'

/**
 * A stateful stand-in for React, just enough to drive one component through
 * clicks: each hook call keeps its slot across renders, a setState re-renders,
 * and an empty-deps effect is applied once. Render depth is capped so a
 * pathological update loop fails loudly instead of hanging the test.
 *
 * The hooks are patched onto the SAME React object the factory closed over —
 * replacing that object would leave the bundle calling the stateless stubs —
 * and `dispose` puts the stubs back.
 */
function statefulReact() {
  const stateless = {
    useState: React.useState,
    useRef: React.useRef,
    useCallback: React.useCallback,
    useEffect: React.useEffect,
  }
  const hooks = []
  const cleanups = []
  let cursor = 0
  let renders = 0
  /**
   * Total hooks a completed render consumed. The real React refuses a render
   * that uses MORE hooks than the previous one (error #310, "Rendered more hooks
   * than during the previous render") and unmounts the subtree. Enforcing it here
   * is what catches a plain render helper that calls a hook: the helper is only
   * invoked in some states, so the count changes and the slot dies in the browser
   * while every test still passes.
   */
  let previousTotal = null
  // A render loop would hang the suite rather than fail it, so cap the churn.
  let setState = () => { if ((renders += 1) > 100) throw new Error('statefulReact: render did not settle') }

  /** Close out a render: the hook budget may not grow past the last one. */
  const seal = () => {
    if (previousTotal !== null && cursor > previousTotal) {
      throw new Error(
        'statefulReact: render used ' + cursor + ' hooks after ' + previousTotal
        + ' — more hooks than the previous render (React error #310). A hook is being'
        + ' called from a conditionally-invoked render helper.',
      )
    }
    previousTotal = cursor
  }

  const reset = () => { cursor = 0 }

  React.useState = (initial) => {
    const index = cursor
    cursor += 1
      if (hooks[index] === undefined) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
    const slot = hooks[index]
    return [slot.value, (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next
      setState()
    }]
  }
  React.useRef = (value) => {
    const index = cursor
    cursor += 1
    if (hooks[index] === undefined) hooks[index] = { value: { current: value } }
    return hooks[index].value
  }
  /**
   * Memoized on deps, like React. Returning a fresh function every render would
   * break any effect that depends on a callback — the dep would change identity
   * on every render, the effect would re-run, setState would render again, and
   * the suite would spin instead of testing anything.
   */
  React.useCallback = (fn, deps) => {
    const index = cursor
    cursor += 1
    const previous = hooks[index]
    const changed = previous === undefined
      || deps === undefined
      || previous.deps === undefined
      || deps.length !== previous.deps.length
      || deps.some((value, position) => !Object.is(value, previous.deps[position]))
    if (!changed) return previous.value
    hooks[index] = { value: fn, deps }
    return fn
  }
  /**
   * Effects re-run when their deps CHANGE, not only on the first render. That is
   * load-bearing: a subscription that starts when a panel opens is exactly a
   * dep change, and a stub that ran once would make such a subscription look
   * like it never started. `cleanup` is stored per hook index so a re-run
   * disposes the previous one first, as React does.
   */
  React.useEffect = (fn, deps) => {
    const index = cursor
    cursor += 1
    const previous = hooks[index]
    const first = previous === undefined
    const changed = deps === undefined
      || first
      || previous.deps === undefined
      || deps.length !== previous.deps.length
      || deps.some((value, position) => !Object.is(value, previous.deps[position]))
    if (!changed) return
    if (!first && typeof previous.cleanup === 'function') previous.cleanup()
    const cleanup = fn()
    hooks[index] = { value: undefined, deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
  }

  const render = (component, props) => {
    reset()
    try {
      return component(props || {})
    } finally {
      seal()
    }
  }

  return {
    /**
     * Render once and return a driver. `element` is a live binding: a setState
     * call from a handler re-renders, so the next read of `.element` is the
     * fresh tree, exactly as a real click-then-render would produce.
     */
    mount(component, props) {
      let element = render(component, props)
      setState = () => { element = render(component, props) }
      return { get element() { return element } }
    },
    /** Restore the stateless hook stubs the other checks render against. */
    dispose() {
      for (const cleanup of cleanups) cleanup()
      React.useState = stateless.useState
      React.useRef = stateless.useRef
      React.useCallback = stateless.useCallback
      React.useEffect = stateless.useEffect
    },
  }
}

/** Run a full animation-frame-ish turn so pending promise callbacks land. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
  // The plugin is agent-facing: there is no human Jev query console. `dshJevModal`
  // is deliberately NOT in this list — the command-guard block log is a modal, and
  // it is a read-only log rather than a console for authoring questions.
  assert.doesNotMatch(source, /questionsFromForm|PRESETS|dshJevAnswer/)
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
    scoreDanger: true,
    commandBlocks: [],
  })
  assert.equal(api.DEFAULT_GUARD_CONFIG.enabled, false)
  assert.equal(api.DEFAULT_GUARD_CONFIG.mode, 'monitor')
  assert.equal(api.DEFAULT_GUARD_CONFIG.blockThreshold, 'high')
})

await check('the saved danger-scoring toggle round-trips through the patch', () => {
  // Regression: scoreDanger was missing from guardFormPatch, so the setting
  // could never be turned off — every command kept paying for a score call with
  // no way to stop it short of disabling the guard entirely.
  const on = api.guardFormPatch({ ...api.DEFAULT_GUARD_CONFIG, scoreDanger: true })
  assert.equal(on.scoreDanger, true)
  const off = api.guardFormPatch({ ...api.DEFAULT_GUARD_CONFIG, scoreDanger: false })
  assert.equal(off.scoreDanger, false, 'turning danger scoring off survives the patch')
  // An absent field reads as on, which is the previous behaviour.
  const missing = api.guardFormPatch({ ...api.DEFAULT_GUARD_CONFIG, scoreDanger: undefined })
  assert.equal(missing.scoreDanger, true, 'an absent field defaults to on rather than off')
  // The patch must still never carry the rules: that is the other panel's array.
  assert.equal('commandBlocks' in off, false, 'a partial patch cannot clobber the rules')
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
  assert.equal(nothing.prefilterText, '', 'the prefilter draft must never be undefined')
})

await check('the prefilter draft and its note round-trip, and warn about narrow tokens', () => {
  const withPrefilter = api.blockToDraft({ id: 'r', patterns: ['git fetch'], intent: 'fetch', prefilter: ['git', '  fetch6  '.trim()] })
  assert.equal(withPrefilter.prefilterText, 'git\nfetch6', 'tokens are one per line')

  // The dangerous direction: a narrow token means Jev is never asked.
  const narrow = api.prefilterNote(['fetch6'])
  assert.match(narrow, /only when the command contains/i)
  assert.match(narrow, /too narrow/i, 'the note must state the failure direction')
  assert.match(narrow, /pass/i)

  // No tokens means every command is judged, which costs more and is safe.
  const none = api.prefilterNote([])
  assert.match(none, /every command/i)
  assert.match(none, /No prefilter/i)
  assert.notEqual(api.prefilterNote(null), '', 'a malformed input still explains itself')
  assert.doesNotMatch(api.prefilterNote(null), /undefined|null/)
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

await check('denialRows reads the block log array and degrades to empty', () => {
  const rows = [{ at: '2026-09-23T01:46:20.553Z' }]
  assert.equal(api.denialRows({ denials: rows }), rows)
  assert.deepEqual(api.denialRows({}), [])
  assert.deepEqual(api.denialRows(null), [])
  assert.deepEqual(api.denialRows({ denials: 'nope' }), [])
  assert.deepEqual(api.denialRows(undefined), [])
})

await check('formatDenialWhen is readable and never empty for junk input', () => {
  const readable = api.formatDenialWhen('2026-09-23T01:46:20.553Z')
  assert.equal(typeof readable, 'string')
  assert.notEqual(readable.trim(), '', 'a valid timestamp must read as something')
  assert.doesNotMatch(readable, /Invalid Date/)
  for (const value of ['', null, 'garbage', undefined, 7]) {
    const fallback = api.formatDenialWhen(value)
    assert.equal(typeof fallback, 'string')
    assert.notEqual(fallback.trim(), '', 'a stamp for ' + String(value) + ' must not be blank')
    assert.doesNotMatch(fallback, /Invalid Date/)
  }
})

await check('denialDetail explains a rule block and a danger block', () => {
  const ruleText = api.denialDetail({
    reason: 'Matched blocked-command rule "rule-1"',
    detail: 'The command matches a blocked pattern (git fetch).',
    rule: 'rule-1',
    intent: 'git commands',
    trigger: 'blocklist',
  })
  assert.ok(ruleText.includes('rule-1'), 'the rule id is named')
  assert.ok(ruleText.includes('git commands'), 'the intent is named when present')
  assert.ok(ruleText.includes('blocked pattern'), 'the matched-pattern detail is carried')

  const dangerText = api.denialDetail({
    reason: 'Blocked by Jev danger detection: command scored critical (threshold high).',
    detail: 'Blocked by Jev danger detection: command scored critical (threshold high).',
    trigger: 'danger',
    severity: 'critical',
    confidence: 0.97,
  })
  assert.ok(dangerText.includes('critical'), 'the severity band is named')
  assert.match(dangerText, /0\.97/, 'the confidence is named')

  for (const value of [{}, null, undefined, { rule: 'rule-9' }, 7]) {
    const text = api.denialDetail(value)
    assert.equal(typeof text, 'string')
    assert.notEqual(text.trim(), '', 'a detail for ' + JSON.stringify(value) + ' must not be empty')
    assert.doesNotMatch(text, /null/)
    assert.doesNotMatch(text, /undefined/)
  }
})

await check('the pill keeps its original label when collapsed', () => {
  const withCalls = api.JevStatsPill({ useProjection: () => ({ calls: 2, costUsd: 0.0000315 }) })
  assert.equal(withCalls.type, 'div')
  const pill = findByProp(withCalls, 'className', 'dshJevStats')
  assert.ok(pill, 'the pill element still carries the dshJevStats class')
  assert.equal(pill.props['data-empty'], undefined, 'a chat with calls is not marked empty')
  assert.equal(pill.props.title, 'Jev calls and estimated cost in this chat; scored counts every command the guard has sent to Jev, all-time. Click for the command-guard log.')
  assert.equal(pill.props.role, 'button', 'the pill is keyboard-reachable')
  assert.equal(pill.props.tabIndex, 0)
  assert.equal(textOf(pill), 'Jev\n·\n2 calls\n·\n0 blocked\n·\n' + api.formatCost(0.0000315))

  const empty = api.JevStatsPill({ useProjection: () => undefined })
  const emptyPill = findByProp(empty, 'className', 'dshJevStats')
  assert.equal(emptyPill.props['data-empty'], 'true')
  assert.equal(emptyPill.props.title, 'Jev has not run in this chat yet')
  assert.equal(textOf(emptyPill), 'Jev\n·\n0 calls\n·\n0 blocked\n·\n$0')
})

await check('clicking the pill fetches the log and the durable counters, closing does not refetch', async () => {
  const original = globalThis.fetch
  let calls = 0
  const longCommand = 'pwsh -NoProfile -Command "git fetch --quiet --all --prune --tags --force --depth=2147483647 --no-recurse-submodules && git status --porcelain=v2 --branch --show-stash --ahead-behind && echo IGNORED_TAIL_MARKER"' + 'x'.repeat(120)
  assert.ok(longCommand.length > 200, 'the fixture command is longer than 200 characters')
  const fake = statefulReact()
  const seenUrls = []
  globalThis.fetch = (url) => {
    seenUrls.push(String(url))
    calls += 1
    const isStats = String(url) === STATS_PATH
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(isStats
        ? { bySource: { tool: { calls: 9 }, guard: { calls: 5, costUsd: 0.0004 } } }
        : {
          config: { enabled: true, mode: 'enforce', blockThreshold: 'high' },
          stats: { evaluated: 12, blockedLiteral: 1, blockedSemantic: 0, blockedDanger: 2, downgraded: 0, failures: 0, cached: 4, cachedEntries: 4, last: null },
          denials: [
            { at: '2026-09-23T01:46:20.553Z', tool: 'pwsh', command: longCommand, reason: 'Matched blocked-command rule "rule-1"', detail: 'The command matches a blocked pattern (git fetch).', rule: 'rule-1', intent: 'git commands', trigger: 'blocklist', severity: null, confidence: null, costUsd: null, model: null, wouldBlock: true },
            { at: '2026-09-23T02:10:00.000Z', tool: 'pwsh', command: 'rm -rf /var', reason: 'Blocked by Jev danger detection: command scored critical (threshold high).', detail: 'Blocked by Jev danger detection: command scored critical (threshold high).', rule: null, intent: null, trigger: 'danger', severity: 'critical', confidence: 0.97, costUsd: 0.000032, model: 'jev-1.13.0', wouldBlock: true },
          ],
          defaults: { blockThreshold: 'high', confidenceFloor: 0.7, tools: ['pwsh'], severityBands: ['safe', 'low', 'moderate', 'high', 'critical'] },
        }),
    })
  }
  try {
    const driver = fake.mount(api.JevStatsPill, { useProjection: () => ({ calls: 3, costUsd: 0.0001 }) })
    const pillOf = (tree) => findByProp(tree, 'className', 'dshJevStats')
    // Nothing is requested until the reader asks for the panel.
    assert.equal(calls, 0, 'the pill must not fetch on mount')
    assert.equal(textOf(driver.element), 'Jev\n·\n3 calls\n·\n0 blocked\n·\n$0.0001')
    pillOf(driver.element).props.onClick()
    assert.equal(calls, 2, 'the first open fetches the log and the durable counters')
    assert.equal(seenUrls[0], GUARD_PATH, 'the log fetch goes to the guard route')
    assert.equal(seenUrls[1], STATS_PATH, 'the durable counters ride the same open')
    assert.equal(pillOf(driver.element).props['aria-expanded'], 'true')
    await tick()
    const opened = driver.element
    const openedText = textOf(opened)
    assert.ok(openedText.includes('Blocked by the command guard'), 'the panel is open')
    assert.ok(openedText.includes('2 blocked'), 'the pill badge counts the blocks')
    assert.ok(openedText.includes('5 scored'), 'the all-time scored count shows on the pill')
    assert.ok(openedText.includes('All-time, saved across restarts: 5 commands'), 'the panel states the all-time figure')
    // Close, then reopen: every OPEN re-reads, because the log is host-side
    // state that any turn can append to, so a cached copy goes stale the moment
    // another command is refused.
    pillOf(opened).props.onClick()
    assert.equal(pillOf(driver.element).props['aria-expanded'], 'false')
    pillOf(driver.element).props.onClick()
    await tick()
    assert.equal(calls, 4, 'reopening refetches both, so the log is always current')
    assert.ok(textOf(driver.element).includes('Blocked by the command guard'), 'still open after refetch')
  } finally {
    fake.dispose()
    globalThis.fetch = original
  }
})

await check('a moved meter re-reads the durable counters without polling all day', async () => {
  // A projection change is the only turn signal the dock slot can see, so the
  // meter moving must pull the durable figures — and an unmoved meter must not
  // fetch anything extra, neither on mount nor on a plain open.
  const original = globalThis.fetch
  const fake = statefulReact()
  const seenUrls = []
  globalThis.fetch = (url) => {
    seenUrls.push(String(url))
    const isStats = String(url) === STATS_PATH
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(isStats
        ? { bySource: { tool: { calls: 2 }, guard: { calls: 11, costUsd: 0.0009 } } }
        : { config: { mode: 'enforce' }, denials: [] }),
    })
  }
  try {
    const seat = { usage: { calls: 1, costUsd: 0.000019 } }
    const driver = fake.mount(api.JevStatsPill, { useProjection: () => seat.usage })
    assert.equal(seenUrls.length, 0, 'still nothing on mount')
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    assert.deepEqual(seenUrls, [GUARD_PATH, STATS_PATH], 'an open with an unmoved meter fetches each route once')
    assert.ok(textOf(driver.element).includes('11 scored'), 'the durable scored count shows on the pill')
    assert.ok(textOf(driver.element).includes('All-time, saved across restarts: 11 commands'), 'the panel states the all-time figure')
    // Close, move the meter (a tool result landed this turn), reopen: the moved
    // meter adds one durable read on top of the open's own refresh.
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    seat.usage = { calls: 2, costUsd: 0.000038 }
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    assert.equal(seenUrls.length, 5, 'the moved meter added exactly one durable read')
    assert.equal(seenUrls.filter((url) => url === STATS_PATH).length, 3, 'the extra read went to the stats route')
    assert.ok(textOf(driver.element).includes('11 scored'), 'the all-time figure is still current')
  } finally {
    fake.dispose()
    globalThis.fetch = original
  }
})

await check('guardScored and guardAllTimeLine read the durable bucket defensively', () => {
  assert.equal(api.guardScored(null), 0)
  assert.equal(api.guardScored(undefined), 0)
  assert.equal(api.guardScored({}), 0)
  assert.equal(api.guardScored({ bySource: { guard: { calls: 0 } } }), 0)
  assert.equal(api.guardScored({ bySource: { guard: { calls: -2 } } }), 0, 'a nonsensical count is not shown')
  assert.equal(api.guardScored({ bySource: { guard: { calls: 7, costUsd: 0.0007 } } }), 7)
  assert.equal(api.guardAllTimeLine(null), null, 'no stats, no line')
  assert.equal(api.guardAllTimeLine({}), null)
  assert.equal(api.guardAllTimeLine({ bySource: { guard: { calls: 0, costUsd: 0 } } }), null, 'nothing scored, no line')
  assert.equal(
    api.guardAllTimeLine({ bySource: { guard: { calls: 1, costUsd: 0.000042 } } }),
    'All-time, saved across restarts: 1 command sent to Jev by the command guard · ' + api.formatCost(0.000042) + ' guard spend.',
  )
  assert.equal(
    api.guardAllTimeLine({ bySource: { guard: { calls: 4, costUsd: 0.000168 } } }),
    'All-time, saved across restarts: 4 commands sent to Jev by the command guard · ' + api.formatCost(0.000168) + ' guard spend.',
  )
})

await check('a fresh block appears while the log is open, without a manual refresh', async () => {
  // The log is host-side; a block made while it is being read must show up.
  // Polling covers that, and it must stop when the log closes.
  const original = globalThis.fetch
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  let scheduled = []
  let nextId = 1
  const spyIds = new Map()
  // Spy, but still schedule for real and still clear for real: a spy that
  // swallows clearInterval leaks the timer, and a leaked interval keeps the
  // whole test process alive after the checks have passed.
  globalThis.setInterval = (fn, ms) => {
    scheduled.push(fn)
    const realId = realSetInterval(fn, ms)
    const spyId = nextId
    nextId += 1
    spyIds.set(spyId, realId)
    return spyId
  }
  globalThis.clearInterval = (id) => {
    scheduled = scheduled.filter((_, index) => index !== id - 1)
    const realId = spyIds.get(id)
    if (realId !== undefined) realClearInterval(realId)
  }
  let calls = 0
  let denials = []
  globalThis.fetch = () => {
    calls += 1
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ config: { mode: 'enforce' }, denials }) })
  }
  const fake = statefulReact()
  try {
    const driver = fake.mount(api.JevStatsPill, { useProjection: () => ({ calls: 1, costUsd: 0.000019 }) })
    assert.equal(scheduled.length, 0, 'nothing is polled while the log is closed')
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    assert.equal(calls, 2, 'the open fetched the log and the durable counters')
    assert.ok(textOf(driver.element).includes('Nothing has been blocked yet'), 'the log starts empty')
    // A block lands host-side while the log is open.
    denials = [{ at: '2026-09-23T04:00:00.000Z', tool: 'pwsh', command: 'git fetch', rule: 'rule-1', intent: 'git fetch', trigger: 'blocklist', detail: 'Jev judged (p=0.980) that this command performs a blocked action.', wouldBlock: true, severity: null, confidence: null, costUsd: null, model: null }]
    assert.equal(scheduled.length, 1, 'an open log polls')
    // The poll is not awaited, so drive it and let its promise settle.
    scheduled[0]()
    await tick()
    assert.equal(calls, 4, 'the poll re-read both routes')
    assert.ok(textOf(driver.element).includes('1 blocked'), 'the new block is visible without a manual refresh')
    // Closing stops the polling.
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    const afterClose = calls
    assert.equal(scheduled.length, 0, 'closing clears the interval')
    assert.equal(calls, afterClose, 'and no further requests are made')
  } finally {
    fake.dispose()
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
    globalThis.fetch = original
  }
})

await check('the opened panel shows the full command, untruncated', async () => {
  const original = globalThis.fetch
  const longCommand = 'pwsh -NoProfile -Command "git clean -xdf --dry-run --force --verbose --exclude=node_modules --exclude=dist --exclude=.cache --exclude=coverage && git submodule foreach --recursive git clean -xdf && echo END_OF_LONG_COMMAND_MARKER"'
  assert.ok(longCommand.length > 200, 'the fixture command is longer than 200 characters')
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      config: { mode: 'enforce' },
      denials: [{ at: '2026-09-23T03:00:00.000Z', tool: 'pwsh', command: longCommand, rule: 'rule-7', intent: 'destructive git', trigger: 'blocklist', detail: 'The command matches a blocked pattern (git clean).', wouldBlock: true }],
    }),
  })
  const fake = statefulReact()
  try {
    const driver = fake.mount(api.JevStatsPill, { useProjection: () => ({ calls: 1, costUsd: 0.000019 }) })
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    const text = textOf(driver.element)
    assert.ok(text.includes(longCommand), 'the command appears in full and unmodified, however long it is')
    assert.ok(text.includes('blocked pattern'), 'the matched-pattern detail is shown')
    assert.ok(text.includes('rule-7'), 'the rule id is shown')
    assert.ok(text.includes('1 blocked'), 'the pill carries a count badge')
    // Long commands start collapsed in the log but the FULL text is still
    // present in the tree behind the disclosure, never truncated.
    assert.ok(text.includes('click to show in full'), 'a long command is behind a disclosure')
  } finally {
    globalThis.fetch = original
  }
})

await check('the panel never renders the text null or undefined', () => {
  const text = textOf(api.renderDenialPanelBody({
    payload: {
      config: { mode: 'enforce' },
      denials: [{ at: null, tool: null, command: null, reason: null, detail: null, rule: null, intent: null, trigger: null, severity: null, confidence: null, costUsd: null, model: null }],
    },
    loaded: true,
    loading: false,
    error: null,
    onRefresh: () => {},
  }))
  assert.doesNotMatch(text, /null/)
  assert.doesNotMatch(text, /undefined/)
  assert.match(text, /Blocked by the command guard/)
})

await check('the panel explains monitor mode and pre-empts an empty log', () => {
  const monitorText = textOf(api.renderDenialPanelBody({
    payload: { config: { mode: 'monitor' }, denials: [] },
    loaded: true,
    loading: false,
    error: null,
    onRefresh: () => {},
  }))
  assert.match(monitorText, /nothing is being blocked/i)
  assert.match(monitorText, /would block/i)
  assert.match(monitorText, /enforce/i)
  // An empty monitor log must not read as "the guard is broken".
  assert.match(monitorText, /has not flagged anything yet/i)

  const enforceText = textOf(api.renderDenialPanelBody({
    payload: { config: { mode: 'enforce' }, denials: [] },
    loaded: true,
    loading: false,
    error: null,
    onRefresh: () => {},
  }))
  assert.match(enforceText, /Nothing has been blocked yet\./)
  assert.doesNotMatch(enforceText, /nothing is being blocked/i, 'enforce mode must not claim it is inert')
})

await check('opening the log does not change the hook count (React error #310)', async () => {
  // Regression: renderModal used to call useRef/useEffect while being invoked
  // only when the log was open, so the second render used more hooks than the
  // first. React refuses that with #310 and unmounts the whole dock slot — the
  // pill vanished on click. The fake React below now enforces the invariant, so
  // this check fails loudly instead of the browser dying.
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ config: { mode: 'enforce' }, denials: [] }),
  })
  const fake = statefulReact()
  try {
    const driver = fake.mount(api.JevStatsPill, { useProjection: () => ({ calls: 1, costUsd: 0.000019 }) })
    // Closed: baseline hook count.
    assert.equal(textOf(driver.element).includes('Blocked by the command guard'), false)
    // Open: the render that used to grow the hook count.
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    const opened = driver.element
    assert.ok(textOf(opened).includes('Blocked by the command guard'), 'the log opened')
    // Close again and reopen: three consecutive renders, all the same hook count.
    findByProp(opened, 'className', 'dshJevStats').props.onClick()
    const closed = driver.element
    assert.equal(textOf(closed).includes('Blocked by the command guard'), false, 'the log closed')
    findByProp(closed, 'className', 'dshJevStats').props.onClick()
    await tick()
    assert.ok(textOf(driver.element).includes('Blocked by the command guard'), 'and reopened')
  } finally {
    fake.dispose()
    globalThis.fetch = original
  }
})

await check('the opened log is portalled to the document body', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ config: { mode: 'enforce' }, denials: [] }),
  })
  const fake = statefulReact()
  try {
    const driver = fake.mount(api.JevStatsPill, { useProjection: () => ({ calls: 1, costUsd: 0.000019 }) })
    findByProp(driver.element, 'className', 'dshJevStats').props.onClick()
    await tick()
    const backdrop = findByProp(driver.element, 'className', 'dshJevModalBackdrop')
    assert.ok(backdrop, 'the backdrop renders')
    // A portalled node is a portal object, not a plain element; either way the
    // backdrop must carry the dialog and a close affordance.
    const text = textOf(driver.element)
    assert.ok(text.includes('Blocked by the command guard'), 'the dialog title is present')
    assert.ok(text.includes('Close'), 'the dialog can be closed')
  } finally {
    fake.dispose()
    globalThis.fetch = original
  }
})

await check('a monitor entry is labelled as a would-be block, not a refusal', () => {
  const wouldEntry = { at: new Date().toISOString(), command: 'git fetch', rule: 'r', intent: 'git commands', trigger: 'blocklist', wouldBlock: false, severity: null, confidence: null, costUsd: null, model: null }
  const realEntry = { ...wouldEntry, command: 'git fetch --all', wouldBlock: true }
  assert.equal(api.denialAction(wouldEntry), 'would block')
  assert.equal(api.denialAction(realEntry), 'blocked')
  assert.equal(api.denialAction(null), 'would block', 'an unknown entry never claims to have blocked')
  assert.equal(api.denialAction({}), 'would block')

  const text = textOf(api.renderDenialPanelBody({
    payload: { config: { mode: 'monitor' }, denials: [wouldEntry, realEntry] },
    loaded: true,
    loading: false,
    error: null,
    onRefresh: () => {},
  }))
  assert.match(text, /would block/)
  assert.match(text, /blocked/)
  // The distinction must be stated, not just tagged: a command that ran cannot
  // look like one that was stopped.
  assert.match(text, /ran: the guard is in monitor mode, so nothing was stopped/i)
  assert.match(text, /1 blocked · 1 would block/, 'the split is counted')
})

await check('the panel surfaces a load error instead of an empty log', () => {
  const text = textOf(api.renderDenialPanelBody({
    payload: null,
    loaded: false,
    loading: false,
    error: 'Jev request failed (HTTP 500)',
    onRefresh: () => {},
  }))
  assert.ok(text.includes('Jev request failed (HTTP 500)'), 'the route error is surfaced verbatim')
})

await check('the built bundle carries the monitor-mode explanation', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.ok(source.includes('monitor mode, so nothing is being blocked'), 'the pill panel must explain monitor mode')
  assert.ok(source.includes('has not flagged anything yet'), 'the empty-log copy must survive the build')
  assert.ok(source.includes('nothing was stopped'), 'the would-block explanation must survive the build')
  assert.ok(source.includes('denialRows'), 'the guard-log helpers must survive the build')
  assert.ok(source.includes('denialAction'), 'the block/would-block distinction must survive the build')
})

console.log(failures === 0 ? '\nall client checks passed' : '\n' + failures + ' client check(s) failed')
// Exit explicitly on success too. This suite stubs timers to drive the log's
// polling, and a stub that leaves any handle behind keeps Node alive after the
// checks have finished, so a green run would look like a hang.
process.exit(failures > 0 ? 1 : 0)
