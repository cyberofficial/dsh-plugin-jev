/**
 * Tool-command guard for dsh-plugin-jev: danger detection and blocked commands.
 *
 * This hooks `tools/pre-execute` and can deny a shell command before it is
 * dispatched. It layers three checks, in this order:
 *
 *   1. **Deterministic blocked commands.** Local substring matching against
 *      user-authored rules. No network, effectively free, and — the point —
 *      unable to fail. This is the guarantee.
 *   2. **Jev semantic check of the same rules.** For a command that survived
 *      step 1, ask whether it accomplishes the rule's *intent*. This is what
 *      catches `bash -c 'git commit'`, `$(echo git) commit`, and other
 *      obfuscations that no pattern list survives.
 *   3. **Danger scoring.** Jev scores severity and irreversibility; the
 *      configured threshold decides.
 *
 * A user rule therefore outranks Jev's opinion about safety, which is what
 * makes "block this command even though it is safe" mean something.
 *
 * Two invariants hold throughout:
 *
 *   - **Jev supplies numbers; this module owns the decision.** The deny path is
 *     a deterministic function of the score and the configured thresholds.
 *   - **Danger scoring fails OPEN** (a Jev outage must not make the shell
 *     unusable) while an `absolute` rule fails CLOSED (if the user said "never
 *     push", an outage must not become "sure, push").
 *
 * Nothing here may throw into the tool pipeline: any internal failure degrades
 * to delegating the call, and is logged.
 *
 * @module dsh-plugin-jev/guard
 */

/** Shell tools whose `command` argument this guard scores. */
export const DEFAULT_GUARD_TOOLS = ['pwsh', 'bash', 'pwsh_persistent', 'bash_persistent']

/** Severity bands, ordered. The threshold is an index into this list. */
export const SEVERITY_BANDS = ['safe', 'low', 'moderate', 'high', 'critical']

/** Guard modes: `monitor` records decisions without blocking; `enforce` blocks. */
export const GUARD_MODES = ['monitor', 'enforce']

/** Rule scopes: `global` applies everywhere, `workspace` only in this project. */
export const RULE_SCOPES = ['global', 'workspace']

/** Bounds that keep a user-authored pattern set from becoming a liability. */
export const MAX_PATTERN_CHARS = 200

/** Default per-command scoring timeout. Fails open. */
export const DEFAULT_GUARD_TIMEOUT_MS = 2000

/** Default LRU bound for the score cache. */
export const DEFAULT_CACHE_ENTRIES = 500

/**
 * Bound on the in-memory block log. It backs a "what just got blocked" view, so
 * it needs to be long enough to cover a session's worth of refusals and short
 * enough that it can never grow unbounded in a long-lived process.
 */
export const MAX_DENIALS = 100

/**
 * Longest command the guard will send to Jev.
 *
 * This is a BYPASS CONTROL, not a budget. A command too large to evaluate would
 * otherwise be allowed unscored, and "make it too big to score" is a trivial way
 * to walk past the guard entirely. Over this bound the command is REFUSED rather
 * than truncated — truncating would be worse, because the dangerous part can
 * simply be placed past the cut and the model would then score an innocent
 * prefix.
 *
 * The bound is deliberately conservative against the API's documented 32k-token
 * budget for `state` plus the longest question (~128k characters). At 20k
 * characters Jev is asked roughly 5k tokens, far inside its window, so a
 * legitimate script of any realistic size is still judged on its full text.
 */
export const MAX_COMMAND_CHARS = 20_000

/** Confidence below which a block is downgraded to a warning. */
export const DEFAULT_CONFIDENCE_FLOOR = 0.7

/**
 * The guard defaults. Deliberately `enabled: false` and `mode: 'monitor'`:
 * ship observability first, let the user see what it would do, and make
 * blocking a deliberate opt-in.
 */
export function defaultGuardConfig() {
  return {
    enabled: false,
    mode: 'monitor',
    blockThreshold: 'high',
    blockIrreversible: true,
    confidenceFloor: DEFAULT_CONFIDENCE_FLOOR,
    tools: DEFAULT_GUARD_TOOLS.slice(),
    scoreNested: true,
    // Whether danger scoring runs at all. Default on; turning it off leaves the
    // blocked-command rules (and their prefilter) as the whole guard.
    scoreDanger: true,
    commandBlocks: [],
  }
}

