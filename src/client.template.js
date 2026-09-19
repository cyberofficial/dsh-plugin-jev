/*
 * Browser half of the TypeSafe Jev plugin — GENERATED FILE.
 *
 * Built verbatim from src/client.template.js by scripts/build-client.mjs; do not
 * edit lib/client.js directly. Edit the template and rebuild.
 *
 * Two contributions:
 *   - a "Jev (TypeSafe)" tab in settings.plugins.tab: API key, model choice,
 *     overall usage totals, and the model catalog the key unlocks; and
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

    /**
     * The "Jev (TypeSafe)" Settings -> Plugins tab: API key, the model the tool
     * defaults to, overall usage totals, and the catalog the key can see.
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

      React.useEffect(() => {
        mounted.current = true
        readStatus().then(
          (info) => { if (mounted.current) setCred(info) },
          () => { if (mounted.current) setCred({ configured: false, writable: false }) },
        )
        loadCatalog(false)
        loadSettings()
        loadStats()
        return () => { mounted.current = false }
      }, [loadCatalog, loadSettings, loadStats])

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

      const configured = cred ? cred.configured === true : false
      const catalogNames = models.map((entry) => entry.name).filter((name) => typeof name === 'string' && name !== '')
      const modelOptions = catalogNames.length > 0 ? catalogNames : MODEL_FALLBACK
      const totals = stats && stats.totals ? stats.totals : null
      const byModel = stats && stats.byModel ? Object.keys(stats.byModel).map((name) => Object.assign({ name }, stats.byModel[name])).sort((a, b) => (b.calls || 0) - (a.calls || 0)) : []

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
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'How the numbers are made'),
          React.createElement('div', { className: 'dshJevHint' },
            'Cost is computed from the usage the API returns: input tokens at the published $0.042 per million (output tokens are free). It is a metered estimate, not a billing statement. The chat chip reads the jevUsage session projection, so it is exact for this chat and travels with the session.'),
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
    }
  },
})
