/*
 * Browser half of the TypeSafe Jev plugin — GENERATED FILE.
 *
 * Built verbatim from src/client.template.js by scripts/build-client.mjs; do not
 * edit lib/client.js directly. Edit the template and rebuild.
 *
 * One contribution: a "Jev (TypeSafe)" tab in settings.plugins.tab that owns the
 * API key and shows the model catalog. The plugin is agent-facing — the model
 * calls the host's jev_ask tool on its own — so there is no human query console
 * under the composer. No credential ever reaches this file; only same-origin
 * host routes do.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-jev',
  factory: (require) => {
    const React = require('react')

    const ROUTE_BASE = '/plugins/dsh-plugin-jev/api'
    const MODELS_ROUTE = ROUTE_BASE + '/models'
    const STATUS_ROUTE = ROUTE_BASE + '/status'
    const KEY_ROUTE = ROUTE_BASE + '/key'

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
    async function saveKey(value) {
      return readJson(KEY_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
    }
    async function removeKey() {
      return readJson(KEY_ROUTE, { method: 'DELETE' })
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
     * The "Jev (TypeSafe)" Settings -> Plugins tab: the canonical home for the
     * API key, plus catalog status. The query console that used to live under the
     * composer is gone; the model calls the jev_ask host tool on its own.
     */
    function JevSettingsTab() {
      const [cred, setCred] = React.useState(null)
      const [models, setModels] = React.useState([])
      const [modelsError, setModelsError] = React.useState(null)
      const [keyDraft, setKeyDraft] = React.useState('')
      const [savingKey, setSavingKey] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
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

      React.useEffect(() => {
        mounted.current = true
        readStatus().then(
          (info) => { if (mounted.current) setCred(info) },
          () => { if (mounted.current) setCred({ configured: false, writable: false }) },
        )
        loadCatalog(false)
        return () => { mounted.current = false }
      }, [loadCatalog])

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
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setSavingKey(false)
        }
      }, [keyDraft, loadCatalog])

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
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setTesting(false)
        }
      }, [])

      const configured = cred ? cred.configured === true : false
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' } },
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'TypeSafe API key'),
          React.createElement('div', { className: 'dshJevHint' },
            'Jev is TypeSafe\u0027s System One decision model. The key is stored as the "typesafe" credential and used only by the host, which calls api.typesafe.ai on your behalf. Get one from console.typesafe.ai/keys.'),
          React.createElement(KeyMenu, { credential: cred, keyDraft, setKeyDraft, savingKey, onSaveKey, onRemoveKey }),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Catalog'),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: onTest, disabled: testing || !configured }, testing ? 'Testing…' : 'Test connection / refresh'),
            React.createElement('span', { className: 'dshJevHint' },
              modelsError
                ? 'Unavailable: ' + modelsError
                : models.length > 0
                  ? models.length + ' model name(s): ' + models.slice(0, 6).map((entry) => entry.name).join(', ') + (models.length > 6 ? ', …' : '')
                  : 'No catalog reading yet. Known aliases: ' + MODEL_FALLBACK.join(', ') + '.'),
          ),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Automatic use'),
          React.createElement('div', { className: 'dshJevHint' },
            'There is no Jev pill or console under the chat input. The assistant calls the host\u0027s jev_ask tool on its own when a decision needs calibrated judgment, and the answers appear inline in the conversation. This tab is only for the key and catalog.'),
        ),
        error ? React.createElement('div', { className: 'dshJevErr' }, error) : null,
        notice ? React.createElement('div', { className: 'dshJevOk' }, notice) : null,
      )
    }

    /** Services required before the contribution can register. */
    const inject = ['slots']

    /**
     * Client plugin body: contribute the Settings -> Plugins "Jev (TypeSafe)" tab.
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
    }

    return {
      apply,
      inject,
      JevSettingsTab,
      KeyMenu,
      MODEL_FALLBACK,
    }
  },
})