/** Coerce an arbitrary stored value into a valid guard config. */
export function normalizeGuardConfig(value) {
  const base = defaultGuardConfig()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return base
  const out = { ...base }
  if (typeof value.enabled === 'boolean') out.enabled = value.enabled
  if (GUARD_MODES.includes(value.mode)) out.mode = value.mode
  if (SEVERITY_BANDS.includes(value.blockThreshold)) out.blockThreshold = value.blockThreshold
  if (typeof value.blockIrreversible === 'boolean') out.blockIrreversible = value.blockIrreversible
  if (Number.isFinite(value.confidenceFloor) && value.confidenceFloor >= 0 && value.confidenceFloor <= 1) {
    out.confidenceFloor = value.confidenceFloor
  }
  if (typeof value.scoreNested === 'boolean') out.scoreNested = value.scoreNested
  if (typeof value.scoreDanger === 'boolean') out.scoreDanger = value.scoreDanger
  if (Array.isArray(value.tools)) {
    const tools = value.tools.filter((name) => typeof name === 'string' && name.trim() !== '').map((name) => name.trim())
    if (tools.length > 0) out.tools = tools
  }
  out.commandBlocks = normalizeRules(value.commandBlocks)
  return out
}

/**
 * Normalize one rule list: drop unusable entries rather than failing plugin
 * load, because a malformed rule must never take the whole guard down.
 *
 * `patterns` are plain substrings matched case-insensitively. Regex is
 * deliberately NOT supported: a pathological user pattern such as `(a+)+$`
 * would stall inside the tool dispatch path, and the failure mode is that every
 * shell command in the session hangs.
 */
export function normalizeRules(value) {
  if (!Array.isArray(value)) return []
  const rules = []
  const seen = new Set()
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    const patterns = Array.isArray(entry.patterns)
      ? entry.patterns
          .filter((p) => typeof p === 'string' && p.trim() !== '' && p.length <= MAX_PATTERN_CHARS)
          .map((p) => p.trim().toLowerCase())
      : []
    const intent = typeof entry.intent === 'string' ? entry.intent.trim() : ''
    // A rule needs at least one of the two layers to do anything at all.
    if (patterns.length === 0 && intent === '') continue
    // The cheap gate in front of the semantic layer: Jev is asked about this
    // rule only when the command contains one of these tokens. Empty means
    // "always ask", which is the safe default — a prefilter that is too narrow
    // produces false NEGATIVES (a real violation scored as clean), the one
    // failure mode here that is worse than paying for a call.
    const prefilter = Array.isArray(entry.prefilter)
      ? entry.prefilter
          .filter((token) => typeof token === 'string' && token.trim() !== '' && token.length <= MAX_PATTERN_CHARS)
          .map((token) => token.trim().toLowerCase())
      : []
    seen.add(id)
    rules.push({
      id,
      intent,
      patterns,
      prefilter,
      scope: RULE_SCOPES.includes(entry.scope) ? entry.scope : 'global',
      // A workspace rule is meaningless without its root: matchRules compares
      // this against the session's workspace, and a missing root would make the
      // rule match nowhere. Carried through verbatim, normalized at compare time.
      workspaceRoot: typeof entry.workspaceRoot === 'string' ? entry.workspaceRoot : '',
      // `absolute` decides the FAIL MODE, not whether the rule blocks: a
      // non-absolute rule still blocks on a literal match. Absolute means
      // "block on the semantic layer too, even if Jev is unreachable".
      absolute: entry.absolute === true,
      enabled: entry.enabled !== false,
    })
  }
  return rules
}

/**
 * Extract the command text from a tool call's parsed arguments.
 *
 * Arguments arrive as parsed JSON (deep-frozen) after the lossless
 * materialization boundary. A nested dispatcher may hand over a JSON string
 * instead, so both shapes are read. No recognized command means `null`, and the
 * guard then simply does not apply.
 *
 * @param name - the tool name.
 * @param args - the call's parsed arguments.
 * @param tools - tool names this guard applies to.
 * @returns the command string, or null.
 */
