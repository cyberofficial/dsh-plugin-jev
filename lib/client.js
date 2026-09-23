/*
 * Browser half of the TypeSafe Jev plugin — GENERATED FILE.
 *
 * Built verbatim from src/client.template.js by scripts/build-client.mjs; do not
 * edit lib/client.js directly. Edit the template and rebuild.
 *
 * Two contributions:
 *   - a "Jev (TypeSafe)" tab in settings.plugins.tab: API key, model choice,
 *     overall usage totals, the model catalog the key unlocks, the tool-danger
 *     guard (its thresholds and counters), and the blocked-command rules; and
 *   - a per-chat stats pill in conversation.composer.dock showing how many times
 *     Jev ran in THIS chat and what it cost, which expands on click into the
 *     command guard's block log — what the guard actually refused, why, and when.
 * The plugin is agent-facing — the model calls the host's jev_ask tool on its
 * own — so there is no human query console. No credential ever reaches this
 * file; only same-origin host routes do.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-jev',
  factory: (require) => {
    const React = require('react')
    // A portal into document.body is how this UI renders every overlay (the
    // harness's own Modal, Menu, StatsPills and ContextMeter all do it). It is
    // not optional in practice: the composer dock sits inside the conversation
    // layout, and an overlay left in that subtree is clipped, or lands behind
    // the dock's own stacking context, which makes the trigger look like it
    // vanished. Resolved defensively so a host that does not expose react-dom
    // degrades to an inline overlay instead of failing the whole bundle.
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (reactDom !== null && reactDom !== undefined && typeof reactDom.createPortal === 'function') {
        createPortal = reactDom.createPortal
      }
    } catch {
      createPortal = null
    }

    const ROUTE_BASE = '/plugins/dsh-plugin-jev/api'
    const MODELS_ROUTE = ROUTE_BASE + '/models'
    const STATUS_ROUTE = ROUTE_BASE + '/status'
    const KEY_ROUTE = ROUTE_BASE + '/key'
    const SETTINGS_ROUTE = ROUTE_BASE + '/settings'
    const STATS_ROUTE = ROUTE_BASE + '/stats'

    /** The session projection key the dock chip reads. */
    const JEV_USAGE_KEY = 'jevUsage'

    const MODEL_FALLBACK = ['jev-latest', 'jev-preview', 'jev-1.13.0']

    /**
     * Above this length (or any multi-line command) the command starts collapsed
     * inside the log. It is still shown in full once expanded — the disclosure
     * exists so a wrapper script that merely contains a blocked call does not
     * push every other entry off screen.
     */
    const COMMAND_COLLAPSE_CHARS = 160

    /**
     * How often the OPEN log re-reads itself. The log is host-side state that any
     * turn can append to, so a block made while it is being read should appear
     * without a manual Refresh. Only runs while the log is open.
     */
    const GUARD_POLL_MS = 3000

    /** The tool-guard route: GET the config and counters, POST a config patch. */
    const GUARD_ROUTE = ROUTE_BASE + '/guard'

    /** The severity bands, ordered. Mirrors lib/guard.js on the host. */
    const SEVERITY_BANDS = ['safe', 'low', 'moderate', 'high', 'critical']

    /** Guard modes. `monitor` records decisions; `enforce` blocks on them. */
    const GUARD_MODES = ['monitor', 'enforce']

    /** Rule scopes. A `workspace` rule applies at this project's root only. */
    const RULE_SCOPES = ['global', 'workspace']

    /**
     * The shipped guard config, mirroring the host's defaultGuardConfig(). The
     * browser keeps its own copy so both panels render real controls before the
     * first GET resolves — and still render when that GET fails.
     */
    const DEFAULT_GUARD_CONFIG = {
      enabled: false,
      mode: 'monitor',
      blockThreshold: 'high',
      blockIrreversible: true,
      confidenceFloor: 0.7,
      tools: ['pwsh', 'bash', 'pwsh_persistent', 'bash_persistent'],
      scoreNested: true,
      // Whether the danger score runs at all. Must be in this object AND in the
      // saved patch: while it was missing from the patch it could never be
      // turned off, so every command paid for a scoring call with no way to stop
      // it short of disabling the guard entirely.
      scoreDanger: true,
      commandBlocks: [],
    }

    /** A blank rule, as the add form holds it. */
    const EMPTY_BLOCK_DRAFT = { id: '', intent: '', patternsText: '', prefilterText: '', scope: 'global', absolute: false, enabled: true }

    const CSS = [
      '.dshJevSection{display:flex;flex-direction:column;gap:6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px}',
      '.dshJevSection>h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-caption);text-transform:uppercase;letter-spacing:.03em}',
      '.dshJevRow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.dshJevRow input,.dshJevRow select{background:var(--dsw-alias-input-bg,#12151e);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font-size:12px;box-sizing:border-box}',
      '.dshJevGrow{flex:1;min-width:140px}',
      '.dshJevBtn{background:var(--dsw-alias-accent,var(--dsw-alias-state-accent,#5b8def));color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer}',
      '.dshJevBtn:disabled{opacity:.5;cursor:not-allowed}',
      '.dshJevBtn.ghost{background:0 0;color:var(--dsw-alias-label-caption);border:.5px solid var(--dsw-alias-border-l1);font-weight:400}',
      '.dshJevHint{color:var(--dsw-alias-label-caption);font-size:11px}',
      '.dshJevErr{color:var(--dsw-alias-state-danger-primary,#ef6b6b);font-size:12px;white-space:pre-wrap}',
      '.dshJevOk{color:var(--dsw-alias-state-success-primary,#3dd68c);font-size:12px}',
      '.dshJevKey{display:flex;gap:6px;padding:2px 0;align-items:center;flex-wrap:wrap}',
      '.dshJevKey input{flex:1;min-width:200px;background:var(--dsw-alias-input-bg,#12151e);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.dshJevStats{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 9px;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums;background:0 0}',
      '.dshJevStatsName{color:var(--dsw-alias-label-secondary);font-weight:600}',
      '.dshJevStats[data-empty=true]{opacity:.6}',
      '.dshJevStatsSep{color:var(--dsw-alias-separator-primary)}',
      '.dshJevDock{display:flex;justify-content:center;width:100%;order:30;padding:0 0 4px}',
      '.dshJevStatGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px}',
      '.dshJevStat{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;gap:2px}',
      '.dshJevStat>b{color:var(--dsw-alias-label-primary);font-size:14px;font-variant-numeric:tabular-nums}',
      '.dshJevStat>span{color:var(--dsw-alias-label-caption);font-size:11px}',
      '.dshJevModelList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}',
      '.dshJevModel{display:flex;justify-content:space-between;gap:8px;font-size:12px}',
      '.dshJevModel b{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:500}',
      '.dshJevModel span{color:var(--dsw-alias-label-caption)}',
      '.dshJevCheck{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dshJevCheck input{accent-color:var(--dsw-alias-accent,var(--dsw-alias-state-accent,#5b8def));margin:0}',
      '.dshJevArea{width:100%;min-height:62px;background:var(--dsw-alias-input-bg,#12151e);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;box-sizing:border-box;resize:vertical}',
      '.dshJevBlock{display:flex;flex-direction:column;gap:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px}',
      '.dshJevBlockHead{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      // The block log is a modal: a dock-anchored panel grew taller than the
      // chat as soon as a wrapper script landed in the log. Fixed positioning
      // has to reach the viewport, hence the very high z-index, and the inner
      // scroll area keeps a long log navigable without moving the page.
      '.dshJevModalBackdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;box-sizing:border-box;overflow:auto}',
      '.dshJevModal{display:flex;flex-direction:column;gap:8px;width:min(900px,100%);max-height:86vh;background:var(--dsw-alias-bg-base,#0e1116);border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;box-sizing:border-box;box-shadow:0 18px 48px rgba(0,0,0,.5)}',
      '.dshJevModalScroll{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0}',
      '.dshJevPanelCmdWrap{margin:0}',
      '.dshJevPanelCmdWrap>summary{cursor:pointer;color:var(--dsw-alias-label-caption);font-size:11px;padding:2px 0}',
      '.dshJevPanelCmdWrap[open]>summary{margin-bottom:4px}',
      '.dshJevBlockHead>b{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:600}',
      '.dshJevTag{border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-caption);text-transform:uppercase;letter-spacing:.03em}',
      '.dshJevPanelList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;width:100%}',
      '.dshJevPanelCmd{display:block;margin:0;padding:5px 7px;background:var(--dsw-alias-input-bg,#12151e);border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}',
      '.dshJevPanel{display:flex;flex-direction:column;gap:6px;width:100%;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;box-sizing:border-box}',
      'div:has(>[data-slot="conversation.composer.dock"]){flex-wrap:wrap}',
    ].join('')

    const CSS_TAG = 'dsh-plugin-jev/jev.css'
    function ensureStyles() {
      if (typeof document === 'undefined') return
      const existing = document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS
        return
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-jev'
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Compact USD for sub-cent Jev spend. */
    function formatCost(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value === 0) return '$0'
      if (Math.abs(value) < 0.0001) return '$' + value.toPrecision(2)
      if (Math.abs(value) < 1) return '$' + value.toFixed(4)
      return '$' + value.toFixed(2)
    }

    /** Compact token count: 12.4k from 12400. */
    function formatTokens(tokens) {
      if (!Number.isFinite(tokens)) return '—'
      return tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : String(tokens)
    }

    /**
     * The dock chip label for one session's folded usage, or null to render
     * nothing. Pure, so the tests can assert it without a renderer.
     */
    function formatJevStats(usage) {
      const calls = usage !== null && typeof usage === 'object' && Number.isFinite(usage.calls) && usage.calls > 0 ? usage.calls : 0
      const cost = usage !== null && typeof usage === 'object' && Number.isFinite(usage.costUsd) ? usage.costUsd : 0
      return 'Jev · ' + (calls === 1 ? '1 call' : calls + ' calls') + ' · ' + formatCost(cost)
    }

    /** Human label for a guard mode. Unknown input reads as the safer posture. */
    function guardLabelFor(mode) {
      return mode === 'enforce' ? 'Blocking' : 'Log only (nothing blocked)'
    }

    /**
     * The substring semantics of one pattern, spelled out for the field that
     * collects it. Matching is deliberately dumb — the pattern `git push` also
     * matches `git push --dry-run` — so the form states it rather than leaving
     * it to be discovered mid-session. Never empty, so it renders unguarded.
     */
    function matchRuleNote(pattern) {
      const text = typeof pattern === 'string' && pattern.trim() !== '' ? pattern.trim() : 'this pattern'
      return '"' + text + '" is a case-insensitive substring: it matches anywhere inside a command rather than the command as a whole, so any longer command that contains it is blocked too.'
    }

    /**
     * One rule as the edit form holds it: the patterns become one-per-line text.
     * Pure, so opening the editor is a transformation, not a state machine.
     */
    function blockToDraft(rule) {
      const source = rule !== null && typeof rule === 'object' ? rule : {}
      const patterns = Array.isArray(source.patterns)
        ? source.patterns.filter((pattern) => typeof pattern === 'string' && pattern.trim() !== '')
        : []
      const prefilter = Array.isArray(source.prefilter)
        ? source.prefilter.filter((token) => typeof token === 'string' && token.trim() !== '')
        : []
      return {
        id: typeof source.id === 'string' ? source.id : '',
        intent: typeof source.intent === 'string' ? source.intent : '',
        patternsText: patterns.join('\n'),
        prefilterText: prefilter.join('\n'),
        scope: source.scope === 'workspace' ? 'workspace' : 'global',
        absolute: source.absolute === true,
        enabled: source.enabled !== false,
      }
    }

    /**
     * What the prefilter does, stated where it is edited. The direction of the
     * risk is the part a user has to understand: a token that is too NARROW
     * means Jev is never asked, and a real violation passes unchecked.
     */
    function prefilterNote(tokens) {
      const list = Array.isArray(tokens) ? tokens.filter((t) => typeof t === 'string' && t.trim() !== '') : []
      if (list.length === 0) {
        return 'No prefilter: Jev is asked about this rule for every command. Set tokens such as git to ask only when the command mentions one of them, which is what keeps the semantic check cheap.'
      }
      return 'Jev is asked about this rule only when the command contains one of: ' + list.join(', ')
        + '. Keep these broad — a token that is too narrow means the command is never sent for judging, and a real violation would pass. The check is case-insensitive.'
    }

    /** The patterns textarea: one pattern per line, trimmed, blanks dropped. */
    function parsePatterns(text) {
      if (typeof text !== 'string') return []
      return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    }

    /** The prefilter tokens, parsed the same way as patterns. */
    function parsePrefilter(text) {
      return parsePatterns(text)
    }

    /** The scored-tools field: comma-separated, trimmed, blanks dropped. */
    function parseTools(text) {
      if (typeof text !== 'string') return []
      return text.split(',').map((name) => name.trim()).filter((name) => name !== '')
    }

    /** Clamp a confidence floor into 0..1, defaulting when it is not a number. */
    function normalizeFloor(value) {
      if (!Number.isFinite(value)) return DEFAULT_GUARD_CONFIG.confidenceFloor
      return Math.min(1, Math.max(0, value))
    }

    /**
     * The "Tool danger detection" slice of the guard config. `commandBlocks` is
     * deliberately absent: the other panel owns that array, so a partial POST
     * from here can never clobber the rules it just saved.
     */
    function guardFormPatch(config) {
      const source = config !== null && typeof config === 'object' ? config : DEFAULT_GUARD_CONFIG
      const tools = Array.isArray(source.tools) ? source.tools.filter((name) => typeof name === 'string' && name.trim() !== '') : []
      return {
        enabled: source.enabled === true,
        mode: source.mode === 'enforce' ? 'enforce' : 'monitor',
        blockThreshold: SEVERITY_BANDS.includes(source.blockThreshold) ? source.blockThreshold : DEFAULT_GUARD_CONFIG.blockThreshold,
        blockIrreversible: source.blockIrreversible !== false,
        confidenceFloor: normalizeFloor(Number(source.confidenceFloor)),
        tools: tools.length > 0 ? tools : DEFAULT_GUARD_CONFIG.tools.slice(),
        scoreNested: source.scoreNested !== false,
        scoreDanger: source.scoreDanger !== false,
      }
    }

    /** The rules on a guard payload, or an empty list. */
    function rulesOf(payload) {
      const config = payload !== null && typeof payload === 'object' ? payload.config : null
      return config !== null && typeof config === 'object' && Array.isArray(config.commandBlocks) ? config.commandBlocks : []
    }

    async function readJson(url, options) {
      const response = await fetch(url, Object.assign({ headers: { Accept: 'application/json' }, cache: 'no-store' }, options || {}))
      const payload = await response.json().catch(() => undefined)
      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : 'Jev request failed (HTTP ' + response.status + ')')
      }
      return payload
    }

    const readStatus = () => readJson(STATUS_ROUTE)
    const readModels = (force) => readJson(MODELS_ROUTE + (force ? '?refresh=1' : ''))
    const readSettings = () => readJson(SETTINGS_ROUTE)
    const readStats = () => readJson(STATS_ROUTE)
    async function saveKey(value) {
      return readJson(KEY_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
    }
    async function removeKey() {
      return readJson(KEY_ROUTE, { method: 'DELETE' })
    }
    async function saveSettings(body) {
      return readJson(SETTINGS_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    const readGuard = () => readJson(GUARD_ROUTE)
    async function saveGuardConfig(patch) {
      return readJson(GUARD_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    }

    /**
     * The shared key control. A configured key shows its source (never a value)
     * and offers Remove when the primary "typesafe" record is writable; an absent
     * key shows a password field that POSTs to the plugin's own host route.
     */
    function KeyMenu(props) {
      const credential = props.credential || { configured: false, writable: false }
      const configured = credential.configured === true
      const writable = credential.writable !== false
      if (configured) {
        const source = credential.source ? credential.source : credential.ref ? credential.ref : 'typesafe'
        return React.createElement('div', { className: 'dshJevKey' },
          React.createElement('span', { className: 'dshJevOk' }, 'TypeSafe key: ' + source),
          writable
            ? React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', disabled: props.savingKey, onClick: () => { if (props.onRemoveKey) props.onRemoveKey() } },
                props.savingKey ? '…' : 'Remove')
            : React.createElement('span', { className: 'dshJevHint' }, 'read-only (from ' + source + ')'),
        )
      }
      if (!writable) {
        return React.createElement('div', { className: 'dshJevHint' }, 'No TypeSafe key is configured, and this deployment stores none here — set TYPESAFE_API_KEY in the launch environment.')
      }
      return React.createElement('div', { className: 'dshJevKey' },
        React.createElement('span', { className: 'dshJevHint' }, 'No TypeSafe API key stored — paste one:'),
        React.createElement('input', {
          type: 'password',
          value: props.keyDraft || '',
          placeholder: 'TypeSafe API key',
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => { if (props.setKeyDraft) props.setKeyDraft(event.target.value) },
          onKeyDown: (event) => { if (event.key === 'Enter' && props.onSaveKey) props.onSaveKey() },
        }),
        React.createElement('button', { type: 'button', className: 'dshJevBtn', disabled: props.savingKey, onClick: () => { if (props.onSaveKey) props.onSaveKey() } },
          props.savingKey ? 'Saving…' : 'Save'),
      )
    }

    /**
     * The composer-dock pill: how many times Jev ran in this chat and what it
     * cost, always rendered — a chat with no calls shows "0 calls · $0" so the
     * meter is discoverable before the first call. The value arrives through the
     * host's jevUsage session projection.
     *
     * The pill is also the door to the command guard's block log: clicking it
     * opens a panel of what the guard actually refused. Nothing is fetched until
     * the first click — the pill sits in every chat, so a request on mount would
     * tax every session for a log most of them never look at — and a load that
     * succeeded is kept, so reopening shows the log again without a second
     * request. An explicit Refresh re-reads it. Every open also re-reads the
     * durable guard counters from /stats, and so does a change in this chat's
     * meter (the closest thing to a turn end the dock slot can see), which is
     * how the all-time "scored" figure keeps up without polling all day.
     * @param props - the dock's session seat (the projection reader).
     */
    function JevStatsPill(props) {
      const useProjection = props && props.useProjection
      const usage = typeof useProjection === 'function' ? useProjection(JEV_USAGE_KEY) : undefined
      const calls = usage !== null && typeof usage === 'object' && Number.isFinite(usage.calls) && usage.calls > 0 ? usage.calls : 0
      const cost = usage !== null && typeof usage === 'object' && Number.isFinite(usage.costUsd) ? usage.costUsd : 0
      // Commands the guard refused in THIS chat. Separate from `calls` because
      // they are a different thing: `calls` are jev_ask decisions the model
      // asked for, this is the guard refusing a command. Both belong on the
      // meter, neither may be mistaken for the other.
      const guardBlocks = usage !== null && typeof usage === 'object' && Number.isFinite(usage.guardBlocks) && usage.guardBlocks > 0 ? usage.guardBlocks : 0
      const [open, setOpen] = React.useState(false)
      const [loaded, setLoaded] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const [payload, setPayload] = React.useState(null)
      const [error, setError] = React.useState(null)
      // The durable guard figures, from the /stats route. Unlike the projection,
      // they survive a restart and span every chat: this is what lets the meter
      // keep counting guard commands across sessions.
      const [stats, setStats] = React.useState(null)
      const mounted = React.useRef(false)

      React.useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
      }, [])

      // Escape closes the log. The handler lives here, in the component, rather
      // than in renderModal: that helper is called conditionally, so a hook in it
      // would change the hook count between renders and crash the slot.
      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
        if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onKeyDown)
        return () => {
          if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      /**
       * Follow the meter: a projection change means a tool result just landed —
       * a jev_ask answered or a command refused — which is the closest thing to
       * a turn end the dock slot can see. Re-read the durable counters then, so
       * the all-time figures keep up without polling while closed. The first
       * render is skipped: mounting a pill into an old chat must not fetch for
       * numbers nothing has moved yet.
       */
      const seenMeter = React.useRef(null)
      React.useEffect(() => {
        const signature = String(calls) + '/' + String(guardBlocks)
        if (seenMeter.current === null) { seenMeter.current = signature; return undefined }
        if (seenMeter.current === signature) return undefined
        seenMeter.current = signature
        readStats().then(
          (body) => { if (mounted.current) setStats(body) },
          () => { /* the durable figures simply keep whatever they last had */ },
        )
        return undefined
      }, [calls, guardBlocks])

      /** Read the guard's block log, plus the durable counters. `mounted` guards a late reply. */
      const load = React.useCallback(() => {
        setLoading(true)
        setError(null)
        readGuard().then(
          (body) => {
            if (!mounted.current) return
            setPayload(body)
            setLoaded(true)
            setError(null)
            setLoading(false)
          },
          (failure) => {
            if (!mounted.current) return
            setError(String((failure && failure.message) || failure || 'Guard log unavailable'))
            setLoading(false)
          },
        )
        // The durable counters ride the same refresh. A stats failure is not a
        // log failure: the block log still loads, and the all-time line keeps
        // whatever it last had.
        readStats().then(
          (body) => { if (mounted.current) setStats(body) },
          () => {},
        )
      }, [])

      /**
       * Toggle the log. Every OPEN re-reads it.
       *
       * The log is host-side state that any turn can append to, so a cached copy
       * goes stale the moment a command is refused — and a log that silently
       * hides the block the reader just saw is worse than no log. A reopen
       * therefore refetches rather than trusting `loaded`.
       */
      const toggle = React.useCallback(() => {
        if (open) { setOpen(false); return }
        setOpen(true)
        load()
      }, [open, load])

      /**
       * Keep the open log current, so a block made while it is being read shows
       * up without a manual Refresh.
       *
       * Polling rather than a turn-end subscription: the client half of an
       * out-of-tree plugin gets no session event stream (the dock slot hands it
       * only `useProjection`), and the alternative — deriving "a block happened"
       * by parsing the denial text back out of the session log — is the coupling
       * that has already broken this plugin once. Polling only while the log is
       * open, and stopping the moment it closes, keeps the cost to one small
       * request per interval and none at all the rest of the time.
       */
      React.useEffect(() => {
        if (!open) return undefined
        if (typeof setInterval !== 'function') return undefined
        const timer = setInterval(() => { load() }, GUARD_POLL_MS)
        return () => { clearInterval(timer) }
      }, [open, load])

      const badge = badgeLabel(payload)
      // The all-time figure: every command the guard has sent to Jev, across
      // every chat and every restart. It rides the durable stats read, and it
      // appears only once that read has happened — a never-opened pill shows the
      // per-chat numbers alone.
      const scored = guardScored(stats)
      return React.createElement('div', { className: 'dshJevDock' },
        React.createElement('span', {
          className: 'dshJevStats',
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open ? 'true' : 'false',
          'data-empty': calls === 0 ? 'true' : undefined,
          title: calls === 0 ? 'Jev has not run in this chat yet' : 'Jev calls and estimated cost in this chat; scored counts every command the guard has sent to Jev, all-time. Click for the command-guard log.',
          style: { cursor: 'pointer' },
          onClick: toggle,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
              if (event.preventDefault) event.preventDefault()
              toggle()
            }
          },
        },
          React.createElement('span', { className: 'dshJevStatsName' }, 'Jev'),
          React.createElement('span', { className: 'dshJevStatsSep' }, '·'),
          React.createElement('span', null, calls === 1 ? '1 call' : calls + ' calls'),
          scored > 0
            ? [
                React.createElement('span', { className: 'dshJevStatsSep', key: 'scored-sep' }, '·'),
                React.createElement('span', { key: 'scored' }, scored === 1 ? '1 scored' : scored + ' scored'),
              ]
            : null,
          React.createElement('span', { className: 'dshJevStatsSep' }, '·'),
          React.createElement('span', null, guardBlocks === 1 ? '1 blocked' : guardBlocks + ' blocked'),
          React.createElement('span', { className: 'dshJevStatsSep' }, '·'),
          React.createElement('span', null, formatCost(cost)),
          badge !== null ? React.createElement('span', { className: 'dshJevTag' }, badge) : null,
        ),
        open
          ? renderModal({
              title: 'Blocked by the command guard',
              badge: badgeLabel(payload),
              onClose: () => setOpen(false),
              // The body goes in as a real CHILD element, not as a `children`
              // prop. renderModal is a plain render helper that React never
              // invokes, so a function handed over as a prop would be passed
              // straight to the DOM as a node and the body would render empty.
              body: renderDenialPanelBody({ payload, loaded, loading, error, onRefresh: load, stats }),
              actions: React.createElement('button', {
                type: 'button',
                className: 'dshJevBtn ghost',
                disabled: loading === true,
                onClick: () => { load() },
              }, loading === true ? 'Refreshing…' : 'Refresh'),
            })
          : null,
      )
    }

    /** One labelled figure in the settings stats grid. */
    function statCell(label, value) {
      return React.createElement('div', { className: 'dshJevStat', key: label },
        React.createElement('b', null, value),
        React.createElement('span', null, label),
      )
    }

    /** One guard counter as a string, tolerating a missing stats block. */
    function guardCount(stats, key) {
      const value = stats !== null && typeof stats === 'object' ? stats[key] : undefined
      return Number.isFinite(value) ? String(value) : '0'
    }

    /**
     * The denials a guard payload carries, or an empty list. The panel renders
     * from this alone so a malformed or missing payload degrades to "nothing
     * recorded" rather than throwing inside a render.
     */
    function denialRows(payload) {
      const source = payload !== null && typeof payload === 'object' ? payload : null
      return source !== null && Array.isArray(source.denials) ? source.denials : []
    }

    /**
     * Split the log into what was actually refused and what only would have
     * been. The two must never be conflated in a count either: labeling a
     * would-be block as "blocked" tells the user a command was stopped when it
     * ran, which is the single most misleading thing this panel could do.
     *
     * @param payload - the guard payload.
     * @returns `{ blocked, wouldBlock, total }`.
     */
    function denialCounts(payload) {
      const rows = denialRows(payload)
      let blocked = 0
      for (const entry of rows) {
        if (denialAction(entry) === 'blocked') blocked += 1
      }
      return { blocked, wouldBlock: rows.length - blocked, total: rows.length }
    }

    /**
     * The pill's badge text, or null when there is nothing to badge. Counts stay
     * separate: "2 blocked" and "2 would block" mean opposite things about
     * whether the commands ran.
     *
     * @param payload - the guard payload, or null before the first open.
     * @returns the badge text, or null when the log is empty.
     */
    function badgeLabel(payload) {
      const counts = denialCounts(payload)
      if (counts.total === 0) return null
      const parts = []
      if (counts.blocked > 0) parts.push(counts.blocked + ' blocked')
      if (counts.wouldBlock > 0) parts.push(counts.wouldBlock + ' would block')
      return parts.join(' · ')
    }

    /**
     * The durable count of commands the guard has sent to Jev, from the stats
     * route's `bySource.guard` bucket. All-time, not per-chat: it is read from
     * the store, which survives a harness restart, so the meter keeps counting
     * what the guard has done across every session — allowed and blocked alike,
     * since both cost a call. Commands refused by a literal rule or the oversize
     * rail are absent on purpose: they never reached Jev and cost nothing.
     *
     * @param stats - the /stats payload, or null before the first read.
     * @returns the count, 0 when unknown.
     */
    function guardScored(stats) {
      const source = stats !== null && typeof stats === 'object' ? stats : null
      const bySource = source !== null && source.bySource !== null && typeof source.bySource === 'object' ? source.bySource : null
      const guard = bySource !== null && bySource.guard !== null && typeof bySource.guard === 'object' ? bySource.guard : null
      const calls = guard !== null && Number.isFinite(guard.calls) ? guard.calls : 0
      return calls > 0 ? calls : 0
    }

    /**
     * The panel's all-time line, or null when nothing has been scored yet. A
     * null return renders nothing, so a panel built without stats never shows a
     * stray "null"/"undefined" (the panel is asserted against that).
     */
    function guardAllTimeLine(stats) {
      const source = stats !== null && typeof stats === 'object' ? stats : null
      const bySource = source !== null && source.bySource !== null && typeof source.bySource === 'object' ? source.bySource : null
      const guard = bySource !== null && bySource.guard !== null && typeof bySource.guard === 'object' ? bySource.guard : null
      const calls = guard !== null && Number.isFinite(guard.calls) ? guard.calls : 0
      if (calls <= 0) return null
      const cost = guard !== null && Number.isFinite(guard.costUsd) ? guard.costUsd : 0
      return 'All-time, saved across restarts: ' + (calls === 1 ? '1 command' : calls + ' commands')
        + ' sent to Jev by the command guard · ' + formatCost(cost) + ' guard spend.'
    }

    /**
     * Readable "when" for one block, in the reader's own timezone. A missing or
     * unparseable stamp reads as an em dash — the row still renders, and never
     * as the literal text null or undefined.
     */
    function formatDenialWhen(iso) {
      if (typeof iso !== 'string' || iso.trim() === '') return '—'
      const when = new Date(iso)
      if (!Number.isFinite(when.getTime())) return '—'
      return when.toLocaleString()
    }

    /**
     * A denial's "why" as one line, covering both shapes the guard records: a
     * rule block (the rule id, its intent if it has one, and the matched-pattern
     * detail) and a danger block (the severity band and Jev's confidence). Pure
     * and total — every field is optional, so the fallbacks carry the line when
     * the payload is thin, and the result is never empty.
     */
    function denialDetail(denial) {
      const entry = denial !== null && typeof denial === 'object' ? denial : {}
      const rule = typeof entry.rule === 'string' && entry.rule.trim() !== '' ? entry.rule.trim() : ''
      const intent = typeof entry.intent === 'string' && entry.intent.trim() !== '' ? entry.intent.trim() : ''
      const severity = typeof entry.severity === 'string' && entry.severity.trim() !== '' ? entry.severity.trim() : ''
      const confidence = Number.isFinite(entry.confidence) ? entry.confidence : null
      const detail = typeof entry.detail === 'string' && entry.detail.trim() !== '' ? entry.detail.trim() : ''
      const reason = typeof entry.reason === 'string' && entry.reason.trim() !== '' ? entry.reason.trim() : ''
      const parts = []
      if (rule !== '') parts.push('Rule ' + rule + (intent !== '' ? ' (' + intent + ')' : ''))
      else if (intent !== '') parts.push('Intent: ' + intent)
      else parts.push('Blocked by the command guard')
      if (severity !== '' || confidence !== null) {
        parts.push('severity ' + (severity !== '' ? severity : '—') + ' · confidence ' + (confidence !== null ? confidence.toFixed(2) : '—'))
      }
      if (detail !== '') parts.push(detail)
      else if (reason !== '' && reason !== detail) parts.push(reason)
      return parts.join(' · ')
    }

    /** The command a denial carries, verbatim, or an em dash when absent. */
    function denialCommand(denial) {
      const command = denial !== null && typeof denial === 'object' ? denial.command : null
      return typeof command === 'string' && command !== '' ? command : '—'
    }

    /**
     * Whether a command is long enough to collapse. Multi-line or past a
     * readable width: a wrapper script that merely contains the blocked call
     * should not push the rest of the log off screen. The full text is never
     * truncated — it moves behind a disclosure, which is what keeps a row
     * useful as evidence.
     *
     * @param denial - one log entry.
     * @returns true when the command should start collapsed.
     */
    function isLongCommand(denial) {
      const text = denialCommand(denial)
      return text.length > COMMAND_COLLAPSE_CHARS || text.includes('\n')
    }

    /**
     * What one entry did: a real refusal, or a monitor-mode would-be block. The
     * two are never presented alike — a command that actually ran must not look
     * like one that was stopped.
     */
    function denialAction(denial) {
      return denial !== null && typeof denial === 'object' && denial.wouldBlock === true
        ? 'blocked'
        : 'would block'
    }

    function renderDenialRow(denial, index) {
      const entry = denial !== null && typeof denial === 'object' ? denial : {}
      const tool = typeof entry.tool === 'string' && entry.tool.trim() !== '' ? entry.tool.trim() : '—'
      const trigger = typeof entry.trigger === 'string' && entry.trigger.trim() !== '' ? entry.trigger.trim() : '—'
      const model = typeof entry.model === 'string' && entry.model.trim() !== '' ? entry.model.trim() : ''
      const rule = typeof entry.rule === 'string' && entry.rule.trim() !== '' ? entry.rule.trim() : ''
      const severity = typeof entry.severity === 'string' && entry.severity.trim() !== '' ? entry.severity.trim() : ''
      const wouldBlock = denialAction(entry) === 'would block'
      return React.createElement('li', { className: 'dshJevBlock', key: 'denial-' + (typeof entry.at === 'string' ? entry.at : String(index)) },
        React.createElement('div', { className: 'dshJevBlockHead' },
          React.createElement('b', null, formatDenialWhen(entry.at)),
          React.createElement('span', { className: 'dshJevTag' }, denialAction(entry)),
          React.createElement('span', { className: 'dshJevTag' }, tool),
          rule !== '' ? React.createElement('span', { className: 'dshJevTag' }, 'rule') : null,
          severity !== '' ? React.createElement('span', { className: 'dshJevTag' }, severity) : null,
          React.createElement('span', { className: 'dshJevTag' }, trigger),
        ),
        React.createElement('div', { className: 'dshJevHint' }, denialDetail(entry)),
        // A command can be hundreds of characters (a wrapper script that happens
        // to contain the blocked call). Collapsing long ones keeps the list
        // scannable while leaving the full text one click away — never truncated,
        // which is the property that matters for evidence.
        isLongCommand(entry)
          ? React.createElement('details', { className: 'dshJevPanelCmdWrap' },
              React.createElement('summary', null, 'Command (' + entry.command.length + ' chars) — click to show in full'),
              React.createElement('pre', { className: 'dshJevPanelCmd' }, denialCommand(entry)))
          : React.createElement('pre', { className: 'dshJevPanelCmd' }, denialCommand(entry)),
        wouldBlock
          ? React.createElement('div', { className: 'dshJevHint' }, 'This command ran: the guard is in monitor mode, so nothing was stopped.')
          : null,
        model !== ''
          ? React.createElement('div', { className: 'dshJevHint' }, 'Scored by Jev (' + model + ')' + (Number.isFinite(entry.costUsd) ? ' · ' + formatCost(entry.costUsd) : ''))
          : null,
      )
    }

    /**
     * The modal shell the block log opens in.
     *
     * A dock-anchored panel was the wrong shape: as soon as a long command
     * landed in the log it grew taller than the chat. A portalled, fixed-position
     * dialog with its own scroll area keeps the page still and the log navigable.
     *
     * **This must never call a hook.** It is a plain render helper invoked
     * conditionally from JevStatsPill (only while the log is open), so a hook
     * here changes the hook count between renders and React throws error #310,
     * which unmounts the whole dock slot. Escape handling therefore lives in the
     * pill's own effect, and the backdrop compares `event.target` to
     * `event.currentTarget` rather than holding a ref.
     *
     * @param props - `{ title, badge, onClose, actions, body }`; `body` is a
     *   rendered element, not a function, because this helper is called directly
     *   rather than mounted as a component.
     * @returns the backdrop element, optionally portalled into the document body.
     */
    function renderModal(props) {
      const element = React.createElement('div', {
        className: 'dshJevModalBackdrop',
        role: 'presentation',
        onClick: (event) => {
          // Only a click on the backdrop itself closes; a click that bubbled up
          // from inside the dialog has a different target and is ignored.
          if (event.target === event.currentTarget && props.onClose) props.onClose()
        },
      },
        React.createElement('div', {
          className: 'dshJevModal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': props.title,
          onClick: (event) => { if (event.stopPropagation) event.stopPropagation() },
        },
          React.createElement('div', { className: 'dshJevBlockHead' },
            React.createElement('b', null, props.title),
            props.badge ? React.createElement('span', { className: 'dshJevTag' }, props.badge) : null,
            props.actions ? props.actions : null,
            React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: () => { if (props.onClose) props.onClose() } }, 'Close'),
          ),
          React.createElement('div', { className: 'dshJevModalScroll' }, props.body),
        ),
      )
      const host = typeof document !== 'undefined' ? document.body : undefined
      if (createPortal !== null && host !== undefined && host !== null) return createPortal(element, host)
      return element
    }

    /**
     * The opened log's body. A render helper rather than a component, in the
     * same spirit as renderGuardPanel — the pill owns the state and the fetch,
     * and this stays a pure function of the payload so it can be called directly
     * (see test/client.test.mjs).
     */
    function renderDenialPanelBody(props) {
      const payload = props.payload !== null && typeof props.payload === 'object' ? props.payload : null
      const config = payload !== null && payload.config !== null && typeof payload.config === 'object' ? payload.config : null
      const mode = config !== null && config.mode === 'monitor' ? 'monitor' : 'enforce'
      const rows = denialRows(payload)
      const counts = denialCounts(payload)
      const monitorNote = 'The guard is in monitor mode, so nothing is being blocked. Entries tagged "would block" are the commands enforce mode would have refused; those commands ran.'
      // The all-time figures, from the stats route the pill refreshes alongside
      // the log. Absent until that read has happened, and absent when the guard
      // has never sent anything to Jev — a zero line would just be noise.
      const allTime = guardAllTimeLine(props.stats)
      return React.createElement('div', { className: 'dshJevPanel' },
        React.createElement('div', { className: 'dshJevHint' },
          'Newest first. The command is always shown in full — expand a long one to read it. '
          + (mode === 'monitor'
            ? 'Nothing is blocked in monitor mode: every entry is a would-be block and its command actually ran.'
            : 'Every entry here was refused before it ran.')),
        allTime !== null ? React.createElement('div', { className: 'dshJevHint' }, allTime) : null,
        props.error ? React.createElement('div', { className: 'dshJevErr' }, 'Guard log: ' + props.error) : null,
        props.loading === true && props.loaded !== true ? React.createElement('div', { className: 'dshJevHint' }, 'Loading the block log…') : null,
        mode === 'monitor' ? React.createElement('div', { className: 'dshJevHint' }, monitorNote) : null,
        rows.length > 0
          ? React.createElement('div', null,
              React.createElement('div', { className: 'dshJevHint' },
                counts.blocked + ' blocked · ' + counts.wouldBlock + ' would block'),
              React.createElement('ul', { className: 'dshJevPanelList' }, rows.map((denial, index) => renderDenialRow(denial, index))))
          : props.loading === true && props.loaded !== true
            ? null
            : React.createElement('div', { className: 'dshJevHint' },
                mode === 'monitor'
                  ? 'The guard has not flagged anything yet. In monitor mode an empty list means no command matched a rule or scored over the threshold.'
                  : 'Nothing has been blocked yet.'),
      )
    }

    /**
     * A checkbox with its label. Deliberately not a .dshJevRow: that class styles
     * every nested input as a text field, which turns a checkbox into a blob.
     */
    function checkRow(label, checked, onChange, title) {
      return React.createElement('label', { className: 'dshJevCheck', title },
        React.createElement('input', { type: 'checkbox', checked: checked === true, onChange }),
        React.createElement('span', null, label),
      )
    }

    /** One saved blocked-command rule: its identity, its markers, its controls. */
    function renderBlockRow(rule, props) {
      const id = typeof rule.id === 'string' ? rule.id : ''
      const patterns = Array.isArray(rule.patterns) ? rule.patterns : []
      const scope = rule.scope === 'workspace' ? 'workspace' : 'global'
      return React.createElement('li', { className: 'dshJevBlock', key: id },
        React.createElement('div', { className: 'dshJevBlockHead' },
          React.createElement('b', null, id),
          React.createElement('span', { className: 'dshJevTag' }, scope),
          rule.absolute === true ? React.createElement('span', { className: 'dshJevTag' }, 'absolute') : null,
          rule.enabled === false ? React.createElement('span', { className: 'dshJevTag' }, 'disabled') : null,
          checkRow('enabled', rule.enabled !== false, (event) => { if (props.onToggle) props.onToggle(rule, event.target.checked) }),
          React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: () => { if (props.onEdit) props.onEdit(rule) } }, 'Edit'),
          React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: () => { if (props.onDelete) props.onDelete(rule) } }, 'Delete'),
        ),
        React.createElement('span', { className: 'dshJevHint' }, rule.intent ? rule.intent : 'No intent — literal patterns only.'),
        React.createElement('span', { className: 'dshJevHint' }, patterns.length > 0 ? 'Patterns: ' + patterns.join(' · ') : 'No patterns — the Jev intent check alone decides.'),
      )
    }

    /**
     * "Tool danger detection": the thresholds Jev scores shell commands against,
     * plus the counters that show what the guard actually did. A render helper
     * rather than a component — every piece of state lives in the tab, and
     * calling it here keeps the tab's returned tree inspectable without a
     * renderer (see test/client.test.mjs).
     */
    function renderGuardPanel(props) {
      const config = props.config || DEFAULT_GUARD_CONFIG
      const mode = config.mode === 'enforce' ? 'enforce' : 'monitor'
      const threshold = SEVERITY_BANDS.includes(config.blockThreshold) ? config.blockThreshold : DEFAULT_GUARD_CONFIG.blockThreshold
      const stats = props.stats !== null && typeof props.stats === 'object' ? props.stats : null
      const last = stats !== null && stats.last !== null && typeof stats.last === 'object' ? stats.last : null
      return React.createElement('div', { className: 'dshJevSection' },
        React.createElement('h4', null, 'Tool danger detection'),
        React.createElement('div', { className: 'dshJevHint' },
          'Before a shell command runs, Jev scores how dangerous it is and whether its effects could be undone. The shipped default is monitor, so nothing is blocked until you switch to enforce and save.'),
        props.error ? React.createElement('div', { className: 'dshJevErr' }, 'Guard: ' + props.error) : null,
        checkRow('Enabled — score commands before they run', config.enabled === true, (event) => props.onPatch({ enabled: event.target.checked }),
          'Off means no scoring, no latency, and no Jev spend.'),
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('span', { className: 'dshJevHint' }, 'Mode'),
          React.createElement('select', { value: mode, onChange: (event) => props.onPatch({ mode: event.target.value }) },
            GUARD_MODES.map((value) => React.createElement('option', { key: value, value }, guardLabelFor(value))),
          ),
          React.createElement('span', { className: 'dshJevHint' }, mode === 'enforce'
            ? 'Enforce — a flagged command is denied before it runs.'
            : 'Monitor — nothing is blocked: the guard only records what it would have blocked.'),
        ),
        React.createElement('div', { className: 'dshJevHint' },
          'In monitor mode nothing is blocked; the guard records what it would have blocked so the thresholds can be judged before they are trusted. In enforce mode a flagged command is denied before it runs.'),
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('span', { className: 'dshJevHint' }, 'Block at or above'),
          React.createElement('select', { value: threshold, onChange: (event) => props.onPatch({ blockThreshold: event.target.value }) },
            SEVERITY_BANDS.map((band) => React.createElement('option', { key: band, value: band }, band)),
          ),
          React.createElement('span', { className: 'dshJevHint' }, 'A score at or above this band blocks, unless Jev was too unsure to act.'),
        ),
        checkRow('Block when the effect cannot be undone', config.blockIrreversible !== false, (event) => props.onPatch({ blockIrreversible: event.target.checked }),
          'Escalates a moderate-or-worse command below the threshold when Jev judges it irreversible.'),
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('span', { className: 'dshJevHint' }, 'Confidence floor'),
          React.createElement('input', {
            type: 'number',
            min: 0,
            max: 1,
            step: 0.05,
            style: { width: 90 },
            value: props.floorValue,
            onChange: (event) => props.onFloor(event.target.value),
          }),
          React.createElement('span', { className: 'dshJevHint' }, 'Below this a block is downgraded to a warning — Jev was unsure.'),
        ),
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('span', { className: 'dshJevHint' }, 'Scored tools'),
          React.createElement('input', {
            className: 'dshJevGrow',
            value: props.toolsValue,
            placeholder: 'pwsh, bash, pwsh_persistent, bash_persistent',
            spellCheck: false,
            onChange: (event) => props.onTools(event.target.value),
          }),
        ),
        React.createElement('div', { className: 'dshJevHint' }, 'Comma-separated tool names whose command argument is scored. Saved as a trimmed, non-empty list.'),
        checkRow('Score nested run_code dispatches', config.scoreNested !== false, (event) => props.onPatch({ scoreNested: event.target.checked }),
          'Also score commands the model builds inside a code-execution tool.'),
        checkRow('Score danger (severity and irreversibility)', config.scoreDanger !== false, (event) => props.onPatch({ scoreDanger: event.target.checked }),
          'Jev scores every scored command for how dangerous it is. Turn this off to run only the blocked-command rules above — with a prefilter set, commands that match no rule token then cost nothing at all.'),
        React.createElement('div', { className: 'dshJevHint' },
          config.scoreDanger !== false
            ? 'Danger scoring is ON: every command that reaches the guard is sent to Jev, whether or not it matches a rule.'
            : 'Danger scoring is OFF: only blocked-command rules are checked, and a command their prefilters do not match is not sent to Jev at all.'),
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('button', { type: 'button', className: 'dshJevBtn', disabled: props.saving || !props.loaded || !props.dirty, onClick: props.onSave },
            props.saving ? 'Saving…' : 'Save guard settings'),
          React.createElement('span', { className: 'dshJevHint' }, !props.loaded ? 'Loading guard settings…' : props.dirty ? 'Unsaved changes.' : 'Saved.'),
        ),
        React.createElement('div', { className: 'dshJevHint' },
          'These counters are all-time: the guard hands them to the store after every command, so they survive a harness restart. Only the entries half of "Cache hits / entries" is run-local.'),
        React.createElement('div', { className: 'dshJevStatGrid' },
          statCell('Evaluated', guardCount(stats, 'evaluated')),
          statCell('Blocked literal', guardCount(stats, 'blockedLiteral')),
          statCell('Blocked semantic', guardCount(stats, 'blockedSemantic')),
          statCell('Blocked danger', guardCount(stats, 'blockedDanger')),
          statCell('Blocked oversize', guardCount(stats, 'blockedOversize')),
          statCell('Downgraded', guardCount(stats, 'downgraded')),
          statCell('Guard failures', guardCount(stats, 'failures')),
          statCell('Cache hits / entries', guardCount(stats, 'cached') + ' / ' + guardCount(stats, 'cachedEntries')),
          statCell('Skipped (no cost)', guardCount(stats, 'skipped')),
        ),
        last
          ? React.createElement('ul', { className: 'dshJevModelList' },
              React.createElement('li', { className: 'dshJevModel' },
                React.createElement('b', null, 'Last decision'),
                React.createElement('span', null, String(last.action || '—') + ' · ' + String(last.severity || '—') + ' · confidence ' + (Number.isFinite(last.confidence) ? last.confidence.toFixed(2) : '—') + ' · ' + String(last.trigger || '—') + ' · ' + formatCost(last.costUsd)),
              ),
              React.createElement('li', { className: 'dshJevModel' },
                React.createElement('b', null, 'Command'),
                React.createElement('span', null, String(last.command || '—')),
              ),
            )
          : React.createElement('div', { className: 'dshJevHint' }, 'No command has been evaluated yet.'),
      )
    }

    /**
     * "Blocked commands": the user-authored rules and their editor. The copy
     * states both layers because the difference is the whole point — a literal
     * substring match is free and cannot fail, and only for commands that
     * survive it does Jev judge whether the rule's intent was accomplished.
     */
    function renderBlockedCommandsPanel(props) {
      const rules = Array.isArray(props.rules) ? props.rules : []
      const draft = props.draft || EMPTY_BLOCK_DRAFT
      const patterns = parsePatterns(draft.patternsText)
      const editing = typeof draft.id === 'string' && draft.id !== ''
      return React.createElement('div', { className: 'dshJevSection' },
        React.createElement('h4', null, 'Blocked commands'),
        React.createElement('div', { className: 'dshJevHint' },
          'Commands you never want run. Two layers, in order: first a literal, case-insensitive substring match — local, free, and unable to fail — then, for a command that survives it, Jev is asked whether the command accomplishes the rule\u0027s intent. That second layer is what catches bash -c \u0027git commit\u0027 and similar obfuscation no pattern list survives.'),
        props.error ? React.createElement('div', { className: 'dshJevErr' }, 'Guard: ' + props.error) : null,
        rules.length > 0
          ? React.createElement('ul', { className: 'dshJevModelList' }, rules.map((rule) => renderBlockRow(rule, props)))
          : React.createElement('div', { className: 'dshJevHint' }, 'No blocked commands yet.'),
        React.createElement('div', { className: 'dshJevHint' }, editing ? 'Editing rule ' + draft.id : 'Add a rule'),
        React.createElement('div', { className: 'dshJevBlock' },
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('span', { className: 'dshJevHint' }, 'Intent'),
            React.createElement('input', {
              className: 'dshJevGrow',
              value: draft.intent,
              placeholder: 'Commit or push changes to a git repository',
              spellCheck: false,
              onChange: (event) => props.onPatchDraft({ intent: event.target.value }),
            }),
          ),
          React.createElement('div', { className: 'dshJevHint' }, 'Intent is what Jev checks semantically — write the outcome you mean, not a command.'),
          React.createElement('textarea', {
            className: 'dshJevArea',
            value: draft.patternsText,
            placeholder: 'git commit\ngit push',
            spellCheck: false,
            rows: 3,
            onChange: (event) => props.onPatchDraft({ patternsText: event.target.value }),
          }),
          React.createElement('div', { className: 'dshJevHint' },
            'Patterns — one per line. Matching is case-insensitive and substring-based, not regex and not whole commands: the pattern "git push" also blocks "git push --dry-run".'),
          patterns.length > 0
            ? React.createElement('ul', { className: 'dshJevModelList' }, patterns.map((pattern) => React.createElement('li', { className: 'dshJevHint', key: pattern }, matchRuleNote(pattern))))
            : null,
          React.createElement('textarea', {
            className: 'dshJevArea',
            value: draft.prefilterText,
            placeholder: 'git',
            spellCheck: false,
            rows: 2,
            onChange: (event) => props.onPatchDraft({ prefilterText: event.target.value }),
          }),
          React.createElement('div', { className: 'dshJevHint' },
            'Prefilter — one token per line, optional. ' + prefilterNote(parsePrefilter(draft.prefilterText))),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('span', { className: 'dshJevHint' }, 'Scope'),
            React.createElement('select', { value: draft.scope, onChange: (event) => props.onPatchDraft({ scope: event.target.value }) },
              RULE_SCOPES.map((scope) => React.createElement('option', { key: scope, value: scope }, scope === 'workspace' ? 'workspace — this project only' : 'global — every session')),
            ),
          ),
          checkRow('Absolute — keep blocking this intent when Jev is unreachable', draft.absolute === true, (event) => props.onPatchDraft({ absolute: event.target.checked })),
          React.createElement('div', { className: 'dshJevHint' },
            'Absolute decides the failure mode, not whether the rule blocks. With it on, the semantic layer still blocks when Jev is unreachable, so the stated intent holds without Jev (fail closed). With it off, an unreachable Jev falls back to allowing. A literal pattern match always blocks either way, because layer one never consults Jev.'),
          checkRow('Enabled', draft.enabled !== false, (event) => props.onPatchDraft({ enabled: event.target.checked })),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('button', { type: 'button', className: 'dshJevBtn', disabled: props.saving, onClick: props.onSaveDraft },
              props.saving ? 'Saving…' : editing ? 'Save rule' : 'Add rule'),
            editing
              ? React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: props.onCancelDraft }, 'Cancel')
              : null,
          ),
        ),
      )
    }

    /**
     * The "Jev (TypeSafe)" Settings -> Plugins tab: API key, the model the tool
     * defaults to, overall usage totals, the model catalog, the tool-danger
     * guard, and the blocked-command rules.
     */
    function JevSettingsTab() {
      const [cred, setCred] = React.useState(null)
      const [models, setModels] = React.useState([])
      const [modelsError, setModelsError] = React.useState(null)
      const [keyDraft, setKeyDraft] = React.useState('')
      const [savingKey, setSavingKey] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [modelDraft, setModelDraft] = React.useState('')
      const [savedModel, setSavedModel] = React.useState(null)
      const [savingModel, setSavingModel] = React.useState(false)
      const [stats, setStats] = React.useState(null)
      const [statsError, setStatsError] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [guard, setGuard] = React.useState(null)
      const [savedGuard, setSavedGuard] = React.useState(null)
      const [guardError, setGuardError] = React.useState(null)
      const [savingGuard, setSavingGuard] = React.useState(false)
      const [toolsDraft, setToolsDraft] = React.useState(null)
      const [floorDraft, setFloorDraft] = React.useState(null)
      const [blockDraft, setBlockDraft] = React.useState(null)
      const mounted = React.useRef(false)

      const loadCatalog = React.useCallback((force) => {
        readModels(force).then(
          (payload) => {
            if (!mounted.current) return
            setModelsError(null)
            setModels(payload && Array.isArray(payload.models) ? payload.models : [])
          },
          (failure) => { if (mounted.current) setModelsError(String((failure && failure.message) || failure)) },
        )
      }, [])

      const loadStats = React.useCallback(() => {
        readStats().then(
          (payload) => { if (mounted.current) { setStats(payload); setStatsError(null) } },
          (failure) => { if (mounted.current) setStatsError(String((failure && failure.message) || failure)) },
        )
      }, [])

      const loadSettings = React.useCallback(() => {
        readSettings().then(
          (payload) => {
            if (!mounted.current) return
            setSavedModel(payload && payload.model ? payload.model : null)
            setModelDraft(payload && payload.model ? payload.model : '')
          },
          (failure) => { if (mounted.current) setError(String((failure && failure.message) || failure)) },
        )
      }, [])

      const loadGuard = React.useCallback(() => {
        readGuard().then(
          (payload) => {
            if (!mounted.current) return
            setGuard(payload)
            setSavedGuard(payload)
            setGuardError(null)
          },
          (failure) => { if (mounted.current) setGuardError(String((failure && failure.message) || failure)) },
        )
      }, [])

      React.useEffect(() => {
        mounted.current = true
        readStatus().then(
          (info) => { if (mounted.current) setCred(info) },
          () => { if (mounted.current) setCred({ configured: false, writable: false }) },
        )
        loadCatalog(false)
        loadSettings()
        loadStats()
        loadGuard()
        return () => { mounted.current = false }
      }, [loadCatalog, loadSettings, loadStats, loadGuard])

      const onSaveKey = React.useCallback(async () => {
        const value = keyDraft.trim()
        if (value === '') return
        setSavingKey(true)
        setError(null)
        setNotice(null)
        try {
          await saveKey(value)
          setKeyDraft('')
          setCred(await readStatus())
          setNotice('TypeSafe API key stored. The assistant can now use Jev.')
          loadCatalog(true)
          loadStats()
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setSavingKey(false)
        }
      }, [keyDraft, loadCatalog, loadStats])

      const onRemoveKey = React.useCallback(async () => {
        setSavingKey(true)
        setError(null)
        setNotice(null)
        try {
          await removeKey()
          setCred(await readStatus())
          setNotice('TypeSafe API key removed.')
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setSavingKey(false)
        }
      }, [])

      const onSaveModel = React.useCallback(async () => {
        const model = modelDraft.trim()
        if (model === '') return
        setSavingModel(true)
        setError(null)
        setNotice(null)
        try {
          const payload = await saveSettings({ model })
          setSavedModel(payload && payload.model ? payload.model : model)
          setNotice('Default model set to ' + model + '.')
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setSavingModel(false)
        }
      }, [modelDraft])

      const onTest = React.useCallback(async () => {
        setTesting(true)
        setError(null)
        setNotice(null)
        try {
          const payload = await readModels(true)
          const names = payload && Array.isArray(payload.models) ? payload.models : []
          setModels(names)
          setModelsError(null)
          setNotice('TypeSafe reachable — ' + names.length + ' model name(s) returned.')
          loadStats()
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setTesting(false)
        }
      }, [loadStats])

      /** Fold a fresh /guard payload in. `resetForms` clears the text mirrors. */
      const acceptGuard = React.useCallback((payload, resetForms) => {
        setGuard(payload)
        setSavedGuard(payload)
        setGuardError(null)
        if (resetForms === true) {
          setToolsDraft(null)
          setFloorDraft(null)
        }
      }, [])

      /** Edit the guard config locally. Nothing is sent until Save. */
      const patchGuard = React.useCallback((patch) => {
        setGuard((previous) => {
          const base = previous !== null && typeof previous === 'object' && previous.config ? previous : { config: DEFAULT_GUARD_CONFIG, stats: null, defaults: null }
          return Object.assign({}, base, { config: Object.assign({}, base.config, patch) })
        })
      }, [])

      /**
       * POST one guard patch and fold the reply back in. Returns whether it
       * landed; a 400 carries the host's error text, which is surfaced verbatim.
       */
      const runGuardPost = React.useCallback(async (patch, resetForms, done) => {
        setSavingGuard(true)
        setGuardError(null)
        setError(null)
        setNotice(null)
        try {
          acceptGuard(await saveGuardConfig(patch), resetForms)
          if (typeof done === 'string') setNotice(done)
          return true
        } catch (failure) {
          setGuardError(String((failure && failure.message) || failure))
          return false
        } finally {
          setSavingGuard(false)
        }
      }, [acceptGuard])

      const onSaveGuard = React.useCallback(async () => {
        const base = guard !== null && typeof guard === 'object' && guard.config ? guard.config : DEFAULT_GUARD_CONFIG
        const tools = parseTools(toolsDraft !== null ? toolsDraft : (Array.isArray(base.tools) ? base.tools.join(', ') : ''))
        const floor = floorDraft !== null && String(floorDraft).trim() !== '' ? normalizeFloor(Number(floorDraft)) : normalizeFloor(Number(base.confidenceFloor))
        await runGuardPost(guardFormPatch(Object.assign({}, base, { tools, confidenceFloor: floor })), true, 'Guard settings saved.')
      }, [guard, toolsDraft, floorDraft, runGuardPost])

      const patchBlockDraft = React.useCallback((patch) => {
        setBlockDraft((previous) => Object.assign({}, previous !== null && typeof previous === 'object' ? previous : EMPTY_BLOCK_DRAFT, patch))
      }, [])

      const onEditBlock = React.useCallback((rule) => { setBlockDraft(blockToDraft(rule)) }, [])
      const onCancelBlock = React.useCallback(() => { setBlockDraft(null) }, [])

      const onSaveBlock = React.useCallback(async () => {
        const draft = blockDraft !== null && typeof blockDraft === 'object' ? blockDraft : EMPTY_BLOCK_DRAFT
        const id = typeof draft.id === 'string' ? draft.id.trim() : ''
        const intent = typeof draft.intent === 'string' ? draft.intent.trim() : ''
        const patterns = parsePatterns(draft.patternsText)
        if (intent === '' && patterns.length === 0) {
          setGuardError('A blocked-command rule needs at least one pattern or an intent, or it can never match.')
          return
        }
        // An id edits that rule in place; omitting it creates one and the host
        // assigns the id.
        const rule = {
          intent,
          patterns,
          prefilter: parsePrefilter(draft.prefilterText),
          scope: draft.scope === 'workspace' ? 'workspace' : 'global',
          absolute: draft.absolute === true,
          enabled: draft.enabled !== false,
        }
        if (id !== '') rule.id = id
        const existing = rulesOf(guard)
        const next = id !== '' ? existing.map((entry) => (entry.id === id ? Object.assign({}, entry, rule) : entry)) : existing.concat([rule])
        const saved = await runGuardPost({ commandBlocks: next }, false, id !== '' ? 'Rule ' + id + ' saved.' : 'Blocked-command rule added.')
        if (saved) setBlockDraft(null)
      }, [blockDraft, guard, runGuardPost])

      const onToggleBlock = React.useCallback(async (rule, enabled) => {
        const existing = rulesOf(guard)
        const next = existing.map((entry) => (entry.id === rule.id ? Object.assign({}, entry, { enabled: enabled === true }) : entry))
        await runGuardPost({ commandBlocks: next }, false, 'Rule ' + rule.id + (enabled === true ? ' enabled.' : ' disabled.'))
      }, [guard, runGuardPost])

      const onDeleteBlock = React.useCallback(async (rule) => {
        const existing = rulesOf(guard)
        const next = existing.filter((entry) => entry.id !== rule.id)
        const deleted = await runGuardPost({ commandBlocks: next }, false, 'Rule ' + rule.id + ' deleted.')
        if (deleted) setBlockDraft((previous) => (previous !== null && previous.id === rule.id ? null : previous))
      }, [guard, runGuardPost])

      const guardConfig = guard !== null && typeof guard === 'object' && guard.config ? guard.config : DEFAULT_GUARD_CONFIG
      const guardStats = guard !== null && typeof guard === 'object' ? guard.stats : null
      const guardSaved = savedGuard !== null && typeof savedGuard === 'object' && savedGuard.config ? savedGuard.config : null
      const toolsValue = toolsDraft !== null ? toolsDraft : (Array.isArray(guardConfig.tools) ? guardConfig.tools.join(', ') : '')
      const floorValue = floorDraft !== null ? floorDraft : String(guardConfig.confidenceFloor)
      const draftFloor = String(floorValue).trim() === '' ? DEFAULT_GUARD_CONFIG.confidenceFloor : normalizeFloor(Number(floorValue))
      const guardDirty = guardSaved !== null &&
        JSON.stringify(guardFormPatch(Object.assign({}, guardConfig, { tools: parseTools(toolsValue), confidenceFloor: draftFloor }))) !== JSON.stringify(guardFormPatch(guardSaved))

      const configured = cred ? cred.configured === true : false
      const catalogNames = models.map((entry) => entry.name).filter((name) => typeof name === 'string' && name !== '')
      const modelOptions = catalogNames.length > 0 ? catalogNames : MODEL_FALLBACK
      const totals = stats && stats.totals ? stats.totals : null
      const byModel = stats && stats.byModel ? Object.keys(stats.byModel).map((name) => Object.assign({ name }, stats.byModel[name])).sort((a, b) => (b.calls || 0) - (a.calls || 0)) : []
      const sourceUsage = stats && stats.bySource ? stats.bySource : null
      const bySource = sourceUsage
        ? [
            { key: 'tool', label: 'From the model (jev_ask)', usage: sourceUsage.tool || { calls: 0, inputTokens: 0, costUsd: 0 } },
            { key: 'host', label: 'From plugins (host service)', usage: sourceUsage.host || { calls: 0, inputTokens: 0, costUsd: 0 } },
            // The command guard is its own bucket. Omitting it here hid exactly
            // the figure that decides whether the guard is worth running.
            { key: 'guard', label: 'From the command guard', usage: sourceUsage.guard || { calls: 0, inputTokens: 0, costUsd: 0 } },
          ].filter((entry) => (entry.usage.calls || 0) > 0)
        : []

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' } },
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'TypeSafe API key'),
          React.createElement('div', { className: 'dshJevHint' },
            'Jev is TypeSafe\u0027s System One decision model. The key is stored as the "typesafe" credential and used only by the host, which calls api.typesafe.ai on your behalf. Get one from console.typesafe.ai/keys.'),
          React.createElement(KeyMenu, { credential: cred, keyDraft, setKeyDraft, savingKey, onSaveKey, onRemoveKey }),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Default model'),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('input', {
              className: 'dshJevGrow',
              list: 'dshJevModelList',
              value: modelDraft,
              placeholder: 'jev-latest',
              spellCheck: false,
              onChange: (event) => setModelDraft(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') onSaveModel() },
            }),
            React.createElement('datalist', { id: 'dshJevModelList' }, modelOptions.map((name) => React.createElement('option', { key: name, value: name }))),
            React.createElement('button', { type: 'button', className: 'dshJevBtn', disabled: savingModel || modelDraft.trim() === '' || modelDraft.trim() === savedModel, onClick: onSaveModel },
              savingModel ? 'Saving…' : 'Save'),
          ),
          React.createElement('div', { className: 'dshJevHint' },
            'The assistant\u0027s jev_ask calls use this model unless it names one itself. Current: ' + (savedModel || 'jev-latest') + '.'),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Overall usage'),
          statsError ? React.createElement('div', { className: 'dshJevErr' }, 'Stats unavailable: ' + statsError) : null,
          totals
            ? React.createElement('div', { className: 'dshJevStatGrid' },
                statCell('Jev calls', String(totals.calls)),
                statCell('Input tokens', formatTokens(totals.inputTokens)),
                statCell('Output tokens', formatTokens(totals.outputTokens)),
                statCell('Estimated cost', formatCost(totals.costUsd)),
              )
            : React.createElement('div', { className: 'dshJevHint' }, 'No calls recorded yet.'),
          React.createElement('div', { className: 'dshJevHint' },
            (stats ? stats.sessionsTracked : 0) + ' chat session(s) billed' +
            (stats && stats.lastCall ? '. Last: ' + stats.lastCall.model + ' at ' + stats.lastCall.at : '.')),
          bySource.length > 0
            ? React.createElement('ul', { className: 'dshJevModelList' }, bySource.map((entry) => React.createElement('li', { className: 'dshJevModel', key: entry.key },
                React.createElement('b', null, entry.label),
                React.createElement('span', null, entry.usage.calls + ' call(s) · ' + formatTokens(entry.usage.inputTokens) + ' in · ' + formatCost(entry.usage.costUsd)),
              )))
            : null,
          byModel.length > 0
            ? React.createElement('ul', { className: 'dshJevModelList' }, byModel.slice(0, 5).map((entry) => React.createElement('li', { className: 'dshJevModel', key: entry.name },
                React.createElement('b', null, entry.name),
                React.createElement('span', null, entry.calls + ' call(s) · ' + formatTokens(entry.inputTokens) + ' in · ' + formatCost(entry.costUsd)),
              )))
            : null,
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Catalog'),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: onTest, disabled: testing || !configured }, testing ? 'Testing…' : 'Test connection / refresh'),
            React.createElement('span', { className: 'dshJevHint' },
              modelsError ? 'Unavailable: ' + modelsError : models.length + ' model name(s) known.'),
          ),
          models.length > 0
            ? React.createElement('ul', { className: 'dshJevModelList' }, models.slice(0, 6).map((entry) => React.createElement('li', { className: 'dshJevModel', key: entry.name },
                React.createElement('b', null, entry.name),
                React.createElement('span', null, (entry.description || '') + (entry.releaseDate ? ' · ' + entry.releaseDate : '')),
              )))
            : null,
        ),
        renderGuardPanel({
          config: guardConfig,
          stats: guardStats,
          error: guardError,
          loaded: guardSaved !== null,
          dirty: guardDirty,
          saving: savingGuard,
          toolsValue,
          floorValue,
          onPatch: patchGuard,
          onTools: setToolsDraft,
          onFloor: setFloorDraft,
          onSave: onSaveGuard,
        }),
        renderBlockedCommandsPanel({
          rules: rulesOf(guard),
          draft: blockDraft,
          error: guardError,
          saving: savingGuard,
          onPatchDraft: patchBlockDraft,
          onSaveDraft: onSaveBlock,
          onCancelDraft: onCancelBlock,
          onEdit: onEditBlock,
          onDelete: onDeleteBlock,
          onToggle: onToggleBlock,
        }),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'How the numbers are made'),
          React.createElement('div', { className: 'dshJevHint' },
            'Cost is computed from the usage the API returns: input tokens at the published $0.042 per million (output tokens are free). It is a metered estimate, not a billing statement. The chat chip reads the jevUsage session projection, so it counts the model\u0027s jev_ask calls and travels with the session. Calls a sibling plugin makes through the host service are counted here in the totals but cannot reach that chip, which is why they are listed separately above.'),
        ),
        error ? React.createElement('div', { className: 'dshJevErr' }, error) : null,
        notice ? React.createElement('div', { className: 'dshJevOk' }, notice) : null,
      )
    }

    /** Services required before the contributions can register. */
    const inject = ['slots']

    /**
     * Client plugin body: contribute the Settings plugins tab and the composer-dock
     * stats chip.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ensureStyles()
      ctx.effect(
        () => ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            { name: 'settings.plugins.tab', id: 'jev', order: 40, label: 'Jev (TypeSafe)' },
            JevSettingsTab,
          )),
        'dsh-plugin-jev: Settings plugins tab',
      )
      ctx.effect(
        () => ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'jev-stats', order: 30 },
            JevStatsPill,
          )),
        'dsh-plugin-jev: composer dock stats chip',
      )
    }

    return {
      apply,
      inject,
      JevSettingsTab,
      JevStatsPill,
      KeyMenu,
      formatCost,
      formatTokens,
      formatJevStats,
      JEV_USAGE_KEY,
      MODEL_FALLBACK,
      guardFormPatch,
      guardLabelFor,
      blockToDraft,
      matchRuleNote,
      denialRows,
      formatDenialWhen,
      denialDetail,
      denialAction,
      denialCounts,
      badgeLabel,
      guardScored,
      guardAllTimeLine,
      isLongCommand,
      renderModal,
      prefilterNote,
      parsePrefilter,
      renderDenialPanelBody,
      ROUTE_BASE,
      DEFAULT_GUARD_CONFIG,
      SEVERITY_BANDS,
    }
  },
})
