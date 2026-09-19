/**
 * Host half of the TypeSafe Jev plugin.
 *
 * TypeSafe Jev is a "System One" decision model: you send a state plus typed
 * questions and get back structured answers with calibrated probabilities. This
 * module owns the server side of the plugin:
 *
 *   - the agent-facing jev_ask tool (see ./tool.js) and the prompt guidance
 *     that tells the model to call it for calibrated judgment;
 *   - POST /systemone calls to https://api.typesafe.ai/v1 with the stored API
 *     key, validating the request shape before it leaves the host and
 *     normalizing the answer envelope on the way back;
 *   - the model catalog (GET /v1/models), cached for a few minutes;
 *   - the TypeSafe credential status and its set/remove route, shared by the
 *     Settings tab (the literal never leaves here);
 *   - a session-to-text transcript fold used to build a state from the current
 *     chat.
 *
 * @module dsh-plugin-jev
 */

import { registerJevTool } from './tool.js'

export const name = 'dsh-plugin-jev'

/**
 * Services this plugin needs before it can apply.
 *
 * `tools` and `systemPrompt` are what make Jev agent-facing rather than a
 * human console: the registered tool is what the model calls, and the prompt
 * section is what tells it to. Both are supplied by the Web profile; loading
 * this plugin anywhere without them fails loudly at mount, by design.
 */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** TypeSafe API base URL. */
const BASE_URL = 'https://api.typesafe.ai/v1'

/** Route namespace owned by this plugin. */
const ROUTE_BASE = '/plugins/dsh-plugin-jev/api'

/** Evaluate a state against typed questions. */
const ASK_ROUTE_PATH = ROUTE_BASE + '/ask'

/** List the models/aliases the account can send. */
const MODELS_ROUTE_PATH = ROUTE_BASE + '/models'

/** Report whether the TypeSafe credential is configured (never its value). */
const STATUS_ROUTE_PATH = ROUTE_BASE + '/status'

/** Write/remove the TypeSafe credential (POST/DELETE). */
const KEY_ROUTE_PATH = ROUTE_BASE + '/key'

/** Fold a session's log into text suitable as a Jev state. */
const TRANSCRIPT_ROUTE_PATH = ROUTE_BASE + '/transcript'

/**
 * Credential reference the host reads first — a stored key by this name is what
 * the Settings tab and the pill's set-key menu write. The name is a bare POSIX
 * identifier, which the credential seam accepts as a reference.
 */
export const TYPESAFE_CREDENTIAL_REF = 'typesafe'

/** Legacy reference tried only as a fallback, for a key stored before "typesafe". */
export const LEGACY_CREDENTIAL_REF = 'TYPESAFE_API_KEY'

/** The ordered credential references this host consults, newest first. */
export const CREDENTIAL_REFS = [TYPESAFE_CREDENTIAL_REF, LEGACY_CREDENTIAL_REF]

/**
 * Ordered (reference, environment) pairs for key resolution: each reference is
 * read through the credential service first, then the named launch-environment
 * variable. The first pair to supply a value wins.
 */
export const KEY_CANDIDATES = [
  { ref: TYPESAFE_CREDENTIAL_REF, env: 'TYPESAFE_API_KEY' },
  { ref: LEGACY_CREDENTIAL_REF, env: 'TYPESAFE_API_KEY' },
]

/** Default model alias: the most recent stable Jev release. */
export const DEFAULT_MODEL = 'jev-latest'

/**
 * Estimated input price per token, from the published Jev 1.13 rate of
 * $42 per billion tokens ($0.042 per million). Output tokens are free.
 */
export const DEFAULT_COST_PER_TOKEN = 4.2e-8

/** Upstream request timeout. */
const DEFAULT_TIMEOUT_MS = 30_000

/** How long one model-catalog reading stays fresh. */
const DEFAULT_CACHE_MS = 300_000

/** Bound on questions in one call. */
const MAX_QUESTIONS = 64

/** Bound on the serialized request, well under the 64k-token context budget. */
const MAX_REQUEST_CHARS = 400_000

/** Bound on a derived transcript state. */
const MAX_TRANSCRIPT_CHARS = 40_000

/** Bound on transcript messages kept (the most recent ones). */
const MAX_TRANSCRIPT_MESSAGES = 80

/** Bound on one transcript line. */
const MAX_MESSAGE_CHARS = 1200

/** Cap on how long a 429 honoring retry-after will wait. */
const DEFAULT_RETRY_CAP_MS = 30_000

