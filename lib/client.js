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
 *   - a read-only stats chip in conversation.composer.dock showing how many
 *     times Jev ran in THIS chat and what it cost.
 * The plugin is agent-facing — the model calls the host's jev_ask tool on its
 * own — so there is no human query console. No credential ever reaches this
 * file; only same-origin host routes do.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-jev',
  factory: (require) => {
    const React = require('react')

    const ROUTE_BASE = '/plugins/dsh-plugin-jev/api'
    const MODELS_ROUTE = ROUTE_BASE + '/models'
    const STATUS_ROUTE = ROUTE_BASE + '/status'
    const KEY_ROUTE = ROUTE_BASE + '/key'
    const SETTINGS_ROUTE = ROUTE_BASE + '/settings'
    const STATS_ROUTE = ROUTE_BASE + '/stats'

    /** The session projection key the dock chip reads. */
    const JEV_USAGE_KEY = 'jevUsage'

    const MODEL_FALLBACK = ['jev-latest', 'jev-preview', 'jev-1.13.0']

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
      commandBlocks: [],
    }

    /** A blank rule, as the add form holds it. */
    const EMPTY_BLOCK_DRAFT = { id: '', intent: '', patternsText: '', scope: 'global', absolute: false, enabled: true }

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
      '.dshJevBlockHead>b{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:600}',
      '.dshJevTag{border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-caption);text-transform:uppercase;letter-spacing:.03em}',
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
      return {
        id: typeof source.id === 'string' ? source.id : '',
        intent: typeof source.intent === 'string' ? source.intent : '',
        patternsText: patterns.join('\n'),
        scope: source.scope === 'workspace' ? 'workspace' : 'global',
        absolute: source.absolute === true,
        enabled: source.enabled !== false,
      }
    }

    /** The patterns textarea: one pattern per line, trimmed, blanks dropped. */
    function parsePatterns(text) {
      if (typeof text !== 'string') return []
      return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
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
     * The read-only composer-dock chip: how many times Jev ran in this chat and
     * what it cost. Always renders — a chat with no calls shows "0 calls · $0" so
     * the meter is discoverable before the first call. The value arrives through
     * the host's jevUsage session projection.
     * @param props - the dock's session seat (the projection reader).
     */
    function JevStatsPill(props) {
      const useProjection = props && props.useProjection
      const usage = typeof useProjection === 'function' ? useProjection(JEV_USAGE_KEY) : undefined
      const calls = usage !== null && typeof usage === 'object' && Number.isFinite(usage.calls) && usage.calls > 0 ? usage.calls : 0
      const cost = usage !== null && typeof usage === 'object' && Number.isFinite(usage.costUsd) ? usage.costUsd : 0
      return React.createElement('div', { className: 'dshJevDock' },
        React.createElement('span', {
          className: 'dshJevStats',
          'data-empty': calls === 0 ? 'true' : undefined,
          title: calls === 0 ? 'Jev has not run in this chat yet' : 'Jev calls and estimated cost in this chat',
        },
          React.createElement('span', { className: 'dshJevStatsName' }, 'Jev'),
          React.createElement('span', { className: 'dshJevStatsSep' }, '·'),
          React.createElement('span', null, calls === 1 ? '1 call' : calls + ' calls'),
          React.createElement('span', { className: 'dshJevStatsSep' }, '·'),
          React.createElement('span', null, formatCost(cost)),
        ),
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
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('button', { type: 'button', className: 'dshJevBtn', disabled: props.saving || !props.loaded || !props.dirty, onClick: props.onSave },
            props.saving ? 'Saving…' : 'Save guard settings'),
          React.createElement('span', { className: 'dshJevHint' }, !props.loaded ? 'Loading guard settings…' : props.dirty ? 'Unsaved changes.' : 'Saved.'),
        ),
        React.createElement('div', { className: 'dshJevStatGrid' },
          statCell('Evaluated', guardCount(stats, 'evaluated')),
          statCell('Blocked literal', guardCount(stats, 'blockedLiteral')),
          statCell('Blocked semantic', guardCount(stats, 'blockedSemantic')),
          statCell('Blocked danger', guardCount(stats, 'blockedDanger')),
          statCell('Downgraded', guardCount(stats, 'downgraded')),
          statCell('Guard failures', guardCount(stats, 'failures')),
          statCell('Cache hits / entries', guardCount(stats, 'cached') + ' / ' + guardCount(stats, 'cachedEntries')),
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
      guardLabelFor,
      blockToDraft,
      matchRuleNote,
      DEFAULT_GUARD_CONFIG,
      SEVERITY_BANDS,
    }
  },
})
