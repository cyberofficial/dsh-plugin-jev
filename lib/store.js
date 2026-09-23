/**
 * Jev preference + overall-usage store: one small JSON document under the DSH
 * home so the chosen model and the aggregate usage totals survive harness
 * restarts.
 *
 * The per-session breakdown is NOT stored here — for model-driven calls it
 * rides the session log and is projected to the browser by lib/usage.js. This
 * file is the process-independent aggregate plus the model preference. It never
 * holds the API key.
 *
 * Totals also carry a `bySource` split. A call made by the agent's `jev_ask`
 * tool and a call made by a sibling plugin through the host-side service
 * (lib/service.js) both land in `totals`, but only the tool path can reach the
 * per-chat chip, because the chip reads session-log `tool/result` meta and a
 * plugin cannot append a session event of its own. The split keeps that gap
 * visible in Settings instead of hiding it inside one number.
 *
 * @module dsh-plugin-jev/store
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** State file name below the resolved DSH home. */
export const STATE_FILE_NAME = 'dsh-plugin-jev.json'

/** Most recent sessions kept in the aggregate before pruning the oldest. */
export const MAX_SESSIONS = 200

/** Expand a leading `~`, `~/`, or `~\\` to the user's home directory. */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * Resolve the harness home: `$DSH_HOME`, else `~/.dsh`, with the harness's own
 * normalization (expanded and absolute).
 * @param {NodeJS.ProcessEnv} [env] - environment to consult.
 * @returns {string} absolute home directory.
 */
export function resolveHome(env = process.env) {
  const override = env.DSH_HOME
  const selected = typeof override === 'string' && override.trim() !== ''
    ? override
    : join(homedir(), '.dsh')
  return resolve(expandHome(selected))
}

/** Non-negative finite number, or 0. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Non-negative integer, or 0. */
function int(value) {
  return Math.max(0, Math.trunc(num(value)))
}

/** A fresh zeroed usage counter. */
export function emptyUsage() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

/**
 * The origins a recorded call can have. `tool` is a `jev_ask` dispatch by the
 * model (visible in the per-chat chip); `host` is a sibling plugin calling the
 * host-side service; `guard` is the tool guard scoring a shell command before
 * dispatch. The non-tool origins are aggregate-only.
 */
export const USAGE_SOURCES = ['tool', 'host', 'guard']

/** Coerce an arbitrary marker to a known source, defaulting to the tool path. */
function normalizeSource(value) {
  return USAGE_SOURCES.includes(value) ? value : 'tool'
}

/** Normalize one usage counter. */
function normalizeUsage(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  return {
    calls: int(source.calls),
    inputTokens: int(source.inputTokens),
    outputTokens: int(source.outputTokens),
    costUsd: num(source.costUsd),
  }
}

/** Normalize a source-keyed map of usage counters, dropping unknown keys. */
function normalizeSourceMap(value) {
  const out = {}
  const source = value !== null && typeof value === 'object' ? value : {}
  for (const key of USAGE_SOURCES) {
    out[key] = normalizeUsage(source[key])
  }
  return out
}

/**
 * Normalize an arbitrary parsed JSON value into the store's shape. Anything
 * unreadable degrades to the default rather than failing boot.
 * @param {unknown} value - parsed JSON.
 * @returns the normalized store state.
 */
export function normalizeState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { model: null, guard: null, totals: emptyUsage(), byModel: {}, bySource: normalizeSourceMap(null), sessions: {}, lastCall: null, updatedAt: null }
  }
  const byModel = {}
  const byModelSource = value.byModel !== null && typeof value.byModel === 'object' ? value.byModel : {}
  for (const [key, usage] of Object.entries(byModelSource)) {
    const name = String(key).trim()
    if (name === '') continue
    byModel[name] = normalizeUsage(usage)
  }
  const sessions = {}
  const sessionsSource = value.sessions !== null && typeof value.sessions === 'object' ? value.sessions : {}
  for (const [key, entry] of Object.entries(sessionsSource)) {
    const id = String(key).trim()
    if (id === '' || entry === null || typeof entry !== 'object') continue
    sessions[id] = Object.assign(normalizeUsage(entry), {
      lastAt: typeof entry.lastAt === 'string' ? entry.lastAt : null,
    })
  }
  let lastCall = null
  if (value.lastCall !== null && typeof value.lastCall === 'object') {
    lastCall = Object.assign(normalizeUsage(value.lastCall), {
      model: typeof value.lastCall.model === 'string' ? value.lastCall.model : null,
      sessionId: typeof value.lastCall.sessionId === 'string' ? value.lastCall.sessionId : null,
      at: typeof value.lastCall.at === 'string' ? value.lastCall.at : null,
      source: normalizeSource(value.lastCall.source),
    })
  }
  return {
    model: typeof value.model === 'string' && value.model.trim() !== '' ? value.model.trim() : null,
    // The guard config is persisted verbatim and normalized by lib/guard.js, so
    // this file never has to know the guard's schema. Null means "never
    // configured", which lets the guard's own defaults apply.
    guard: value.guard !== null && typeof value.guard === 'object' && !Array.isArray(value.guard) ? value.guard : null,
    totals: normalizeUsage(value.totals),
    byModel,
    // Absent in files written before the source split; those calls were all
    // model-driven, so the default 'tool' bucket is the honest reconstruction.
    bySource: normalizeSourceMap(value.bySource),
    sessions,
    lastCall,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  }
}