/** Numeric helper: keep null when absent, else a finite number. */
function num(value) {
  const parsed = Number(value)
  return value != null && Number.isFinite(parsed) ? parsed : null
}

/** Keep the head and tail of an over-long string, marking what was dropped. */
function boundText(text, maxChars) {
  const str = String(text == null ? '' : text)
  if (str.length <= maxChars) return str
  const head = Math.max(0, Math.floor(maxChars * 0.4))
  const tail = Math.max(0, maxChars - head)
  const omitted = str.length - head - tail
  return str.slice(0, head) + (omitted > 0 ? ' … [' + omitted + ' chars omitted] … ' : '') + str.slice(str.length - tail)
}

/** One plain-string value of a documented string|object|array field. */
function normalizeInstruction(value, id) {
  if (typeof value === 'string') {
    if (value.trim() === '') throw new Error('question "' + id + '" needs non-empty instructions')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every((entry) => typeof entry === 'string')) {
      throw new Error('question "' + id + '" instructions must be a string or an array of strings')
    }
    return value.slice()
  }
  if (value !== null && typeof value === 'object') return JSON.parse(JSON.stringify(value))
  throw new Error('question "' + id + '" needs instructions')
}

/**
 * Validate and normalize one browser-supplied questions map against the
 * documented TypeSafe request shape. Unknown fields are dropped so a client
 * cannot smuggle anything the API would ignore anyway.
 *
 * @param input - the questions value from the request body.
 * @returns a fresh map of normalized Question objects.
 * @throws when a question is malformed.
 */
export function parseQuestions(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('questions must be a JSON object keyed by question id')
  }
  const entries = Object.entries(input)
  if (entries.length === 0) throw new Error('at least one question is required')
  if (entries.length > MAX_QUESTIONS) throw new Error('too many questions (max ' + MAX_QUESTIONS + ' per call)')
  const out = {}
  for (const [rawKey, question] of entries) {
    const id = String(rawKey).trim()
    if (id === '') throw new Error('question ids must be non-empty')
    if (Object.prototype.hasOwnProperty.call(out, id)) throw new Error('duplicate question id: ' + id)
    if (question === null || typeof question !== 'object' || Array.isArray(question)) {
      throw new Error('question "' + id + '" must be an object')
    }
    const type = question.type
    if (type !== 'choice' && type !== 'score' && type !== 'noul') {
      throw new Error('question "' + id + '" has unknown type; expected choice, score, or noul')
    }
    const entry = { type, instructions: normalizeInstruction(question.instructions, id) }
    if (type === 'noul') {
      const criteria = question.criteria
      if (criteria !== undefined && criteria !== null) {
        if (typeof criteria !== 'object' || Array.isArray(criteria)) {
          throw new Error('noul "' + id + '" criteria must be an object with optional true/false descriptions')
        }
        const sides = {}
        for (const side of ['true', 'false']) {
          const description = criteria[side]
          if (description === undefined || description === null) continue
          if (typeof description !== 'string') throw new Error('noul "' + id + '" criteria.' + side + ' must be a string')
          sides[side] = description
        }
        if (Object.keys(sides).length > 0) entry.criteria = sides
      }
    } else if (type === 'choice') {
      const criteria = question.criteria
      if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)) {
        throw new Error('choice "' + id + '" criteria must be an object mapping each option to a description')
      }
      const options = {}
      for (const [rawOption, description] of Object.entries(criteria)) {
        const option = String(rawOption).trim()
        if (option === '') throw new Error('choice "' + id + '" has an empty option name')
        if (description === null || description === undefined) options[option] = null
        else if (typeof description === 'string') options[option] = description
        else throw new Error('choice "' + id + '" option "' + option + '" must be a string or null')
      }
      if (Object.keys(options).length === 0) throw new Error('choice "' + id + '" needs at least one option')
      entry.criteria = options
    } else {
      const criteria = question.criteria
      if (!Array.isArray(criteria) || criteria.length < 2) {
        throw new Error('score "' + id + '" criteria must be an ordered array of at least two levels')
      }
      entry.criteria = criteria.map((level) => {
        if (typeof level !== 'string' || level.trim() === '') {
          throw new Error('score "' + id + '" levels must be non-empty strings')
        }
        return level
      })
    }
    out[id] = entry
  }
  return out
}

/**
 * Validate one state value: a non-empty string, object, or array.
 * @param state - the state value from the request body.
 * @returns the state, cloned when structured.
 * @throws when the state is empty or of an unsupported type.
 */
