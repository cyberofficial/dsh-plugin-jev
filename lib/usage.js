/**
 * Per-session Jev usage: the durable fold and the client-visible projection.
 *
 * Each completed `jev_ask` call projects its usage onto the `tool/result`
 * event's `meta.jevUsage` field (see the tool's `output.presentationMeta`
 * in lib/tool.js). The `jevUsage` projection folds those events into one
 * whole value (`{ calls, inputTokens, outputTokens, costUsd, lastAt, byModel }`)
 * that the session controller ships to the browser, where the composer-dock
 * stats chip reads it with `useProjection('jevUsage')`. Nothing here is
 * stored outside the session log.
 *
 * IMPORTANT: this rides the built-in `tool/result` event type, NOT a custom
 * event. An earlier version appended a custom `jev/usage` event; that broke
 * session reload, because the harness refuses any persisted event type it does
 * not know unless the event is marked `ignorable: true` — and out-of-tree
 * plugins have no append API that sets that marker. The legacy `jev/usage`
 * type is still folded when a repaired historical log supplies one (those
 * events were retro-marked ignorable), so old sessions keep their counts.
 *
 * The projection needs a zod-shaped schema only for its `.parse` seam; the
 * projection service calls nothing else, and an out-of-tree plugin cannot import
 * zod, so a duck-typed identity schema is used deliberately.
 *
 * @module dsh-plugin-jev/usage
 */

/** The projection key the dock reads; also the `tool/result.meta` field name. */
export const JEV_USAGE_KEY = 'jevUsage'

/** The legacy custom event type (pre-tool/result-meta logs; folded when present). */
export const JEV_USAGE_EVENT = 'jev/usage'

/** Bump when the folded state shape changes. */
export const JEV_USAGE_STATE_VERSION = 1

/** A fresh zeroed per-session usage value. */
export function emptyJevUsage() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, lastAt: null, byModel: {} }
}

/** Coerce a projection value into the folded shape. */
function normalizeJevUsage(value) {
  if (value === null || typeof value !== 'object') return emptyJevUsage()
  const byModel = {}
  const source = value.byModel !== null && typeof value.byModel === 'object' ? value.byModel : {}
  for (const [key, entry] of Object.entries(source)) {
    const name = String(key).trim()
    if (name === '' || entry === null || typeof entry !== 'object') continue
    byModel[name] = {
      calls: Number.isFinite(entry.calls) ? entry.calls : 0,
      inputTokens: Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0,
      outputTokens: Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0,
      costUsd: Number.isFinite(entry.costUsd) ? entry.costUsd : 0,
    }
  }
  return {
    calls: Number.isFinite(value.calls) ? value.calls : 0,
    inputTokens: Number.isFinite(value.inputTokens) ? value.inputTokens : 0,
    outputTokens: Number.isFinite(value.outputTokens) ? value.outputTokens : 0,
    costUsd: Number.isFinite(value.costUsd) ? value.costUsd : 0,
    lastAt: typeof value.lastAt === 'string' ? value.lastAt : null,
    byModel,
  }
}

/**
 * Fold one session event into the per-session usage value. Any event that
 * carries no Jev usage is a no-op, so the projection can sit on the shared
 * session event feed without filtering. Usage comes from a `tool/result`
 * event whose `meta.jevUsage` is an object (the current source), or from a
 * legacy `jev/usage` event (retro-marked-ignorable historical logs).
 * @param state - the current folded value.
 * @param event - a SessionEvent.
 * @returns the next folded value (the same reference when unchanged).
 */