/**
 * A store bound to a path: load-on-start, atomic write-on-change. Reads are
 * tolerant; every write lands through a temp file and rename so a crash
 * mid-write cannot tear the JSON.
 */
export class JevStore {
  /**
   * @param {string} file - absolute state file path.
   * @param {() => string} [now] - ISO timestamp source (tests inject).
   */
  constructor(file, now = () => new Date().toISOString()) {
    this.file = file
    this.now = now
    this.state = normalizeState(null)
    this.reload()
  }

  /**
   * Build a store at the default location inside the resolved DSH home.
   * @param {NodeJS.ProcessEnv} [env]
   * @returns {JevStore}
   */
  static atHome(env = process.env) {
    return new JevStore(join(resolveHome(env), STATE_FILE_NAME))
  }

  /** Re-read the file; a missing/unreadable/corrupt file resets to the default. */
  reload() {
    try {
      this.state = normalizeState(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      this.state = normalizeState(null)
    }
  }

  /** @returns {string} the stored model alias, or the supplied fallback. */
  modelOr(fallback) {
    return this.state.model !== null ? this.state.model : fallback
  }

  /**
   * Persist the chosen model when it changed.
   * @param {string} model
   * @returns {boolean} whether the persisted state changed.
   */
  setModel(model) {
    const next = typeof model === 'string' ? model.trim() : ''
    if (next === '' || next === this.state.model) return false
    this.state = Object.assign({}, this.state, { model: next, updatedAt: this.now() })
    this.save()
    return true
  }

  /**
   * Persist the guard config. Stored verbatim; lib/guard.js owns its schema and
   * normalization, so a malformed file degrades there rather than failing boot.
   * @param {object} value - the guard config to persist.
   * @returns the persisted value.
   */
  setGuard(value) {
    const next = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
    this.state = Object.assign({}, this.state, { guard: next, updatedAt: this.now() })
    this.save()
    return next
  }

  /**
   * Fold one completed call into the aggregate and persist.
   * @param {{ sessionId?: string|null, model?: string|null, inputTokens: number, outputTokens: number, costUsd: number, source?: 'tool'|'host'|'guard' }} call
   *   `source` defaults to `'tool'`, the agent's `jev_ask` dispatch; pass
   *   `'host'` for the host service and `'guard'` for the command guard.
   * @returns the updated aggregate snapshot.
   */
  record(call) {
    const at = this.now()
    const usage = { calls: 1, inputTokens: int(call.inputTokens), outputTokens: int(call.outputTokens), costUsd: num(call.costUsd) }
    const model = typeof call.model === 'string' && call.model.trim() !== '' ? call.model.trim() : null
    const sessionId = typeof call.sessionId === 'string' && call.sessionId !== '' ? call.sessionId : null
    const source = normalizeSource(call.source)
    const totals = normalizeUsage(this.state.totals)
    totals.calls += 1
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    totals.costUsd += usage.costUsd
    const bySource = normalizeSourceMap(this.state.bySource)
    const sourceEntry = bySource[source]
    sourceEntry.calls += 1
    sourceEntry.inputTokens += usage.inputTokens
    sourceEntry.outputTokens += usage.outputTokens
    sourceEntry.costUsd += usage.costUsd
    const byModel = Object.assign({}, this.state.byModel)
    if (model !== null) {
      const entry = normalizeUsage(byModel[model])
      entry.calls += 1
      entry.inputTokens += usage.inputTokens
      entry.outputTokens += usage.outputTokens
      entry.costUsd += usage.costUsd
      byModel[model] = entry
    }
    const sessions = Object.assign({}, this.state.sessions)
    if (sessionId !== null) {
      const entry = Object.assign(normalizeUsage(sessions[sessionId]), { lastAt: at })
      entry.calls += 1
      entry.inputTokens += usage.inputTokens
      entry.outputTokens += usage.outputTokens
      entry.costUsd += usage.costUsd
      sessions[sessionId] = entry
      this.pruneSessions(sessions)
    }
    this.state = {
      model: this.state.model,
      // Carried through every write: `record` rebuilds the whole state object,
      // so omitting this would silently erase the guard config on the next call.
      guard: this.state.guard,
      totals,
      byModel,
      bySource,
      sessions,
      lastCall: { calls: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd, model, sessionId, at, source },
      updatedAt: at,
    }
    this.save()
    return this.snapshot()
  }

  /** Drop the oldest sessions beyond the cap, in place. */
  pruneSessions(sessions) {
    const ids = Object.keys(sessions)
    if (ids.length <= MAX_SESSIONS) return
    ids.sort((a, b) => String(sessions[a].lastAt || '').localeCompare(String(sessions[b].lastAt || '')))
    for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) delete sessions[id]
  }

  /** @returns a plain snapshot for the HTTP surface. */
  snapshot() {
    return {
      model: this.state.model,
      // The stored guard config, or null when never configured (the guard's own
      // defaults then apply). Deep-copied so a caller cannot mutate stored state.
      guard: this.state.guard === null ? null : JSON.parse(JSON.stringify(this.state.guard)),
      totals: Object.assign({}, this.state.totals),
      byModel: JSON.parse(JSON.stringify(this.state.byModel)),
      bySource: JSON.parse(JSON.stringify(this.state.bySource)),
      lastCall: this.state.lastCall === null ? null : Object.assign({}, this.state.lastCall),
      sessionsTracked: Object.keys(this.state.sessions).length,
      updatedAt: this.state.updatedAt,
    }
  }

  /** Persist atomically (write temp, rename over). */
  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.' + process.pid + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
  }
}