export function normalizeState(state) {
  if (typeof state === 'string') {
    if (state.trim() === '') throw new Error('state must be non-empty')
    return state
  }
  if (Array.isArray(state)) {
    if (state.length === 0) throw new Error('state must be non-empty')
    return JSON.parse(JSON.stringify(state))
  }
  if (state !== null && typeof state === 'object') {
    if (Object.keys(state).length === 0) throw new Error('state must be non-empty')
    return JSON.parse(JSON.stringify(state))
  }
  throw new Error('state must be a string, an object, or an array')
}

/**
 * Validate a whole ask request and build the upstream body.
 * @param input - parsed request body (state, questions, model).
 * @returns the request ready for POST /systemone.
 * @throws when any part is missing or malformed, or the body is too large.
 */
export function buildRequest(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const state = normalizeState(source.state)
  const questions = parseQuestions(source.questions)
  const model = typeof source.model === 'string' && source.model.trim() !== '' ? source.model.trim() : DEFAULT_MODEL
  const request = { state, model, questions }
  const size = JSON.stringify(request).length
  if (size > MAX_REQUEST_CHARS) {
    throw new Error('request is too large (' + size + ' chars; max ' + MAX_REQUEST_CHARS + ')')
  }
  return request
}

/**
 * Normalize the documented answer envelope.
 * @param payload - parsed /systemone JSON.
 * @returns the model, answers, and usage.
 * @throws when the payload is not an answer envelope.
 */
export function normalizeAnswers(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('TypeSafe: response is not a JSON object')
  }
  const answers = payload.answers
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('TypeSafe: response has no answers object')
  }
  const source = payload.usage !== null && typeof payload.usage === 'object' ? payload.usage : {}
  return {
    model: typeof payload.model === 'string' ? payload.model : DEFAULT_MODEL,
    answers,
    usage: {
      input_tokens: num(source.input_tokens) || 0,
      output_tokens: num(source.output_tokens) || 0,
    },
  }
}

/**
 * Normalize GET /v1/models.
 * @param payload - parsed /models JSON.
 * @returns the models list with name/description/releaseDate entries.
 */
export function normalizeModels(payload) {
  const list = payload !== null && typeof payload === 'object' && Array.isArray(payload.models) ? payload.models : []
  const models = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    models.push({
      name: typeof entry.name === 'string' ? entry.name : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      releaseDate: typeof entry.release_date === 'string' ? entry.release_date : null,
    })
  }
  return { models }
}

/**
 * Estimate the input cost of one call. Output tokens are free.
 * @param usage - a normalized usage object.
 * @param perToken - price per input token.
 * @returns the estimated USD cost.
 */
export function costOfUsage(usage, perToken = DEFAULT_COST_PER_TOKEN) {
  const input = usage && Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0
  const rate = Number.isFinite(perToken) ? perToken : DEFAULT_COST_PER_TOKEN
  return input * rate
}

/** Concatenate the visible text of a message's content blocks. */
function blocksText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string' && block.text !== '') parts.push(block.text)
        break
      case 'image':
        parts.push('[image]')
        break
      case 'file':
        parts.push('[file]')
        break
      default:
        // reasoning, tool-call, tool-result and unknown blocks carry no state text here
        break
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Fold a session's events into a bounded, model-readable transcript suitable as
 * a TypeSafe state. Keeps the most recent messages, bounds each line, then
 * bounds the whole text by preserving its head and tail.
 *
 * @param events - the session's events in sequence order.
 * @param options - maxMessages, perMessageMaxChars, maxChars.
 * @returns the text, kept message count, char count, and omitted count.
 */
