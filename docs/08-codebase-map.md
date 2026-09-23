# Codebase map (for maintainers and integrating agents)

Package: `dsh-plugin-jev` 2.0.0, ESM ("type": "module"; no engines field declared). Entry `lib/index.js`.
Exports: `.` (host), `./service`, `./client` (built bundle), `./package.json`.

## Module map

| File | Owns | Key exports |
| --- | --- | --- |
| `lib/index.js` | The host half: constants, shared validation, transport, credential resolution, all HTTP routes, plugin `apply()` wiring | `apply`, `inject`, `name`, `parseQuestions`, `normalizeState`, `buildRequest`, `normalizeAnswers`, `normalizeModels`, `costOfUsage`, `foldTranscript`, `parseRetryAfter`, `askJev`, `readTranscript`, `resolveApiKey`, `describeCredential`, `mergeCommandBlocks`, `guardPayload`, `DEFAULT_MODEL`, `DEFAULT_COST_PER_TOKEN`, `TYPESAFE_CREDENTIAL_REF`, `KEY_CANDIDATES` |
| `lib/tool.js` | The agent-facing tool: schema, prompt guidance, answer rendering, usage meta | `registerJevTool`, `JEV_TOOL_NAME`, `JEV_TOOL_DESCRIPTION`, `JEV_TOOL_GUIDANCE`, `JEV_TOOL_PARAMETERS`, `JEV_TOOL_OUTPUT_SCHEMA`, `formatJevAnswers` |
| `lib/service.js` | The injectable host service for sibling plugins | `createJevService`, `JEV_SERVICE_NAME`, `ServiceInputError`, `MAX_SERVICE_STATE_CHARS`, `MAX_SERVICE_QUESTIONS` |
| `lib/guard.js` | The command guard: layers, decision table, rules, cache, records | `createCommandGuard`, `defaultGuardConfig`, `normalizeGuardConfig`, `normalizeRules`, `commandFromExec`, `matchRules`, `semanticRules`, `prefilterRules`, `severityAtLeast`, `dangerDecision`, `blockedMessage`, `scoringCacheKey`, `LruCache`, `SEVERITY_BANDS`, `GUARD_MODES`, `RULE_SCOPES`, `DEFAULT_GUARD_TOOLS`, `MAX_COMMAND_CHARS`, `MAX_DENIALS`, `MAX_PATTERN_CHARS`, `DEFAULT_CONFIDENCE_FLOOR`, `DEFAULT_GUARD_TIMEOUT_MS` |
| `lib/store.js` | The durable JSON store (aggregate, config, counters) | `JevStore`, `normalizeState`, `emptyUsage`, `USAGE_SOURCES`, `GUARD_COUNTER_KEYS`, `MAX_SESSIONS`, `STATE_FILE_NAME`, `resolveHome` |
| `lib/usage.js` | The per-chat projection fold and client-side render helpers | `registerJevUsageProjection`, `JEV_USAGE_KEY`, `JEV_USAGE_EVENT`, `emptyJevUsage`, `foldJevUsage`, `jevUsageMeta`, `isGuardDenial`, `GUARD_DENIAL_PREFIX` |
| `src/client.template.js` | Source of the client bundle (React, no build-time JSX) | `apply`, `JevStatsPill`, `JevSettingsTab`, `renderModal`, `renderDenialPanelBody`, `guardScored`, `guardAllTimeLine`, `badgeLabel`, `denialCounts`, `guardFormPatch`, `formatCost`, `formatJevStats` |
| `lib/client.js` | **Built** bundle (do not edit by hand; run `npm run build`) | the same API via `window.__ModuleLoader__.load` |
| `scripts/build-client.mjs` | Template → bundle builder; `--check` mode verifies freshness | -  |
| `cordis.patch.yml` | Bundle patch metadata for `dsh plugin install` | -  |

Note the two `normalizeState` exports: `lib/index.js` validates a *Jev request
state*, `lib/store.js` normalizes *persisted store state*. Same name, different
jobs.

## Constants that matter