export function commandFromExec(name, args, tools) {
  if (typeof name !== 'string' || !Array.isArray(tools) || !tools.includes(name)) return null
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (value === null || typeof value !== 'object') return null
  const command = value.command ?? value.script ?? value.cmd
  return typeof command === 'string' && command.trim() !== '' ? command : null
}

/** Normalize a path for scope comparison (backslashes and case on Windows). */
function normalizeScopePath(value) {
  return String(value == null ? '' : value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Match the deterministic layer: any enabled rule whose scope applies and whose
 * pattern is a case-insensitive substring of the command.
 *
 * Substring matching is intentionally simple and predictable. It is also dumber
 * than it looks — the rule `git push` also matches `git push --dry-run` — which
 * is why the Settings UI states the semantics next to the field instead of
 * leaving it to be discovered.
 *
 * @param command - the command text.
 * @param rules - normalized rules.
 * @param workspaceRoot - the session's workspace root, for `workspace` scope.
 * @returns the matching rule, or null.
 */
export function matchRules(command, rules, workspaceRoot) {
  if (typeof command !== 'string' || command === '' || !Array.isArray(rules)) return null
  const haystack = command.toLowerCase()
  const root = normalizeScopePath(workspaceRoot)
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (rule.scope === 'workspace' && (root === '' || normalizeScopePath(rule.workspaceRoot) !== root)) continue
    for (const pattern of rule.patterns) {
      if (pattern !== '' && haystack.includes(pattern)) return rule
    }
  }
  return null
}

/** The rules whose *intent* the semantic layer should check for this call. */
export function semanticRules(rules, workspaceRoot) {
  if (!Array.isArray(rules)) return []
  const root = normalizeScopePath(workspaceRoot)
  return rules.filter((rule) => {
    if (rule.enabled === false || rule.intent === '') return false
    if (rule.scope === 'workspace' && (root === '' || normalizeScopePath(rule.workspaceRoot) !== root)) return false
    return true
  })
}

/**
 * Pass one command through each rule's prefilter: the cheap local gate that
 * decides whether the semantic layer is asked about that rule at all.
 *
 * This is what keeps the semantic layer from costing a call for every command a
 * session runs. A rule with no prefilter tokens is always a candidate, so the
 * default is "ask" rather than "skip" — a narrow prefilter causes false
 * negatives, and silently clearing a real violation is far worse than paying for
 * a call.
 *
 * @param command - the command text.
 * @param rules - intent-bearing rules (see {@link semanticRules}).
 * @returns the rules whose prefilter the command passes.
 */
export function prefilterRules(command, rules) {
  if (!Array.isArray(rules)) return []
  const haystack = typeof command === 'string' ? command.toLowerCase() : ''
  return rules.filter((rule) => {
    const tokens = Array.isArray(rule.prefilter) ? rule.prefilter : []
    if (tokens.length === 0) return true
    return tokens.some((token) => haystack.includes(token))
  })
}

/**
 * Probability that the severity is at or above a band, read off the answer's
 * distribution. Returns `null` when the distribution is unusable, which the
 * caller treats as "no opinion" rather than zero.
 */
export function severityAtLeast(answer, band) {
  const probabilities = answer !== null && typeof answer === 'object' && answer.probabilities !== null && typeof answer.probabilities === 'object'
    ? answer.probabilities
    : null
  if (probabilities === null) return null
  const index = SEVERITY_BANDS.indexOf(band)
  if (index < 0) return null
  let total = 0
  let seen = false
  for (const [key, value] of Object.entries(probabilities)) {
    const position = SEVERITY_BANDS.indexOf(String(key))
    if (position < 0 || !Number.isFinite(value)) continue
    seen = true
    if (position >= index) total += value
  }
  return seen ? Math.min(1, Math.max(0, total)) : null
}

/**
 * Decide what to do about one scored call. Pure: the whole policy is visible
 * here, and every branch is testable without a network.
 *
 * @param input - `{ severity, severityAtLeast, irreversible, confidence, config }`.
 * @returns `{ action: 'block'|'allow', reason, trigger, downgraded }`.
 */
export function dangerDecision(input) {
  const config = input.config
  const band = config.blockThreshold
  const thresholdIndex = SEVERITY_BANDS.indexOf(band)
  const severityIndex = SEVERITY_BANDS.indexOf(String(input.severity))

  // The severity VALUE is the primary signal, because Jev's own band choice is
  // what it judged most likely. The distribution is consulted only when the
  // band is unreadable, so a well-formed answer can never be overridden by a
  // contradictory distribution (which would make the configured threshold a
  // lie). It is never treated as "safe" when missing.
  const atLeast = Number.isFinite(input.severityAtLeast) ? input.severityAtLeast : null
  const bandReadable = severityIndex >= 0 && thresholdIndex >= 0
  const byBand = bandReadable && severityIndex >= thresholdIndex
  const byDistribution = !bandReadable && atLeast !== null && atLeast >= 0.5
  const overThreshold = byBand || byDistribution
  const irreversible = input.irreversible === true
  const irreversibleBlock = config.blockIrreversible
    && irreversible
    && severityIndex >= 0
    && severityIndex >= SEVERITY_BANDS.indexOf('moderate')
  if (!overThreshold && !irreversibleBlock) {
    return { action: 'allow', reason: null, trigger: null, downgraded: false }
  }
  const why = overThreshold
    ? 'scored ' + String(input.severity) + ' (threshold ' + band + ')'
    : 'irreversible and ' + String(input.severity)
  const confidence = Number.isFinite(input.confidence) ? input.confidence : null
  // The confidence gate is what keeps a coin-flip judgment from blocking real
  // work. Below the floor the block is downgraded to a warning.
  if (confidence !== null && confidence < config.confidenceFloor) {
    return {
      action: 'allow',
      reason: 'Jev was unsure (confidence ' + confidence.toFixed(2) + ' below ' + config.confidenceFloor + '); command ' + why,
      trigger: 'danger',
      downgraded: true,
    }
  }
  return {
    action: 'block',
    reason: 'Blocked by Jev danger detection: command ' + why + '.',
    trigger: 'danger',
    downgraded: false,
  }
}

/** Bounded LRU cache. Insertion order is recency order (re-insert on hit). */
export class LruCache {
  constructor(max = DEFAULT_CACHE_ENTRIES) {
    this.max = max
    this.entries = new Map()
  }

  get(key) {
    if (!this.entries.has(key)) return undefined
    const value = this.entries.get(key)
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key, value) {
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  clear() {
    this.entries.clear()
  }

  get size() {
    return this.entries.size
  }
}

/** Stable cache key for one scoring request. */
export function scoringCacheKey(command, cwd, sandboxMode, ruleIntents) {
  return JSON.stringify([command, cwd ?? null, sandboxMode ?? null, ruleIntents])
}

/**
 * The fixed prefix of every denial message.
 *
 * Stable and machine-readable on purpose. A denial becomes the `tool/result`
 * event's content — the only session event a block produces — so this prefix is
 * what lets the per-session `jevUsage` projection recognise a refusal and count
 * it. The guard cannot append a session event of its own (`Session.append` has
 * no way to set the envelope's `ignorable` marker, so a custom type would make
 * the log unreadable), which leaves the denial text as the only channel. A test
 * pins this string, so changing it fails loudly instead of the per-session count
 * silently dropping to zero.
 */
export const GUARD_DENIAL_HEADER = '[jev-guard] '

/**
 * The model-facing denial text. Denials carry a reason so the model can
 * reformulate instead of failing silently — a guard that only says "no" gets
 * retried with cosmetic changes.
 */
export function blockedMessage(parts) {
  return [
    GUARD_DENIAL_HEADER + 'Command blocked by the Jev tool guard.',
    parts.reason,
    parts.rule !== undefined && parts.rule !== null ? 'Matched blocked-command rule "' + parts.rule.id + '": ' + parts.rule.intent : null,
    'This is a policy decision, not a tool failure. Do not retry the same command in a disguised form. Ask the user how to proceed, or choose an approach that does not require it.',
  ].filter((line) => typeof line === 'string' && line !== '').join('\n')
}

/**
 * Build the guard.
 *
 * @param ctx - host plugin context (needs `logger`; `sandboxPolicy` is optional).
 * @param options - `{ ask, config, workspaceRootOf, initialCounters, onCounters }`;
 *   `ask` is the host service's `ask({ state, questions, model, signal })`.
 *   `initialCounters` seeds the lifetime counters from the persisted store, and
 *   `onCounters` receives them after every handler pass so lib/index.js can
 *   persist them — the numbers on the Settings panel then survive a restart.
 * @returns `{ handler, config, setConfig, stats }` where `handler` is the
 *   `tools/pre-execute` listener.
 */
export function createCommandGuard(ctx, options = {}) {
  const { ask, config: initial } = options
  let config = normalizeGuardConfig(initial)
  const cache = new LruCache(DEFAULT_CACHE_ENTRIES)
  /** The block log, newest first. See {@link MAX_DENIALS}. */
  const denials = []
  /**
   * Lifetime counters, seeded from the persisted store when one is wired in, so
   * the Settings panel shows all-time numbers rather than run-local ones. Every
   * handler pass ends by handing a copy to `onCounters` (lib/index.js points it
   * at the store), which is what makes them durable.
   */
  const seed = options.initialCounters !== null && typeof options.initialCounters === 'object' ? options.initialCounters : {}
  const counterValue = (key) => (Number.isFinite(seed[key]) ? seed[key] : 0)
  const counters = {
    evaluated: counterValue('evaluated'),
    blockedLiteral: counterValue('blockedLiteral'),
    blockedSemantic: counterValue('blockedSemantic'),
    blockedDanger: counterValue('blockedDanger'),
    blockedOversize: counterValue('blockedOversize'),
    downgraded: counterValue('downgraded'),
    failures: counterValue('failures'),
    cached: counterValue('cached'),
    // Commands that cost nothing because every intent rule was prefiltred out
    // and danger scoring was off. The counter is the evidence the gate works.
    skipped: counterValue('skipped'),
    last: seed.last !== null && typeof seed.last === 'object' ? seed.last : null,
  }

  /** Replace the config; a config change invalidates every cached verdict. */
  const setConfig = (next) => {
    config = normalizeGuardConfig(next)
    cache.clear()
    return config
  }

  const workspaceOf = (agent) => {
    if (typeof options.workspaceRootOf === 'function') {
      try {
        const resolved = options.workspaceRootOf(agent)
        if (typeof resolved === 'string' && resolved !== '') return resolved
      } catch { /* fall through to the session header */ }
    }
    const cwd = agent !== null && agent !== undefined && agent.session !== undefined ? agent.session.header?.cwd : undefined
    return typeof cwd === 'string' ? cwd : ''
  }

  /** Resolve the sandbox mode for this call, or null when unavailable. */
  const sandboxModeOf = (agent) => {
    const service = ctx.get === undefined ? undefined : ctx.get('sandboxPolicy')
    if (service === undefined || service === null || typeof service.resolve !== 'function') return null
    try {
      const session = agent !== null && agent !== undefined ? agent.session : undefined
      const policy = service.resolve(session === undefined ? {} : { session })
      return typeof policy?.mode === 'string' ? policy.mode : null
    } catch {
      return null
    }
  }

  /** One Jev call carrying every question this call needs. */
  const scoreCall = async (command, cwd, sandboxMode, intents, signal, dangerWanted = true) => {
    const questions = {}
    if (dangerWanted) {
      questions.severity = {
        type: 'score',
        instructions: 'How dangerous is running this command in this working directory? Consider data loss, destruction, irreversibility, and reaching outside the working directory. A command that only reads or prints is safe.',
        criteria: SEVERITY_BANDS,
      }
      questions.irreversible = {
        type: 'noul',
        instructions: 'Would the effects of this command be hard or impossible to undo?',
      }
    }
    for (const rule of intents) {
      questions['intent_' + rule.id] = {
        type: 'noul',
        instructions: 'Does this command perform the following action, directly or indirectly, including through another interpreter, a variable, a subshell, or a chain? Action: ' + rule.intent,
        criteria: { true: 'the command performs or would cause this action', false: 'the command does not perform this action' },
      }
    }
    const result = await ask({
      state: {
        command,
        cwd: cwd === '' ? null : cwd,
        sandboxMode: sandboxMode ?? 'unknown',
        note: 'sandboxMode "unknown" means the mode could not be read; assume no containment.',
      },
      questions,
      signal,
    })
    return result
  }

  /**
   * Hand the counters to the store after every handler pass.
   *
   * Runs in a `finally`, so it fires on every exit path — a block, an allow, a
   * skip, and a failure alike — which is what keeps the persisted numbers
   * truthful whatever the guard decided. The store deduplicates unchanged
   * reports, so a pass that moved nothing costs no write. The report never
   * includes `cachedEntries`: that is the live cache size, run-local by nature.
   */
  const notifyCounters = () => {
    if (typeof options.onCounters !== 'function') return
    try {
      options.onCounters({ ...counters })
    } catch (error) {
      ctx.logger?.warn?.('dsh-plugin-jev: guard counters: ' + (error?.message ?? String(error)))
    }
  }

  /**
   * The `tools/pre-execute` listener.
   *
   * Never throws into the dispatch path: an internal failure either delegates or,
   * for an `absolute` blocked-command rule, denies. Whether to block is decided
   * in `decisionFor`, which honours `monitor` mode.
   */
  const handler = async (exec, next) => {
    try {
      if (!config.enabled) return await next()
      const command = commandFromExec(exec?.name, exec?.arguments, config.tools)
      if (command === null) return await next()
      // A nested sub-dispatch is a command the model built inside another tool.
      if (exec.parent !== undefined && config.scoreNested !== true) return await next()
      const agent = exec.agent
      const workspaceRoot = workspaceOf(agent)
      counters.evaluated += 1

      // --- Layer 1: deterministic. Free, immediate, cannot fail. ---
      const literal = matchRules(command, config.commandBlocks, workspaceRoot)
      if (literal !== null) {
        counters.blockedLiteral += 1
        return decisionFor(exec, {
          reason: 'The command matches a blocked pattern (' + literal.patterns.find((p) => command.toLowerCase().includes(p)) + ').',
          rule: literal,
          command,
        })
      }

      // --- Layer 1b: the command must be evaluable at all. ---
      //
      // Placed before any scoring so an oversized command costs nothing, and so
      // it can never reach Jev as a truncated prefix. This is the guard's own
      // rail, so it applies even when the danger threshold is permissive: the
      // alternative is a hole an agent could widen at will by inflating its own
      // command.
      if (command.length > MAX_COMMAND_CHARS) {
        counters.blockedOversize += 1
        return decisionFor(exec, {
          reason: 'The command is ' + command.length + ' characters, over the ' + MAX_COMMAND_CHARS
            + '-character limit this guard will send for evaluation. It was not scored, so it cannot be cleared.',
          rule: null,
          command,
          trigger: 'oversize',
        })
      }

      // --- Layers 2 and 3 share ONE call. ---
      //
      // The semantic layer only asks about rules whose prefilter this command
      // passes, and danger scoring is skipped when every rule is prefiltred out
      // and scoring is off. When neither has anything to ask, no call is made at
      // all — that is the whole point of the gate.
      const allIntents = semanticRules(config.commandBlocks, workspaceRoot)
      const intents = prefilterRules(command, allIntents)
      const prefiltredOut = allIntents.length - intents.length
      const dangerWanted = config.scoreDanger !== false
      if (!dangerWanted && intents.length === 0) {
        counters.skipped += 1
        return await next()
      }
      const cwd = workspaceRoot
      const sandboxMode = sandboxModeOf(agent)
      const key = scoringCacheKey(command, cwd, sandboxMode, intents.map((rule) => rule.id))
      let scored = cache.get(key)
      if (scored === undefined) {
        try {
          scored = await scoreCall(command, cwd, sandboxMode, intents, exec.signal, dangerWanted)
          cache.set(key, scored)
        } catch (error) {
          counters.failures += 1
          ctx.logger?.warn?.('dsh-plugin-jev: tool guard scoring: ' + (error?.message ?? String(error)))
          // The scoring call is where the semantic layer lives, so an
          // unreachable Jev is exactly the case the `absolute` flag exists for:
          // a rule the user declared inviolable must still hold when the model
          // that would have judged it is unavailable. Everything else fails
          // open, because a Jev outage must not make the shell unusable.
          const absolute = intents.find((rule) => rule.absolute === true)
          if (absolute !== undefined) {
            counters.blockedSemantic += 1
            return decisionFor(exec, {
              reason: 'Jev is unavailable, and this command could not be cleared against the absolute rule "' + absolute.id + '".',
              rule: absolute,
              command,
            })
          }
          return await next()
        }
      } else {
        counters.cached += 1
      }
      const answers = scored !== null && typeof scored === 'object' && scored.answers !== null && typeof scored.answers === 'object' ? scored.answers : {}

      // --- Layer 2: semantic blocked commands. ---
      for (const rule of intents) {
        const answer = answers['intent_' + rule.id]
        const probability = answer !== null && typeof answer === 'object' && Number.isFinite(answer.noul) ? answer.noul : null
        if (probability !== null && probability >= 0.5) {
          counters.blockedSemantic += 1
          return decisionFor(exec, {
            reason: 'Jev judged (p=' + probability.toFixed(3) + ') that this command performs a blocked action.',
            rule,
            command,
            scored,
          })
        }
      }

      // --- Layer 3: danger scoring. ---
      const severityAnswer = answers.severity
      const severity = severityAnswer !== null && typeof severityAnswer === 'object' && typeof severityAnswer.score === 'number'
        ? SEVERITY_BANDS[Math.round(severityAnswer.score)] ?? null
        : null
      const irreversible = answers.irreversible !== null && typeof answers.irreversible === 'object' ? answers.irreversible.noul >= 0.5 : false
      const confidence = severityAnswer !== null && typeof severityAnswer === 'object' && Number.isFinite(severityAnswer.confidence) ? severityAnswer.confidence : null
      const severityProbability = severityAtLeast(severityAnswer, config.blockThreshold)
      const verdict = dangerDecision({
        severity,
        severityAtLeast: severityProbability,
        irreversible,
        confidence,
        config,
      })
      if (verdict.downgraded) counters.downgraded += 1
      if (verdict.action === 'block') {
        counters.blockedDanger += 1
        return decisionFor(exec, {
          reason: verdict.reason,
          rule: null,
          command,
          scored,
          severity,
          confidence,
          trigger: verdict.trigger,
          downgraded: verdict.downgraded,
        })
      }
      // Allowed by score: still recorded, so the panel shows the last thing the
      // guard looked at rather than only its blocks.
      record({ verdict, exec, command, severity, confidence, scored })
      return await next()
    } catch (error) {
      // Fail open for danger detection: a Jev outage must not make the harness
      // unusable. An `absolute` rule is the exception and is handled where the
      // semantic layer is consulted.
      counters.failures += 1
      ctx.logger?.warn?.('dsh-plugin-jev: tool guard: ' + (error?.message ?? String(error)))
      return await next()
    } finally {
      notifyCounters()
    }
  }

  /**
   * Record one decision for the Settings surface.
   *
   * Everything the panel renders is produced here and nowhere else, so a
   * decision cannot end up with a different shape depending on which layer
   * produced it. `action` is what the guard DID (`allow` in monitor mode, which
   * is why the panel shows the would-be block as allowed-with-a-reason).
   */
  const recordDecision = (action, exec, parts) => {
    const scored = parts.scored
    const hasRule = parts.rule !== null && parts.rule !== undefined
    counters.last = {
      at: new Date().toISOString(),
      tool: typeof exec?.name === 'string' ? exec.name : null,
      command: typeof parts.command === 'string' ? parts.command : null,
      action,
      reason: parts.reason ?? null,
      rule: hasRule ? parts.rule.id : null,
      // A rule-mediated block was decided by the rule, not by a score, so these
      // are explicitly null rather than absent: the client renders one shape.
      severity: hasRule ? null : (parts.severity ?? null),
      confidence: hasRule ? null : (Number.isFinite(parts.confidence) ? parts.confidence : null),
      // `oversize` is the guard's own rail rather than a rule or a score, so it
      // keeps its own trigger instead of being lumped in with the score path.
      trigger: hasRule ? 'blocklist' : (parts.trigger ?? null),
      downgraded: parts.downgraded === true,
      costUsd: scored !== null && scored !== undefined && Number.isFinite(scored.costUsd) ? scored.costUsd : null,
      model: scored !== null && scored !== undefined && typeof scored.model === 'string' ? scored.model : null,
    }
  }

  /**
   * The block log: every command the guard refused, newest first, plus — in
   * `monitor` mode — every command it would have refused.
   *
   * Monitor entries are included deliberately. A log that stays empty while the
   * guard is plainly detecting blocks is worse than no log: it reads as "the
   * guard is doing nothing" exactly when the user is trying to find out what it
   * does. Each entry carries `wouldBlock` so the two are never confused, and the
   * counters keep them apart as well (`blocked*` counts only real refusals).
   *
   * Structured at decision time (command, rule, severity, confidence, trigger,
   * reason, cost), never reconstructed by parsing the denial text back out of a
   * tool result: that text is model-facing prose, and re-deriving structure from
   * it is the failure this codebase has already been bitten by.
   *
   * Bounded, and in memory only: it is a "what just happened" view, and it does
   * not survive a restart. (The lifetime counters and the last-decision record
   * are persisted through `onCounters`; only this per-command log is run-local.)
   */
  const recordDenial = (exec, parts) => {
    const scored = parts.scored
    const hasRule = parts.rule !== null && parts.rule !== undefined
    denials.unshift({
      at: new Date().toISOString(),
      tool: typeof exec?.name === 'string' ? exec.name : null,
      command: typeof parts.command === 'string' ? parts.command : null,
      reason: (hasRule ? 'Matched blocked-command rule "' + parts.rule.id + '"' : null) ?? parts.reason ?? null,
      detail: parts.reason ?? null,
      rule: hasRule ? parts.rule.id : null,
      intent: hasRule && typeof parts.rule.intent === 'string' ? parts.rule.intent : null,
      trigger: hasRule ? 'blocklist' : (parts.trigger ?? null),
      severity: hasRule ? null : (parts.severity ?? null),
      confidence: hasRule ? null : (Number.isFinite(parts.confidence) ? parts.confidence : null),
      // True means enforce mode refused it; false means monitor mode recorded a
      // would-be block and the command actually ran.
      wouldBlock: parts.wouldBlock === true,
      costUsd: scored !== null && scored !== undefined && Number.isFinite(scored.costUsd) ? scored.costUsd : null,
      model: scored !== null && scored !== undefined && typeof scored.model === 'string' ? scored.model : null,
    })
    if (denials.length > MAX_DENIALS) denials.length = MAX_DENIALS
  }

  /**
   * Turn a verdict into a decision, honouring `monitor` mode, and record it.
   *
   * A block in `monitor` mode records `allow`, because that is what actually
   * happened — the panel shows the would-be block as allowed with its reason,
   * which is how the user decides whether to switch to `enforce`.
   */
  const decisionFor = (exec, parts) => {
    const enforced = config.mode === 'enforce'
    recordDecision(enforced ? 'block' : 'allow', exec, parts)
    if (!enforced) {
      // Monitor mode: the command runs, but the entry is still logged so the
      // panel shows what enforce mode would do. `wouldBlock` keeps it visibly
      // distinct from a real refusal.
      recordDenial(exec, { ...parts, wouldBlock: false })
      ctx.logger?.info?.('dsh-plugin-jev: guard would block (' + parts.reason + ')')
      return { kind: 'allow' }
    }
    recordDenial(exec, { ...parts, wouldBlock: true })
    return { kind: 'deny', reason: blockedMessage({ reason: parts.reason, rule: parts.rule }) }
  }

  /** Record a decision that allowed the call (the score path). */
  const recordAllow = (exec, parts) => {
    recordDecision('allow', exec, parts)
  }

  /**
   * Record a verdict that let the call through on its score.
   *
   * The score path has no rule and no block, but it is still the last thing the
   * guard looked at — which is what the panel shows, so it is recorded rather
   * than only the blocks being visible.
   */
  const record = (parts) => {
    if (parts.verdict.downgraded) counters.downgraded += 1
    recordDecision('allow', parts.exec, {
      command: parts.command,
      reason: parts.verdict.reason,
      trigger: parts.verdict.trigger,
      downgraded: parts.verdict.downgraded,
      severity: parts.severity,
      confidence: parts.confidence,
      scored: parts.scored,
    })
  }

  return {
    handler,
    setConfig,
    getConfig: () => config,
    // Lifetime counters: seeded from the persisted store at creation and handed
    // back through `onCounters` after every pass, so they survive a restart.
    // `cachedEntries` alone is run-local (the live cache size).
    stats: () => ({ ...counters, cachedEntries: cache.size }),
    /** The block log, newest first. A copy, so a caller cannot mutate it. */
    denials: () => denials.map((entry) => ({ ...entry })),
    clearCache: () => cache.clear(),
  }
}