export function foldTranscript(events, options = {}) {
  const maxMessages = Number.isFinite(options.maxMessages) ? Number(options.maxMessages) : MAX_TRANSCRIPT_MESSAGES
  const perMessageMaxChars = Number.isFinite(options.perMessageMaxChars) ? Number(options.perMessageMaxChars) : MAX_MESSAGE_CHARS
  const maxChars = Number.isFinite(options.maxChars) ? Number(options.maxChars) : MAX_TRANSCRIPT_CHARS
  const lines = []
  for (const event of Array.isArray(events) ? events : []) {
    if (event === null || typeof event !== 'object') continue
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
    let line = null
    if (event.type === 'user/message') {
      const pluginSourced = data.source !== null && typeof data.source === 'object' && data.source.kind === 'plugin'
      line = (pluginSourced ? 'CONTEXT' : 'USER') + ': ' + blocksText(data.content)
    } else if (event.type === 'assistant/message') {
      line = 'ASSISTANT: ' + blocksText(data.message !== null && typeof data.message === 'object' ? data.message.content : undefined)
    } else if (event.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : '?'
      line = 'TOOL CALL ' + name + ' ' + String(data.arguments == null ? '' : data.arguments).slice(0, 300)
    } else if (event.type === 'tool/result') {
      const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
      const single = Array.isArray(message.content) ? message.content[0] : undefined
      const inner = single !== null && typeof single === 'object' ? single.content : undefined
      line = (single !== null && typeof single === 'object' && single.isError === true ? 'TOOL ERROR: ' : 'TOOL RESULT: ') + blocksText(inner)
    }
    if (line === null) continue
    const bounded = boundText(line.replace(/\s+/g, ' ').trim(), perMessageMaxChars)
    if (bounded === '') continue
    lines.push(bounded)
  }
  const kept = lines.slice(-maxMessages)
  const omitted = lines.length - kept.length
  const text = boundText(kept.join('\n\n'), maxChars)
  return { text, messages: kept.length, chars: text.length, omitted }
}

/**
 * Resolve the TypeSafe API key. Each candidate reference is read through the
 * credential service first (that is what Settings and the pill's set-key menu
 * write), then the launch environment as a fallback. The first pair to supply a
 * value wins; the source and reference are returned so status can say where a
 * key came from without ever exposing it.
 *
 * @param ctx - host plugin context.
 * @returns the ref, source, and value, or null when nothing supplies a key.
 */
export async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials')
  const launch = ctx.get('launchEnvironment')
  for (const candidate of KEY_CANDIDATES) {
    if (credentials !== undefined) {
      const hit = await credentials.resolve(candidate.ref)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) {
        return { ref: candidate.ref, source: hit.source, value: hit.value }
      }
    }
    const ambient = launch === undefined ? undefined : launch.get(candidate.env)
    if (ambient !== undefined && ambient.value !== '' && ambient.value != null) {
      return { ref: candidate.ref, source: 'launch-environment', value: ambient.value }
    }
  }
  return null
}

/**
 * Presence and writability of the TypeSafe credential, for the menus. Only the
 * primary "typesafe" record is writable here; a key supplied by the legacy ref
 * or the environment is reported configured but read-only.
 * @param ctx - host plugin context.
 * @returns configured, ref, source, and writable.
 */
export async function describeCredential(ctx) {
  const credentials = ctx.get('credentials')
  const primary = credentials === undefined
    ? undefined
    : await credentials.describe(TYPESAFE_CREDENTIAL_REF).catch((error) => {
        ctx.logger?.warn?.('dsh-plugin-jev: describe typesafe: ' + error.message)
        return undefined
      })
  const resolved = await resolveApiKey(ctx)
  return {
    configured: resolved != null,
    ref: resolved ? resolved.ref : null,
    source: resolved ? resolved.source : null,
    writable: primary ? primary.writable === true : credentials === undefined ? false : true,
  }
}

/**
 * Parse an HTTP retry-after header into milliseconds.
 * @param value - seconds, an HTTP-date, or null.
 * @returns milliseconds, or null when absent/unparseable.
 */
export function parseRetryAfter(value) {
  if (value === null || value === undefined || value === '') return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 3_600_000)
  const when = Date.parse(String(value))
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 3_600_000))
  return null
}

/**
 * Call one TypeSafe endpoint and parse its JSON, retrying once on 429 when the
 * server names a retry-after within the cap.
 * @param options - apiKey, path, method, body, and transport overrides.
 * @returns the parsed JSON payload.
 * @throws with .status set for an HTTP failure.
 */
export async function callTypesafe(options = {}) {
  const {
    apiKey,
    baseURL = BASE_URL,
    path = '/systemone',
    method = 'POST',
    body,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryCapMs = DEFAULT_RETRY_CAP_MS,
  } = options
  if (typeof apiKey !== 'string' || apiKey.length === 0) throw new Error('TypeSafe: no API key')
  if (typeof fetchImpl !== 'function') throw new Error('TypeSafe: no fetch implementation available')
  const root = String(baseURL).replace(/\/+$/, '')
  const url = root + path
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + apiKey }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const send = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      const reason = controller.signal.aborted ? 'timed out after ' + timeoutMs + 'ms' : 'could not be reached'
      const wrapped = new Error('TypeSafe: ' + url + ' ' + reason)
      wrapped.cause = error
      throw wrapped
    } finally {
      clearTimeout(timer)
    }
  }

  let response = await send()
  if (response.status === 429) {
    const header = response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null
    const delay = parseRetryAfter(header)
    if (delay !== null && delay <= retryCapMs) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      response = await send()
    }
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const trimmed = String(detail).trim().slice(0, 300)
    const error = new Error('TypeSafe: HTTP ' + response.status + ' ' + response.statusText + (trimmed === '' ? '' : ' — ' + trimmed))
    error.status = response.status
    throw error
  }
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('TypeSafe: ' + path + ' is not valid JSON')
  }
}

