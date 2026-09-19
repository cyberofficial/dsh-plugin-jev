/*
 * Browser half of the TypeSafe Jev plugin — GENERATED FILE.
 *
 * Built verbatim from src/client.template.js by scripts/build-client.mjs; do not
 * edit lib/client.js directly. Edit the template and rebuild.
 *
 * Two contributions share one API key:
 *   - a Jev pill in conversation.composer.dock that opens a modal console for
 *     asking typed Choice/Score/Noul questions about the current chat or a
 *     custom state, and
 *   - a "Jev (TypeSafe)" tab in settings.plugins.tab that owns the API key,
 *     default model, and catalog status.
 * No credential ever reaches this file; only the same-origin host routes do.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-jev',
  factory: (require) => {
    const React = require('react')

    const Primitives = (() => {
      try {
        const maybe = require('@deepseek-ai/dsh-client-ui-primitives')
        return maybe && typeof maybe.Modal === 'function' ? maybe : null
      } catch (error) {
        return null
      }
    })()
    const ReactDOM = (() => {
      try {
        const maybe = require('react-dom')
        return maybe && typeof maybe.createPortal === 'function' ? maybe : null
      } catch (error) {
        return null
      }
    })()

    const ROUTE_BASE = '/plugins/dsh-plugin-jev/api'
    const ASK_ROUTE = ROUTE_BASE + '/ask'
    const MODELS_ROUTE = ROUTE_BASE + '/models'
    const STATUS_ROUTE = ROUTE_BASE + '/status'
    const KEY_ROUTE = ROUTE_BASE + '/key'
    const TRANSCRIPT_ROUTE = ROUTE_BASE + '/transcript'

    const STORAGE_KEY = 'dsh-plugin-jev/form.v1'

    const MODEL_FALLBACK = ['jev-latest', 'jev-preview', 'jev-1.13.0']

    let uidCounter = 0
    const nextUid = () => (uidCounter += 1)

    const CSS = [
      '.dshJevDock{box-sizing:border-box;width:100%;order:30;padding:2px calc(var(--dsh-composer-side-clearance) + 16px) 8px;margin:0 auto;display:flex;justify-content:center;flex-direction:column;align-items:center}',
      '.dshJevCard{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}',
      '.dshJevCard svg{flex:none;width:14px;height:14px}',
      'button.dshJevCard{cursor:pointer}',
      'button.dshJevCard:hover,button.dshJevCard[aria-busy=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshJevCard[data-state=error]{color:var(--dsw-alias-label-caption)}',
      '.dshJevCard[data-state=loading]{opacity:.7}',
      '.dshJevName{font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.dshJevCard[data-state=error] .dshJevName{font-weight:400;color:inherit}',
      '.dshJevSep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
      '.dshJevPill{display:inline-block;font-size:11px;padding:0 5px;border-radius:6px;background:var(--dsw-alias-bg-elevated-2,rgba(255,255,255,.04));color:var(--dsw-alias-label-caption)}',
      '.dshJevModal{width:min(820px,100%)}',
      '.dshJevBody{padding:8px 12px 12px;overflow-y:auto;max-height:min(70vh,640px);display:flex;flex-direction:column;gap:10px}',
      '.dshJevOverlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);box-sizing:border-box;overflow-y:auto;padding:40px 16px 24px;display:flex;align-items:flex-start;justify-content:center}',
      '.dshJevDialog{width:min(820px,100%);max-height:calc(100vh - 64px);display:flex;flex-direction:column;background:var(--dsw-specific-tip,#1c1f28);border:.5px solid var(--dsw-alias-border-l1);border-radius:14px;color:var(--dsw-alias-label-primary);box-shadow:0 12px 40px rgba(0,0,0,.4)}',
      '.dshJevHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.dshJevClose{flex:none;background:0 0;border:none;color:var(--dsw-alias-label-caption);font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}',
      '.dshJevClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshJevSection{display:flex;flex-direction:column;gap:6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px}',
      '.dshJevSection>h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-caption);text-transform:uppercase;letter-spacing:.03em}',
      '.dshJevRow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.dshJevRow input,.dshJevRow select,.dshJevRow textarea{background:var(--dsw-alias-input-bg,#12151e);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font-size:12px;box-sizing:border-box}',
      '.dshJevRow textarea{width:100%;min-height:120px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.45}',
      '.dshJevGrow{flex:1;min-width:140px}',
      '.dshJevBtn{background:var(--dsw-alias-accent,var(--dsw-alias-state-accent,#5b8def));color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer}',
      '.dshJevBtn:disabled{opacity:.5;cursor:not-allowed}',
      '.dshJevBtn.ghost{background:0 0;color:var(--dsw-alias-label-caption);border:.5px solid var(--dsw-alias-border-l1);font-weight:400}',
      '.dshJevBtn.subtle{background:0 0;border:none;color:var(--dsw-alias-label-tertiary);font-weight:400;padding:2px 6px}',
      '.dshJevBtn.subtle:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dshJevHint{color:var(--dsw-alias-label-caption);font-size:11px}',
      '.dshJevErr{color:var(--dsw-alias-state-danger-primary,#ef6b6b);font-size:12px;white-space:pre-wrap}',
      '.dshJevOk{color:var(--dsw-alias-state-success-primary,#3dd68c);font-size:12px}',
      '.dshJevKey{display:flex;gap:6px;padding:2px 0;align-items:center;flex-wrap:wrap}',
      '.dshJevKey input{flex:1;min-width:200px;background:var(--dsw-alias-input-bg,#12151e);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.dshJevAnswer{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px}',
      '.dshJevAnswerHead{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:12px}',
      '.dshJevAnswerHead b{color:var(--dsw-alias-label-primary)}',
      '.dshJevBar{position:relative;height:16px;border-radius:6px;background:var(--dsw-alias-bg-elevated-2,rgba(255,255,255,.05));overflow:hidden}',
      '.dshJevBar>span{position:absolute;left:0;top:0;bottom:0;background:var(--dsw-alias-accent,var(--dsw-alias-state-accent,#5b8def));opacity:.85}',
      '.dshJevBarLabel{position:relative;z-index:1;display:flex;justify-content:space-between;padding:0 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary)}',
      '.dshJevProb{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}',
      '.dshJevQ{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}',
      '.dshJevQHead{display:flex;gap:6px;align-items:center}',
      '.dshJevOpt{display:flex;gap:6px;align-items:center}',
      '.dshJevOpt input{flex:1}',
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

    function SparkIcon() {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        React.createElement('path', { d: 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.6 3.6l2.1 2.1M10.3 10.3l2.1 2.1M12.4 3.6l-2.1 2.1M5.7 10.3l-2.1 2.1' }),
      )
    }

    function newQuestion(type) {
      const base = { uid: nextUid(), id: '', type: type || 'noul', instructions: '', yes: '', no: '', options: [], levels: [] }
      if (base.type === 'choice') base.options = [{ key: '', desc: '' }, { key: '', desc: '' }]
      if (base.type === 'score') base.levels = ['', '']
      return base
    }

    function defaultRows() {
      return [
        { uid: nextUid(), id: 'is_urgent', type: 'noul', instructions: 'Does this convey urgency or time-sensitivity?', yes: 'Explicitly time-sensitive', no: 'No urgency expressed', options: [], levels: [] },
        { uid: nextUid(), id: 'topic', type: 'choice', instructions: 'Which area does this concern?', yes: '', no: '', levels: [], options: [{ key: 'billing', desc: 'payments, refunds, invoices' }, { key: 'technical', desc: 'bugs, outages, integrations' }, { key: 'other', desc: '' }] },
        { uid: nextUid(), id: 'tone', type: 'score', instructions: 'How negative is the tone?', yes: '', no: '', options: [], levels: ['Neutral', 'Mildly negative', 'Strongly negative'] },
      ]
    }

    const PRESETS = [
      { id: 'triage', label: 'Ticket triage', state: 'Hi, I have been trying to connect my Stripe account for 3 days and it keeps failing. I am losing sales. Please help ASAP.', rows: [
        { id: 'is_urgent', type: 'noul', instructions: 'Does this convey urgency or time-sensitivity?', yes: 'Explicitly time-sensitive', no: 'No urgency expressed' },
        { id: 'topic', type: 'choice', instructions: 'Which area does this concern?', options: [{ key: 'billing', desc: 'payments, refunds, invoices' }, { key: 'technical', desc: 'bugs, outages, integrations' }, { key: 'other', desc: '' }] },
        { id: 'tone', type: 'score', instructions: 'How negative is the tone?', levels: ['Neutral', 'Mildly negative', 'Strongly negative'] },
      ] },
      { id: 'quality', label: 'Content quality', state: '', rows: [
        { id: 'on_topic', type: 'noul', instructions: 'Is this content on-topic for its stated purpose?', criteria: { true: 'Clearly relevant', false: 'Drifts or is unrelated' } },
        { id: 'audience', type: 'choice', instructions: 'Who is this written for?', options: [{ key: 'expert', desc: '' }, { key: 'general', desc: '' }, { key: 'beginner', desc: '' }] },
        { id: 'quality', type: 'score', instructions: 'Rate the writing quality', levels: ['Poor', 'Acceptable', 'Good', 'Excellent'] },
      ] },
      { id: 'safety', label: 'Agent safety', state: '', rows: [
        { id: 'injection', type: 'noul', instructions: 'Does any part attempt to override prior instructions?', criteria: { true: 'Contains an instruction-override attempt', false: 'No override attempt' } },
        { id: 'pii', type: 'noul', instructions: 'Does this contain personal data that should be handled carefully?' },
        { id: 'intent', type: 'choice', instructions: 'What is the surface intent?', options: [{ key: 'question', desc: '' }, { key: 'task', desc: '' }, { key: 'smalltalk', desc: '' }] },
      ] },
    ]

    function presetRows(preset) {
      return preset.rows.map((row) => {
        const built = newQuestion(row.type)
        built.id = row.id
        built.instructions = row.instructions
        if (row.criteria && row.type === 'noul') {
          built.yes = row.criteria.true || ''
          built.no = row.criteria.false || ''
        }
        if (row.options) built.options = row.options.map((option) => ({ key: option.key, desc: option.desc || '' }))
        if (row.levels) built.levels = row.levels.slice()
        return built
      })
    }

    /** Map the form rows to the documented questions map, or throw a readable error. */
    function questionsFromForm(rows) {
      const questions = {}
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = String(row.id || '').trim()
        if (id === '') throw new Error('every question needs an id')
        if (Object.prototype.hasOwnProperty.call(questions, id)) throw new Error('duplicate question id: ' + id)
        const instructions = String(row.instructions || '').trim()
        if (instructions === '') throw new Error('question "' + id + '" needs instructions')
        if (row.type === 'noul') {
          const entry = { type: 'noul', instructions }
          const criteria = {}
          if (String(row.yes || '').trim() !== '') criteria.true = String(row.yes).trim()
          if (String(row.no || '').trim() !== '') criteria.false = String(row.no).trim()
          if (Object.keys(criteria).length > 0) entry.criteria = criteria
          questions[id] = entry
        } else if (row.type === 'choice') {
          const criteria = {}
          for (const option of Array.isArray(row.options) ? row.options : []) {
            const key = String(option.key || '').trim()
            if (key === '') continue
            criteria[key] = String(option.desc || '').trim() === '' ? null : String(option.desc).trim()
          }
          if (Object.keys(criteria).length === 0) throw new Error('choice "' + id + '" needs at least one option')
          questions[id] = { type: 'choice', instructions, criteria }
        } else {
          const levels = (Array.isArray(row.levels) ? row.levels : []).map((level) => String(level).trim()).filter((level) => level !== '')
          if (levels.length < 2) throw new Error('score "' + id + '" needs at least two levels')
          questions[id] = { type: 'score', instructions, criteria: levels }
        }
      }
      if (Object.keys(questions).length === 0) throw new Error('add at least one question')
      return { questions }
    }

    function estimateTokens(text) {
      return Math.ceil(String(text || '').length / 4)
    }

    function formatTokens(tokens) {
      if (!Number.isFinite(tokens)) return '—'
      return tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : String(tokens)
    }

    function formatCost(value) {
      if (!Number.isFinite(value)) return '—'
      if (value === 0) return '$0'
      if (Math.abs(value) < 0.0001) return '$' + value.toPrecision(2)
      if (Math.abs(value) < 1) return '$' + value.toFixed(4)
      return '$' + value.toFixed(2)
    }

    function formatPercent(value) {
      if (!Number.isFinite(value)) return '—'
      const pct = value * 100
      if (pct >= 99.95) return '100%'
      return (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + '%'
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
    const readTranscript = (sessionId, maxChars) => readJson(TRANSCRIPT_ROUTE + '?session=' + encodeURIComponent(sessionId) + (maxChars ? '&maxChars=' + maxChars : ''))
    const ask = (body) => readJson(ASK_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    async function saveKey(value) {
      return readJson(KEY_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
    }
    async function removeKey() {
      return readJson(KEY_ROUTE, { method: 'DELETE' })
    }

    function loadStored() {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : null
      } catch (error) {
        return null
      }
    }
    function storeForm(form) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
      } catch (error) {
        // best effort only
      }
    }

    /**
     * The shared key control. Configured keys show their source (never a value)
     * and offer Remove when the primary "typesafe" record is writable; an absent
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

    function probabilityBar(key, value, label) {
      const width = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100
      return React.createElement('div', { className: 'dshJevBar', key },
        React.createElement('span', { style: { width: width + '%' } }),
        React.createElement('div', { className: 'dshJevBarLabel' },
          React.createElement('span', null, label),
          React.createElement('span', { className: 'dshJevProb' }, formatPercent(value)),
        ),
      )
    }

    /** Render one typed answer: value, probabilities, and confidence. */
    function AnswerView(props) {
      const answer = props.answer && typeof props.answer === 'object' ? props.answer : {}
      const type = answer.type
      const head = React.createElement('div', { className: 'dshJevAnswerHead' },
        React.createElement('b', null, props.id),
        type === 'noul'
          ? React.createElement('span', { className: 'dshJevProb', title: 'probability the answer is yes' }, 'yes ' + formatPercent(answer.noul))
          : type === 'choice'
            ? React.createElement('span', { className: 'dshJevProb' },
                'chosen: ' + String(answer.choice == null ? '—' : answer.choice) +
                (Number.isFinite(answer.confidence) ? ' · confidence ' + formatPercent(answer.confidence) : ''))
            : React.createElement('span', { className: 'dshJevProb' },
                'score ' + (Number.isFinite(answer.score) ? answer.score.toFixed(2) : '—') +
                (Number.isFinite(answer.confidence) ? ' · confidence ' + formatPercent(answer.confidence) : '')),
      )
      const bars = []
      if (type === 'noul') {
        bars.push(probabilityBar('yes', answer.noul, 'yes'))
        bars.push(probabilityBar('no', 1 - answer.noul, 'no'))
      } else if (type === 'choice') {
        const probabilities = answer.probabilities !== null && typeof answer.probabilities === 'object' ? answer.probabilities : {}
        const entries = Object.keys(probabilities).map((key) => [key, probabilities[key]]).sort((a, b) => Number(b[1]) - Number(a[1]))
        for (const entry of entries) bars.push(probabilityBar(entry[0], entry[1], entry[0]))
      } else if (type === 'score') {
        const legend = answer.legend !== null && typeof answer.legend === 'object' ? answer.legend : null
        const probabilities = answer.probabilities !== null && typeof answer.probabilities === 'object' ? answer.probabilities : null
        if (probabilities !== null) {
          const entries = Object.keys(probabilities).map((key) => [key, probabilities[key]]).sort((a, b) => Number(a[0]) - Number(b[0]))
          for (const entry of entries) {
            const label = legend && legend[entry[0]] != null ? String(legend[entry[0]]) : 'level ' + entry[0]
            bars.push(probabilityBar(entry[0], entry[1], label))
          }
        } else if (legend !== null) {
          for (const key of Object.keys(legend)) bars.push(React.createElement('div', { className: 'dshJevProb', key }, key + ' — ' + String(legend[key])))
        }
      }
      return React.createElement('div', { className: 'dshJevAnswer' }, head, bars)
    }

    /**
     * The composer-dock console. Reads credential/catalog status from the host,
     * lets the user build a state and a set of typed questions, runs one ask, and
     * renders the structured answers.
     */
    function JevDock(props) {
      const sessionId = props && props.sessionId
      const storedRef = React.useRef(undefined)
      if (storedRef.current === undefined) storedRef.current = loadStored() || {}
      const stored = storedRef.current

      const [cred, setCred] = React.useState(null)
      const [models, setModels] = React.useState(MODEL_FALLBACK)
      const [modelsError, setModelsError] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [keyDraft, setKeyDraft] = React.useState('')
      const [savingKey, setSavingKey] = React.useState(false)

      const [model, setModel] = React.useState(typeof stored.model === 'string' && stored.model ? stored.model : 'jev-latest')
      const [source, setSource] = React.useState(stored.source === 'custom' ? 'custom' : 'chat')
      const [custom, setCustom] = React.useState(typeof stored.custom === 'string' ? stored.custom : '')
      const [rows, setRows] = React.useState(
        Array.isArray(stored.rows) && stored.rows.length > 0
          ? stored.rows.map((row) => Object.assign(newQuestion(row.type), row, { uid: nextUid() }))
          : defaultRows(),
      )
      const [chat, setChat] = React.useState({ text: '', chars: 0, messages: 0, loading: false, error: null, available: false })
      const [running, setRunning] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [runError, setRunError] = React.useState(null)

      const mounted = React.useRef(false)
      const generation = React.useRef(0)

      const refreshCatalog = React.useCallback(() => {
        readModels(false).then(
          (payload) => {
            if (!mounted.current) return
            setModelsError(null)
            if (payload && Array.isArray(payload.models) && payload.models.length > 0) {
              setModels(payload.models.map((entry) => entry.name).filter((name) => typeof name === 'string' && name !== ''))
            }
          },
          (error) => { if (mounted.current) setModelsError(String((error && error.message) || error)) },
        )
      }, [])

      React.useEffect(() => {
        mounted.current = true
        readStatus().then(
          (info) => { if (mounted.current) setCred(info) },
          () => { if (mounted.current) setCred({ configured: false, writable: false }) },
        )
        refreshCatalog()
        return () => { mounted.current = false; generation.current += 1 }
      }, [refreshCatalog])

      const loadTranscript = React.useCallback(() => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setChat({ text: '', chars: 0, messages: 0, loading: false, error: 'no active session', available: false })
          return
        }
        const mine = (generation.current += 1)
        setChat((previous) => Object.assign({}, previous, { loading: true, error: null }))
        readTranscript(sessionId).then(
          (payload) => {
            if (generation.current !== mine) return
            if (payload && payload.available) {
              setChat({ text: payload.text || '', chars: payload.chars || 0, messages: payload.messages || 0, loading: false, error: null, available: true })
            } else {
              setChat({ text: '', chars: 0, messages: 0, loading: false, error: payload && payload.reason ? String(payload.reason) : 'transcript unavailable', available: false })
            }
          },
          (error) => {
            if (generation.current !== mine) return
            setChat({ text: '', chars: 0, messages: 0, loading: false, error: String((error && error.message) || error), available: false })
          },
        )
      }, [sessionId])

      React.useEffect(() => {
        if (open && source === 'chat' && !chat.available && !chat.loading && chat.error === null) loadTranscript()
      }, [open, source, chat.available, chat.loading, chat.error, loadTranscript])

      React.useEffect(() => {
        storeForm({ model, source, custom, rows })
      }, [model, source, custom, rows])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open])

      const onSaveKey = React.useCallback(async () => {
        const value = keyDraft.trim()
        if (value === '') return
        setSavingKey(true)
        setRunError(null)
        try {
          await saveKey(value)
          setKeyDraft('')
          setCred(await readStatus())
          refreshCatalog()
        } catch (error) {
          setRunError(String((error && error.message) || error))
        } finally {
          setSavingKey(false)
        }
      }, [keyDraft, refreshCatalog])

      const onRemoveKey = React.useCallback(async () => {
        setSavingKey(true)
        setRunError(null)
        try {
          await removeKey()
          setCred(await readStatus())
        } catch (error) {
          setRunError(String((error && error.message) || error))
        } finally {
          setSavingKey(false)
        }
      }, [])

      const patchRow = (uid, patch) => setRows((previous) => previous.map((row) => (row.uid === uid ? Object.assign({}, row, patch) : row)))
      const removeRow = (uid) => setRows((previous) => previous.filter((row) => row.uid !== uid))
      const addRow = (type) => setRows((previous) => previous.concat([newQuestion(type)]))
      const changeType = (uid, type) => setRows((previous) => previous.map((row) => {
        if (row.uid !== uid) return row
        const next = Object.assign({}, row, { type })
        if (type === 'choice' && (!Array.isArray(next.options) || next.options.length === 0)) next.options = [{ key: '', desc: '' }, { key: '', desc: '' }]
        if (type === 'score' && (!Array.isArray(next.levels) || next.levels.length < 2)) next.levels = ['', '']
        return next
      }))
      const setOption = (uid, index, patch) => setRows((previous) => previous.map((row) => {
        if (row.uid !== uid) return row
        const options = (row.options || []).map((option, i) => (i === index ? Object.assign({}, option, patch) : option))
        return Object.assign({}, row, { options })
      }))
      const addOption = (uid) => setRows((previous) => previous.map((row) => (row.uid === uid ? Object.assign({}, row, { options: (row.options || []).concat([{ key: '', desc: '' }]) }) : row)))
      const removeOption = (uid, index) => setRows((previous) => previous.map((row) => (row.uid === uid ? Object.assign({}, row, { options: (row.options || []).filter((option, i) => i !== index) }) : row)))
      const setLevel = (uid, index, value) => setRows((previous) => previous.map((row) => {
        if (row.uid !== uid) return row
        const levels = (row.levels || []).map((level, i) => (i === index ? value : level))
        return Object.assign({}, row, { levels })
      }))
      const addLevel = (uid) => setRows((previous) => previous.map((row) => (row.uid === uid ? Object.assign({}, row, { levels: (row.levels || []).concat(['']) }) : row)))
      const removeLevel = (uid, index) => setRows((previous) => previous.map((row) => (row.uid === uid ? Object.assign({}, row, { levels: (row.levels || []).filter((level, i) => i !== index) }) : row)))

      const applyPreset = (presetId) => {
        const preset = PRESETS.find((entry) => entry.id === presetId)
        if (!preset) return
        setRows(presetRows(preset))
        if (preset.state) { setSource('custom'); setCustom(preset.state) }
      }

      const onAsk = React.useCallback(async () => {
        let questions
        try {
          questions = questionsFromForm(rows).questions
        } catch (error) {
          setRunError(error.message)
          return
        }
        const state = source === 'chat' ? chat.text : custom
        if (String(state || '').trim() === '') {
          setRunError(source === 'chat' ? 'the current chat has no transcript yet — switch to Custom or reload it' : 'state is empty')
          return
        }
        setRunning(true)
        setRunError(null)
        setResult(null)
        const startedAt = Date.now()
        try {
          const payload = await ask({ state, model: model.trim() || 'jev-latest', questions })
          setResult(Object.assign({}, payload, { clientElapsedMs: Date.now() - startedAt }))
        } catch (error) {
          setRunError(String((error && error.message) || error))
        } finally {
          setRunning(false)
        }
      }, [rows, source, chat.text, custom, model])

      const configured = cred ? cred.configured === true : false
      const stateText = source === 'chat' ? chat.text : custom
      const busy = running

      const editorFor = (row) => {
        if (row.type === 'noul') {
          return React.createElement('div', { className: 'dshJevRow' },
            React.createElement('input', { className: 'dshJevGrow', placeholder: 'if yes (optional)', value: row.yes || '', onChange: (event) => patchRow(row.uid, { yes: event.target.value }) }),
            React.createElement('input', { className: 'dshJevGrow', placeholder: 'if no (optional)', value: row.no || '', onChange: (event) => patchRow(row.uid, { no: event.target.value }) }),
          )
        }
        if (row.type === 'choice') {
          const options = Array.isArray(row.options) ? row.options : []
          return React.createElement('div', { className: 'dshJevRow', style: { flexDirection: 'column', alignItems: 'stretch' } },
            options.map((option, index) => React.createElement('div', { className: 'dshJevOpt', key: index },
              React.createElement('input', { placeholder: 'option', value: option.key || '', onChange: (event) => setOption(row.uid, index, { key: event.target.value }) }),
              React.createElement('input', { placeholder: 'description (optional)', value: option.desc || '', onChange: (event) => setOption(row.uid, index, { desc: event.target.value }) }),
              React.createElement('button', { type: 'button', className: 'dshJevBtn subtle', onClick: () => removeOption(row.uid, index) }, '✕'),
            )),
            React.createElement('button', { type: 'button', className: 'dshJevBtn subtle', onClick: () => addOption(row.uid) }, '+ option'),
          )
        }
        const levels = Array.isArray(row.levels) ? row.levels : []
        return React.createElement('div', { className: 'dshJevRow', style: { flexDirection: 'column', alignItems: 'stretch' } },
          levels.map((level, index) => React.createElement('div', { className: 'dshJevOpt', key: index },
            React.createElement('span', { className: 'dshJevProb' }, String(index)),
            React.createElement('input', { placeholder: 'level description', value: level || '', onChange: (event) => setLevel(row.uid, index, event.target.value) }),
            React.createElement('button', { type: 'button', className: 'dshJevBtn subtle', onClick: () => removeLevel(row.uid, index) }, '✕'),
          )),
          React.createElement('button', { type: 'button', className: 'dshJevBtn subtle', onClick: () => addLevel(row.uid) }, '+ level'),
        )
      }

      const answers = result && result.answers && typeof result.answers === 'object' ? result.answers : null
      const answerIds = answers ? Object.keys(answers) : []

      const body = React.createElement('div', { className: 'dshJevBody' },
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'TypeSafe key & model'),
          React.createElement(KeyMenu, { credential: cred, keyDraft, setKeyDraft, savingKey, onSaveKey, onRemoveKey }),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('span', { className: 'dshJevHint' }, 'Model'),
            React.createElement('input', { className: 'dshJevGrow', list: 'dshJevModels', value: model, onChange: (event) => setModel(event.target.value), spellCheck: false }),
            React.createElement('datalist', { id: 'dshJevModels' }, models.map((name) => React.createElement('option', { key: name, value: name }))),
          ),
          modelsError
            ? React.createElement('div', { className: 'dshJevHint' }, 'Catalog unavailable: ' + modelsError + ' (known aliases: ' + MODEL_FALLBACK.join(', ') + ')')
            : React.createElement('div', { className: 'dshJevHint' }, 'Catalog: ' + models.length + ' name(s) known'),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'State'),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('label', { className: 'dshJevHint' },
              React.createElement('input', { type: 'radio', checked: source === 'chat', onChange: () => setSource('chat') }), ' current chat'),
            React.createElement('label', { className: 'dshJevHint' },
              React.createElement('input', { type: 'radio', checked: source === 'custom', onChange: () => setSource('custom') }), ' custom'),
            React.createElement('select', { value: '', onChange: (event) => { applyPreset(event.target.value); event.target.value = '' } },
              React.createElement('option', { value: '' }, 'Apply a preset…'),
              PRESETS.map((preset) => React.createElement('option', { key: preset.id, value: preset.id }, preset.label)),
            ),
            React.createElement('button', { type: 'button', className: 'dshJevBtn subtle', onClick: loadTranscript, disabled: source !== 'chat' || chat.loading }, chat.loading ? 'Loading…' : 'Reload chat'),
            React.createElement('span', { className: 'dshJevHint' }, stateText.length + ' chars · ~' + formatTokens(estimateTokens(stateText)) + ' tok'),
          ),
          chat.error && source === 'chat'
            ? React.createElement('div', { className: 'dshJevHint' }, 'Chat transcript: ' + chat.error)
            : null,
          React.createElement('textarea', {
            value: stateText,
            placeholder: 'Paste the state to evaluate, or use the current chat transcript above.',
            spellCheck: false,
            onChange: (event) => {
              if (source === 'chat') { setSource('custom'); setCustom(event.target.value) }
              else setCustom(event.target.value)
            },
          }),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Questions · ' + rows.length),
          rows.map((row) => React.createElement('div', { className: 'dshJevQ', key: row.uid },
            React.createElement('div', { className: 'dshJevQHead' },
              React.createElement('input', { className: 'dshJevGrow', placeholder: 'id, e.g. is_urgent', value: row.id || '', onChange: (event) => patchRow(row.uid, { id: event.target.value }), spellCheck: false }),
              React.createElement('select', { value: row.type, onChange: (event) => changeType(row.uid, event.target.value) },
                React.createElement('option', { value: 'noul' }, 'noul — yes/no'),
                React.createElement('option', { value: 'choice' }, 'choice'),
                React.createElement('option', { value: 'score' }, 'score'),
              ),
              React.createElement('button', { type: 'button', className: 'dshJevBtn subtle', title: 'Remove question', onClick: () => removeRow(row.uid) }, '✕'),
            ),
            React.createElement('input', { placeholder: 'Instructions — one specific judgment', value: row.instructions || '', onChange: (event) => patchRow(row.uid, { instructions: event.target.value }) }),
            editorFor(row),
          )),
          React.createElement('div', { className: 'dshJevRow' },
            React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: () => addRow('noul') }, '+ noul'),
            React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: () => addRow('choice') }, '+ choice'),
            React.createElement('button', { type: 'button', className: 'dshJevBtn ghost', onClick: () => addRow('score') }, '+ score'),
            React.createElement('span', { className: 'dshJevHint' }, 'All questions are evaluated in parallel against the same state.'),
          ),
        ),
        React.createElement('div', { className: 'dshJevRow' },
          React.createElement('button', { type: 'button', className: 'dshJevBtn', disabled: busy || !configured, title: configured ? 'Ask Jev' : 'Store a TypeSafe API key first', onClick: onAsk }, busy ? 'Asking…' : 'Ask Jev'),
          React.createElement('span', { className: 'dshJevHint' }, configured ? 'Runs against ' + (model.trim() || 'jev-latest') : 'Store a TypeSafe API key to run'),
        ),
        runError ? React.createElement('div', { className: 'dshJevErr' }, runError) : null,
        answers
          ? React.createElement('div', { className: 'dshJevSection' },
              React.createElement('h4', null, 'Answers'),
              React.createElement('div', { className: 'dshJevHint' },
                'model ' + result.model +
                ' · in ' + formatTokens(result.usage ? result.usage.input_tokens : 0) + ' tok' +
                ' · out ' + formatTokens(result.usage ? result.usage.output_tokens : 0) + ' tok' +
                ' · ' + formatCost(result.costUsd) +
                ' · ' + (Number.isFinite(result.elapsedMs) ? result.elapsedMs : result.clientElapsedMs) + ' ms'),
              answerIds.map((id) => React.createElement(AnswerView, { key: id, id, answer: answers[id] })),
            )
          : null,
      )

      const modal = open
        ? renderModalWindow({ close: () => setOpen(false), title: 'Jev — TypeSafe System One console', body })
        : null

      const pillLabel = cred === null
        ? 'Jev …'
        : !configured
          ? 'Set TypeSafe key'
          : 'Jev · ' + rows.length + ' q'

      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'dshJevDock' },
          React.createElement('button', {
            type: 'button',
            className: 'dshJevCard',
            'data-state': cred === null ? 'loading' : configured ? 'ready' : 'error',
            'data-composer-jev': true,
            'aria-busy': busy,
            title: 'TypeSafe Jev — ask typed Choice/Score/Noul questions about this chat or a custom state',
            'aria-label': pillLabel + '. Click to open the Jev console.',
            onClick: () => setOpen((value) => !value),
          },
            React.createElement(SparkIcon),
            React.createElement('span', { className: 'dshJevName' }, pillLabel),
            React.createElement('span', { className: 'dshJevSep', 'aria-hidden': true }, open ? '▾' : '▸'),
          ),
        ),
        modal,
      )
    }

    /** The shell Modal when available, else a fixed overlay dialog (portaled if possible). */
    function renderModalWindow(opts) {
      const close = opts && typeof opts.close === 'function' ? opts.close : () => {}
      if (Primitives !== null) {
        return React.createElement(Primitives.Modal, {
          open: true,
          onClose: close,
          title: opts.title || 'Jev',
          closeLabel: 'Close',
          className: 'dshJevModal',
        }, opts.body)
      }
      const dialog = React.createElement('div', {
        className: 'dshJevOverlay',
        role: 'presentation',
        onMouseDown: (event) => { if (event.target === event.currentTarget) close() },
      },
        React.createElement('div', { className: 'dshJevDialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Jev' },
          React.createElement('div', { className: 'dshJevHead' },
            React.createElement('span', null, opts.title || 'Jev'),
            React.createElement('button', { type: 'button', className: 'dshJevClose', 'aria-label': 'Close', onClick: close }, '\u00D7'),
          ),
          opts.body,
        ),
      )
      return ReactDOM !== null ? ReactDOM.createPortal(dialog, document.body) : dialog
    }

    /**
     * The "Jev (TypeSafe)" Settings -> Plugins tab: the canonical home for the
     * API key, plus catalog status. Same host routes as the dock console.
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
          setNotice('TypeSafe API key stored.')
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
          setModels(payload && Array.isArray(payload.models) ? payload.models : [])
          setModelsError(null)
          setNotice('TypeSafe reachable — ' + models.length + ' model name(s) returned.')
        } catch (failure) {
          setError(String((failure && failure.message) || failure))
        } finally {
          setTesting(false)
        }
      }, [loadCatalog])

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
                  : 'No catalog reading yet.'),
          ),
        ),
        React.createElement('div', { className: 'dshJevSection' },
          React.createElement('h4', null, 'Console'),
          React.createElement('div', { className: 'dshJevHint' },
            'The Jev pill under the chat input opens the question console: build Choice, Score, and Noul questions, run them against the current chat or a custom state, and read the structured answers. The default model is jev-latest.'),
        ),
        error ? React.createElement('div', { className: 'dshJevErr' }, error) : null,
        notice ? React.createElement('div', { className: 'dshJevOk' }, notice) : null,
      )
    }

    /** Services required before the contributions can register. */
    const inject = ['slots']

    /**
     * Client plugin body: contribute the composer-dock console and the Settings
     * plugins tab.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ensureStyles()
      ctx.effect(
        () => {
          const disposeDock = ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'jev', order: 30 },
              JevDock,
            ))
          const disposeTab = ctx.slots.inject('settings.plugins.tab', () =>
            ctx.slots.register(
              { name: 'settings.plugins.tab', id: 'jev', order: 40, label: 'Jev (TypeSafe)' },
              JevSettingsTab,
            ))
          return () => {
            disposeDock()
            disposeTab()
          }
        },
        'dsh-plugin-jev: composer dock console + Settings plugins tab',
      )
    }

    return {
      apply,
      inject,
      JevDock,
      JevSettingsTab,
      KeyMenu,
      AnswerView,
      questionsFromForm,
      defaultRows,
      newQuestion,
      presetRows,
      estimateTokens,
      formatCost,
      formatPercent,
      formatTokens,
      PRESETS,
      MODEL_FALLBACK,
    }
  },
})