export function foldJevUsage(state, event) {
  const base = state !== null && typeof state === 'object' ? state : emptyJevUsage()
  if (event === null || typeof event !== 'object') return base
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  let source = null
  if (event.type === 'tool/result') {
    const meta = data.meta !== null && typeof data.meta === 'object' ? data.meta : null
    const usage = meta !== null && meta[JEV_USAGE_KEY] !== null && typeof meta[JEV_USAGE_KEY] === 'object' ? meta[JEV_USAGE_KEY] : null
    if (usage !== null) source = usage
  } else if (event.type === JEV_USAGE_EVENT) {
    source = data
  }
  if (source === null) return base
  const inputTokens = Number.isFinite(source.inputTokens) ? source.inputTokens : 0
  const outputTokens = Number.isFinite(source.outputTokens) ? source.outputTokens : 0
  const costUsd = Number.isFinite(source.costUsd) ? source.costUsd : 0
  const model = typeof source.model === 'string' && source.model !== '' ? source.model : null
  const baseByModel = base.byModel !== null && typeof base.byModel === 'object' ? base.byModel : {}
  const byModel = Object.assign({}, baseByModel)
  if (model !== null) {
    const entry = Object.assign({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, byModel[model])
    entry.calls += 1
    entry.inputTokens += inputTokens
    entry.outputTokens += outputTokens
    entry.costUsd += costUsd
    byModel[model] = entry
  }
  return {
    calls: (base.calls || 0) + 1,
    inputTokens: (base.inputTokens || 0) + inputTokens,
    outputTokens: (base.outputTokens || 0) + outputTokens,
    costUsd: (base.costUsd || 0) + costUsd,
    lastAt: typeof source.at === 'string'
      ? source.at
      : Number.isFinite(event.time)
        ? new Date(event.time).toISOString()
        : base.lastAt || null,
    byModel,
  }
}

/** The duck-typed identity schema the projection registry calls `.parse` on. */
const identitySchema = { parse: (value) => (value === null || typeof value !== 'object' ? emptyJevUsage() : value) }

/**
 * The registry-ready `jevUsage` projection definition. `wire` makes it
 * client-visible, so it lands in the session-controller baseline.
 * @returns the projection definition.
 */
export function createJevUsageProjection() {
  return {
    key: JEV_USAGE_KEY,
    stateVersion: JEV_USAGE_STATE_VERSION,
    stateSchema: identitySchema,
    init: () => emptyJevUsage(),
    apply: foldJevUsage,
    wire: {
      viewSchema: identitySchema,
      view: (state) => normalizeJevUsage(state),
    },
  }
}

/**
 * Register the `jevUsage` projection on the host context.
 * @param ctx - host plugin context with sessionProjections injected.
 * @returns the registered definition.
 */
export function registerJevUsageProjection(ctx) {
  const definition = createJevUsageProjection()
  ctx.effect(() => ctx.sessionProjections.register(definition), 'dsh-plugin-jev: ' + JEV_USAGE_KEY + ' projection')
  return definition
}

/**
 * Build the `tool/result` meta payload projecting one call's usage — the
 * value the tool's `output.presentationMeta` returns. The harness persists it
 * verbatim on the known `tool/result` event, so the per-session usage rides
 * the session log without inventing an event type the reader would refuse.
 * @param call - { model, inputTokens, outputTokens, costUsd, sessionId, at }.
 * @returns the `meta` object for the result event.
 */
export function jevUsageMeta(call) {
  return {
    [JEV_USAGE_KEY]: {
      model: typeof call.model === 'string' ? call.model : null,
      inputTokens: Number.isFinite(call.inputTokens) ? call.inputTokens : 0,
      outputTokens: Number.isFinite(call.outputTokens) ? call.outputTokens : 0,
      costUsd: Number.isFinite(call.costUsd) ? call.costUsd : 0,
      sessionId: typeof call.sessionId === 'string' ? call.sessionId : null,
      at: typeof call.at === 'string' ? call.at : new Date().toISOString(),
    },
  }
}

/** Format a USD cost for the stats chip (exported for tests). */
export function formatUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$0'
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.0001) return '$' + value.toPrecision(2)
  if (Math.abs(value) < 1) return '$' + value.toFixed(4)
  return '$' + value.toFixed(2)
}

/** One-line dock label for a folded per-session usage value (exported for tests). */
export function formatJevStats(usage) {
  const calls = usage !== null && typeof usage === 'object' && Number.isFinite(usage.calls) && usage.calls > 0 ? usage.calls : 0
  const cost = usage !== null && typeof usage === 'object' && Number.isFinite(usage.costUsd) ? usage.costUsd : 0
  return 'Jev · ' + (calls === 1 ? '1 call' : calls + ' calls') + ' · ' + formatUsd(cost)
}