/**
 * Perform one validated Jev call: resolve the credential, POST /systemone,
 * normalize the envelope, and price the usage. Shared by the HTTP /ask route
 * and the agent-facing tool transport.
 *
 * @param ctx - host plugin context.
 * @param request - a request built by buildRequest.
 * @param options - baseURL, fetchImpl, timeoutMs, costPerToken.
 * @returns the normalized result plus cost, elapsed time, and credential ref.
 * @throws with .code === 'no-key' when no credential is configured.
 */
export async function askJev(ctx, request, options = {}) {
  const key = await resolveApiKey(ctx)
  if (key === null) {
    const error = new Error('TypeSafe API key is not set — open Settings, then Plugins, then Jev (TypeSafe) to store it.')
    error.code = 'no-key'
    throw error
  }
  const started = Date.now()
  const payload = await callTypesafe({
    apiKey: key.value,
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : BASE_URL,
    path: '/systemone',
    method: 'POST',
    body: request,
    fetchImpl: options.fetchImpl,
    timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS,
  })
  const normalized = normalizeAnswers(payload)
  return {
    ...normalized,
    costUsd: costOfUsage(normalized.usage, Number.isFinite(options.costPerToken) ? options.costPerToken : DEFAULT_COST_PER_TOKEN),
    elapsedMs: Date.now() - started,
    credential: { configured: true, ref: key.ref, source: key.source },
  }
}

/** One JSON response. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/** Read a JSON request body with a size bound. */
async function readJsonBody(req, maxChars = 600_000) {
  let text = ''
  for await (const chunk of req) {
    text += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (text.length > maxChars) throw new Error('request body is too large')
  }
  if (text.trim() === '') throw new Error('a JSON body is required')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('request body is not valid JSON')
  }
}