| Constant | Value | File |
| --- | --- | --- |
| `BASE_URL` | `https://api.typesafe.ai/v1` | index |
| `ROUTE_BASE` | `/plugins/dsh-plugin-jev/api` | index |
| `DEFAULT_MODEL` | `jev-latest` | index |
| `DEFAULT_COST_PER_TOKEN` | `4.2e-8` (input only; output free) | index |
| `DEFAULT_TIMEOUT_MS` | 30,000 | index |
| `DEFAULT_CACHE_MS` (models) | 300,000 | index |
| `DEFAULT_RETRY_CAP_MS` | 30,000 | index |
| `MAX_QUESTIONS` / `MAX_SERVICE_QUESTIONS` | 64 | index / service |
| `MAX_REQUEST_CHARS` | 400,000 | index |
| `MAX_TRANSCRIPT_CHARS` | 40,000 (clamp 2,000-200,000) | index |
| `MAX_TRANSCRIPT_MESSAGES` / `MAX_MESSAGE_CHARS` | 80 / 1,200 | index |
| `MAX_SERVICE_STATE_CHARS` | 200,000 | service |
| `MAX_COMMAND_CHARS` | 20,000 (refuse, never truncate) | guard |
| `MAX_PATTERN_CHARS` | 200 | guard |
| `MAX_DENIALS` | 100 | guard |
| `DEFAULT_CACHE_ENTRIES` | 500 | guard |
| `DEFAULT_CONFIDENCE_FLOOR` | 0.7 | guard |
| `DEFAULT_GUARD_TIMEOUT_MS` | 2,000 -  **declared, not currently wired**; scoring rides the service's 30s timeout | guard |
| `MAX_SESSIONS` | 200 | store |

## How `apply()` wires everything

Order matters and is deliberate:

1. `registerJevUsageProjection` -  the projection exists before the tool.
2. `createJevService` + `ctx.provide('jev', …)` -  the service exists before the
   guard so the guard can ride it (`source: 'guard'` accounting).
3. `createCommandGuard` with `{ config: store.state.guard,
   initialCounters: store.state.guardCounters, onCounters: counters =>
   store.setGuardCounters(counters) }`, then `ctx.effect(() =>
   ctx.on('tools/pre-execute', guard.handler))`.
4. The `jev_ask` tool + prompt section (skippable with `toolEnabled: false`).
5. All HTTP routes (ask, models, status, key, transcript, settings, stats,
   guard).

## Invariants (the design decisions behind them are in the code comments)

1. **Jev supplies numbers; code owns the decision.** No behavior change is ever
   driven by a probability alone.
2. **Fail modes are explicit per path:** danger detection fails open; `absolute`
   rules fail closed (scoring-failure denial); accounting failures never fail a
   decision.
3. **Substrings, never regex** -  a pathological pattern must not stall the
   dispatch waterfall.
4. **Never truncate a command** -  refuse oversize instead; truncation could
   clear an innocent prefix while the dangerous tail runs.
5. **Never re-derive structure by parsing model-facing text** -  the v4 session
   format change broke exactly that once. Structured records at decision time;
   the `[jev-guard]` prefix is only a counter signal.
6. **A plugin cannot mint session events** -  no custom event types; usage rides
   `tool/result` meta and host calls stay aggregate-only.
7. **Ride built-in event shapes across format versions** -  the fold reads both
   the current flattened v4 tool result and the retired v3 wrapper.
8. **The store never holds the key; the key never appears in any response.**

## Tests (`npm test`)

| File | Covers | Notes |
| --- | --- | --- |
| `test/host.test.mjs` | validation, envelope normalization, transcript fold, credential resolution, pricing, **the `guardBlocks` fold** | pure functions |
| `test/tool.test.mjs` | tool schema enforcement, rendering, `meta.jevUsage` projection | |
| `test/service.test.mjs` | service contract, error taxonomy, accounting split | |
| `test/guard.test.mjs` | layers, decision table, cache, fail modes, counters persistence, routes | drives the real `apply()` |
| `test/key.test.mjs` | every HTTP route incl. ask-route accounting and 400 mapping | handlers driven with fake req/res |
| `test/client.test.mjs` | the built bundle: pill, modal, hook-count regression, fetch counting | `statefulReact` fake enforces React error #310 |
| `test/docs.test.mjs` | every testable claim in `docs/` against the library | if a doc and the code disagree, this fails |

Suite conventions: explicit `process.exit` at the end (stubbed timers leak
handles otherwise); timer spies call through; the `statefulReact` fake's
`seal()` catches any hook count change between renders (React #310).

## Known pitfalls (each one happened)

- Session format v4 flattened tool results; a reader of the retired v3 wrapper
  silently saw empty text. Read both shapes.
- Rebuilding fold/store state objects drops any key you forget to carry - 
  `guard`, `guardCounters`, `guardBlocks` all have regression tests for exactly
  this.
- `renderModal` is a render helper, not a component: no hooks inside, `body`
  takes a rendered element (a function passed as `children` goes straight to
  the DOM and renders empty).
- Question ids are open strings: avoid `-` in ids any downstream code might do
  arithmetic on (`sent.questions.intent_no-commit` parses as subtraction).
- PowerShell interpolation corrupts `$(...)` and `\$` in shell commands -  move
  complex test logic into script files.
- The harness runs `output.presentationMeta` only for root executions; nested
  dispatches carry no meta (the fold falls back to rendered text).

## Deploying changes

`npm test` (includes `check:build`), then **restart `dsh`** -  a plugin
contributes to the running harness only at startup. The store lives at
`~/.dsh/dsh-plugin-jev.json`.
