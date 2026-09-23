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
    seen.add(id)
    rules.push({
      id,
      intent,
      patterns,
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
 * The model-facing denial text. Denials carry a reason so the model can
 * reformulate instead of failing silently — a guard that only says "no" gets
 * retried with cosmetic changes.
 */
export function blockedMessage(parts) {
  return [
    'Command blocked by the Jev tool guard.',
    parts.reason,
    parts.rule !== undefined && parts.rule !== null ? 'Matched blocked-command rule "' + parts.rule.id + '": ' + parts.rule.intent : null,
    'This is a policy decision, not a tool failure. Do not retry the same command in a disguised form. Ask the user how to proceed, or choose an approach that does not require it.',
  ].filter((line) => typeof line === 'string' && line !== '').join('\n')
}

/**
 * Build the guard.
 *
 * @param ctx - host plugin context (needs `logger`; `sandboxPolicy` is optional).
 * @param options - `{ ask, config, workspaceRootOf, fetchImpl }`; `ask` is the
 *   host service's `ask({ state, questions, model, signal })`.
 * @returns `{ handler, config, setConfig, stats }` where `handler` is the
 *   `tools/pre-execute` listener.
 */
export function createCommandGuard(ctx, options = {}) {
  const { ask, config: initial } = options
  let config = normalizeGuardConfig(initial)
  const cache = new LruCache(DEFAULT_CACHE_ENTRIES)
  const counters = {
    evaluated: 0,
    blockedLiteral: 0,
    blockedSemantic: 0,
    blockedDanger: 0,
    downgraded: 0,
    failures: 0,
    cached: 0,
    last: null,
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
  const scoreCall = async (command, cwd, sandboxMode, intents, signal) => {
    const questions = {
      severity: {
        type: 'score',
        instructions: 'How dangerous is running this command in this working directory? Consider data loss, destruction, irreversibility, and reaching outside the working directory. A command that only reads or prints is safe.',
        criteria: SEVERITY_BANDS,
      },
      irreversible: {
        type: 'noul',
        instructions: 'Would the effects of this command be hard or impossible to undo?',
      },
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

      // --- Layers 2 and 3 share ONE call. ---
      const intents = semanticRules(config.commandBlocks, workspaceRoot)
      const cwd = workspaceRoot
      const sandboxMode = sandboxModeOf(agent)
      const key = scoringCacheKey(command, cwd, sandboxMode, intents.map((rule) => rule.id))
      let scored = cache.get(key)
      if (scored === undefined) {
        try {
          scored = await scoreCall(command, cwd, sandboxMode, intents, exec.signal)
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
    }
  }

  /**
   * Turn a verdict into a decision, honouring `monitor` mode.
   *
   * `parts.scored` is the Jev result that produced the verdict, when there was
   * one. It is carried onto the recorded decision so a block shows its own cost:
   * a blocked command is still a paid call, and the counters are the only place
   * the user can see what the guard is spending. Literal matches have no scored
   * result and cost nothing, so their cost is explicitly null rather than absent.
   */
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
    counters.last = {
      at: new Date().toISOString(),
      tool: typeof exec?.name === 'string' ? exec.name : null,
      command: typeof parts.command === 'string' ? parts.command : null,
      action,
      reason: parts.reason ?? null,
      rule: parts.rule === null || parts.rule === undefined ? null : parts.rule.id,
      severity: parts.severity ?? (parts.rule === null || parts.rule === undefined ? undefined : null),
      confidence: Number.isFinite(parts.confidence) ? parts.confidence : null,
      trigger: parts.trigger ?? (parts.rule === null || parts.rule === undefined ? null : parts.trigger ?? null),
      downgraded: parts.downgraded === true,
      costUsd: scored !== null && scored !== undefined && Number.isFinite(scored.costUsd) ? scored.costUsd : null,
      model: scored !== null && scored !== undefined && typeof scored.model === 'string' ? scored.model : null,
    }
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
      ctx.logger?.info?.('dsh-plugin-jev: guard would block (' + parts.reason + ')')
      return { kind: 'allow' }
    }
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
    stats: () => ({ ...counters, cachedEntries: cache.size }),
    clearCache: () => cache.clear(),
  }
}