/** Clamp an optional query integer into a range with a default. */
function clampInt(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

/**
 * Read the named session and fold it into a transcript state.
 * @param ctx - host plugin context.
 * @param sessionId - the session to read.
 * @param maxChars - overall transcript bound.
 * @returns the folded transcript, or an unavailable marker.
 */
export function readTranscript(ctx, sessionId, maxChars = MAX_TRANSCRIPT_CHARS) {
  if (typeof sessionId !== 'string' || sessionId === '') return { available: false, reason: 'no-session' }
  const sessions = ctx.get('sessions')
  if (sessions === undefined || typeof sessions.get !== 'function') return { available: false, reason: 'no-session-store' }
  let session
  try {
    session = sessions.get(sessionId)
  } catch (error) {
    ctx.logger?.warn?.('dsh-plugin-jev: session lookup: ' + error.message)
    return { available: false, reason: 'lookup-failed' }
  }
  if (session === undefined) return { available: false, reason: 'unknown-session' }
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
  const folded = foldTranscript(events, { maxChars })
  return { available: true, sessionId, ...folded }
}

/**
 * Mount the Jev routes.
 * @param ctx - host plugin context.
 * @param config - optional baseURL, cacheMs, costPerToken, timeoutMs, fetchImpl.
 */
export function apply(ctx, config = {}) {
  const baseURL = typeof config.baseURL === 'string' ? config.baseURL : BASE_URL
  const cacheMs = Number.isFinite(config.cacheMs) ? Number(config.cacheMs) : DEFAULT_CACHE_MS
  const costPerToken = Number.isFinite(config.costPerToken) ? Number(config.costPerToken) : DEFAULT_COST_PER_TOKEN
  const timeoutMs = Number.isFinite(config.timeoutMs) ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS
  const fetchImpl = typeof config.fetchImpl === 'function' ? config.fetchImpl : globalThis.fetch

  // The agent-facing surface: the guidance section that tells the model to use
  // Jev, and the tool it calls. Default on; set `toolEnabled: false` to mount
  // only the HTTP routes (for example when debugging the Settings tab).
  if (config.toolEnabled !== false) {
    registerJevTool(ctx, {
      async run(args) {
        const request = buildRequest({ state: args.state, questions: args.questions, model: args.model })
        const result = await askJev(ctx, request, { baseURL, fetchImpl, timeoutMs, costPerToken })
        return {
          model: result.model,
          answers: result.answers,
          usage: result.usage,
          costUsd: result.costUsd,
          elapsedMs: result.elapsedMs,
        }
      },
    }, { toolName: config.toolName })
  }

  /** Last successful model-catalog reading. */
  let modelsCache

  const readModels = async (force) => {
    const now = Date.now()
    if (!force && modelsCache !== undefined && now - modelsCache.at < cacheMs) {
      return { ...modelsCache.value, cached: true, fetchedAt: modelsCache.at }
    }
    const key = await resolveApiKey(ctx)
    if (key === null) {
      throw new Error('TypeSafe API key is not set — open Settings, then Plugins, then Jev (TypeSafe), or the Jev pill, to store it.')
    }
    const payload = await callTypesafe({ apiKey: key.value, baseURL, path: '/models', method: 'GET', fetchImpl, timeoutMs })
    const models = normalizeModels(payload)
    modelsCache = { at: Date.now(), value: models }
    return { ...models, cached: false, fetchedAt: modelsCache.at }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ASK_ROUTE_PATH,
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req)
        const request = buildRequest(body)
        return sendJson(res, 200, await askJev(ctx, request, { baseURL, fetchImpl, timeoutMs, costPerToken }))
      } catch (error) {
        ctx.logger?.warn?.('dsh-plugin-jev: ask: ' + error.message)
        const status = error && error.code === 'no-key' ? 401 : error && error.status === 429 ? 429 : 502
        return sendJson(res, status, { error: error.message })
      }
    },
  }), 'dsh-plugin-jev: ask route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODELS_ROUTE_PATH,
    handler: async (req, res) => {
      const url = new URL(req.url ?? MODELS_ROUTE_PATH, 'http://localhost')
      const force = url.searchParams.get('refresh') === '1'
      try {
        return sendJson(res, 200, await readModels(force))
      } catch (error) {
        ctx.logger?.warn?.('dsh-plugin-jev: models: ' + error.message)
        return sendJson(res, 502, { error: error.message })
      }
    },
  }), 'dsh-plugin-jev: models route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_ROUTE_PATH,
    handler: async (req, res) => {
      const info = await describeCredential(ctx)
      return sendJson(res, 200, { ...info, primaryRef: TYPESAFE_CREDENTIAL_REF, refs: CREDENTIAL_REFS })
    },
  }), 'dsh-plugin-jev: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: KEY_ROUTE_PATH,
    handler: async (req, res) => {
      const method = String(req.method || 'POST').toUpperCase()
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        return sendJson(res, 501, { error: 'no credential provider in this composition' })
      }
      try {
        if (method === 'DELETE') {
          await credentials.unset(TYPESAFE_CREDENTIAL_REF)
          return sendJson(res, 200, { ok: true, ref: TYPESAFE_CREDENTIAL_REF })
        }
        const body = await readJsonBody(req)
        const secret = body && typeof body.value === 'string' ? body.value.trim() : ''
        if (secret === '') return sendJson(res, 400, { error: 'a non-empty value is required' })
        await credentials.set(TYPESAFE_CREDENTIAL_REF, secret)
        return sendJson(res, 200, { ok: true, ref: TYPESAFE_CREDENTIAL_REF })
      } catch (error) {
        ctx.logger?.warn?.('dsh-plugin-jev: key route: ' + error.message)
        return sendJson(res, 409, { error: error.message })
      }
    },
  }), 'dsh-plugin-jev: key route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TRANSCRIPT_ROUTE_PATH,
    handler: async (req, res) => {
      const url = new URL(req.url ?? TRANSCRIPT_ROUTE_PATH, 'http://localhost')
      const sessionId = url.searchParams.get('session') ?? ''
      const maxChars = clampInt(url.searchParams.get('maxChars'), 2000, 200_000, MAX_TRANSCRIPT_CHARS)
      try {
        return sendJson(res, 200, readTranscript(ctx, sessionId, maxChars))
      } catch (error) {
        ctx.logger?.warn?.('dsh-plugin-jev: transcript: ' + error.message)
        return sendJson(res, 502, { error: error.message })
      }
    },
  }), 'dsh-plugin-jev: transcript route')
}
