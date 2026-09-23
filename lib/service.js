/**
 * Host-side Jev decision service: the same calibrated `POST /v1/systemone` call
 * the agent's `jev_ask` tool makes, exposed to sibling plugins as an injectable
 * service instead of only to the model.
 *
 * Why this exists: `jev_ask` is reachable only by the model, so any other
 * plugin that wants a judgment has to spend a main-model round trip asking for
 * prose and parsing it back. That is slow, expensive, and uncalibrated. A host
 * consumer can instead do:
 *
 *   const jev = ctx.get('jev')
 *   const { answers } = await jev.ask({ state, questions })
 *
 * ...and branch on typed probabilities in about half a second.
 *
 * Scope discipline: this module supplies calibrated *numbers*. It deliberately
 * owns no policy. A consumer decides its own question shapes and, critically,
 * its own thresholds — a Jev answer must never by itself widen access or end a
 * goal. Consumers that gate control flow should fail open on any error here.
 *
 * Accounting: a host call is recorded in the persisted aggregate with
 * `source: 'host'`, so the Settings totals stay complete and the split between
 * model-driven and host-driven spend is visible. It cannot reach the per-chat
 * chip: that reads the `jevUsage` session projection, whose only source is
 * `tool/result` meta, and an out-of-tree plugin cannot append a session event
 * of its own (the envelope's `ignorable` marker is unsettable through
 * `Session.append`, so a custom type would make the log unreadable).
 *
 * @module dsh-plugin-jev/service
 */

import { buildRequest, askJev } from './index.js'

/** The service name sibling plugins inject and read. */
export const JEV_SERVICE_NAME = 'jev'

/**
 * Bound on a state handed to the service, matching the HTTP route's budget.
 * The API's own limit is 32k tokens for the state plus the longest question;
 * this is a cheap pre-flight refusal, not a substitute for that limit.
 */
export const MAX_SERVICE_STATE_CHARS = 200_000

/** Maximum questions per call, matching the API's documented cap. */
export const MAX_SERVICE_QUESTIONS = 64

/**
 * Validate service arguments before any credential or network work.
 *
 * The route path validates with the same helpers, but a host caller is not
 * behind `readJsonBody`, so this refuses malformed input at the seam with a
 * message naming the caller's own mistake rather than letting it surface as a
 * confusing upstream 400.
 *
 * @param input - the caller's `{ state, questions, model }`.
 * @throws when state or questions are missing or malformed, or the state is
 *   larger than the service budget.
 */
function assertServiceInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('jev.ask({ state, questions }) requires an options object')
  }
  if (input.state === undefined || input.state === null) {
    throw new TypeError('jev.ask: state is required and must be a non-empty string, object, or array')
  }
  const size = typeof input.state === 'string' ? input.state.length : JSON.stringify(input.state)?.length ?? 0
  if (size > MAX_SERVICE_STATE_CHARS) {
    throw new RangeError(
      'jev.ask: state is ' + size + ' chars, over the ' + MAX_SERVICE_STATE_CHARS
      + '-char service budget (the API allows ~32k tokens for state plus the longest question)',
    )
  }
  if (input.questions === undefined || input.questions === null) {
    throw new TypeError('jev.ask: questions is required and must be a map of typed questions')
  }
  if (typeof input.questions !== 'object' || Array.isArray(input.questions)) {
    throw new TypeError('jev.ask: questions must be a JSON object keyed by question id')
  }
  if (Object.keys(input.questions).length > MAX_SERVICE_QUESTIONS) {
    throw new RangeError('jev.ask: too many questions (max ' + MAX_SERVICE_QUESTIONS + ' per call)')
  }
  if (input.model !== undefined && input.model !== null && typeof input.model !== 'string') {
    throw new TypeError('jev.ask: model must be a string alias or id when present')
  }
}

/**
 * Build the host-side service object.
 *
 * @param ctx - host plugin context (needs `credentials` and/or
 *   `launchEnvironment`, exactly as the routes do).
 * @param options - transport and accounting hooks supplied by the plugin:
 *   `baseURL`, `fetchImpl`, `timeoutMs`, `costPerToken`, `defaultModel`, and
 *   `onUsage(call)`, called after a successful call so the caller can record it.
 * @returns the service object registered under {@link JEV_SERVICE_NAME}.
 */
export function createJevService(ctx, options = {}) {
  const {
    baseURL,
    fetchImpl,
    timeoutMs,
    costPerToken,
    defaultModel,
    onUsage,
  } = options

  /**
   * Ask Jev typed questions about one state.
   *
   * @param input - `{ state, questions, model?, signal?, source? }`; the
   *   questions map uses the same `noul` / `choice` / `score` shapes the tool
   *   documents. `signal` lets a caller on a critical path (the command guard,
   *   for example) abort when the user cancels the turn, and `source` labels the
   *   call in the usage aggregate (`'host'` by default, `'guard'` for the guard).
   * @returns `{ answers, model, usage, costUsd, elapsedMs, credential }`.
   * @throws a `TypeError`/`RangeError` on malformed input, or an `Error` with
   *   `.code === 'no-key'` when no TypeSafe credential is configured. Consumers
   *   that gate agent behaviour should catch and fail open.
   */
  const ask = async (input) => {
    assertServiceInput(input)
    const request = buildRequest({
      state: input.state,
      questions: input.questions,
      model: typeof input.model === 'string' && input.model.trim() !== '' ? input.model : defaultModel,
    })
    const result = await askJev(ctx, request, { baseURL, fetchImpl, timeoutMs, costPerToken, signal: input.signal })
    if (typeof onUsage === 'function') {
      try {
        onUsage({
          model: result.model,
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          costUsd: result.costUsd,
          source: input.source === 'guard' ? 'guard' : 'host',
        })
      } catch (error) {
        // Accounting must never fail the decision the caller asked for.
        ctx.logger?.warn?.('dsh-plugin-jev: host usage record: ' + error.message)
      }
    }
    return result
  }

  return { ask }
}
