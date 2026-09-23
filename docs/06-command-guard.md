# The command guard

The guard hooks the harness's `tools/pre-execute` waterfall (root **and** nested
dispatches) and can deny a shell command **before it runs**, from either
user-authored blocked-command rules or Jev's own danger score. The model never
sees a denied command execute; it receives a structured policy message
(`[jev-guard] …`) that says this is a policy decision, not a tool failure.

**Honest limits, stated up front:** Jev is not 100% accurate. It can block safe
things and, with lower confidence, can allow dangerous things. It sees only the
command text, the working directory, and the sandbox mode -  not the command's
real side effects. It is one layer of defence in depth, never a security
boundary, and the repo owner is not accountable for what the agent runs. The
README carries the full warning; keep real backups.

## The layers, in order

1. **Literal patterns (free, instant, cannot fail).** Case-insensitive
   **substring** match of the command against each rule's `patterns`. No regex,
   deliberately: a pathological pattern like `(a+)+$` would stall every command
   in the session. Consequence: the pattern `git push` also matches
   `git push --dry-run`. Rule-mediated → trigger `blocklist`.
2. **Oversize rail (free, instant).** Commands longer than `MAX_COMMAND_CHARS`
   (20,000) are **refused, not truncated** (`trigger: 'oversize'`): a command
   too big to evaluate could hide its dangerous part past any cut, and
   truncation would let Jev clear an innocent prefix. Refusal is unconditional
   when the guard is enabled, regardless of the danger threshold.
3. **Semantic rules (one Jev call, fused with layer 4).** For each enabled
   intent-bearing rule whose **prefilter** the command passes, Jev is asked one
   `noul`: "does this command perform the following action, directly or
   indirectly, including through another interpreter, a variable, a subshell, or
   a chain?" `noul ≥ 0.5` → block (`trigger: 'blocklist'`).
4. **Danger scoring (same single call).** One `score` question over the bands
   `safe < low < moderate < high < critical` plus one `noul`
   (irreversibility). Jev also sees the command, the cwd, and the **resolved
   sandbox mode** (`rm -rf` means something different under `read-only` vs
   `danger-full-access`; when the mode cannot be read, `unknown` is sent with a
   note to assume no containment).

Layers 3 and 4 share **one** upstream call, and identical commands are cached
(LRU, 500 entries) keyed on command + cwd + sandboxMode + the rule ids asked.
When every rule is prefiltred out and danger scoring is off, no call is made at
all (counted as `skipped`).

## The decision table (pure function: `dangerDecision`)

Given the severity **value** (the primary signal), the probability that severity
is at or above the threshold (from the answer's distribution, used only when the
band is unreadable), the irreversibility probability, and Jev's `confidence`:

- severity ≥ threshold → **block**
- severity < threshold, `blockIrreversible` on, irreversibility ≥ 0.5,
  severity ≥ moderate → **block**
- any block whose `confidence < confidenceFloor` (default 0.7) is
  **downgraded to a warning** -  a coin-flip judgment must not block real work
  (counted as `downgraded`)
- otherwise → allow

Jev supplies numbers; this table owns the decision. It is deterministic and
fully testable offline.

## Modes and failure modes

- **`monitor` (default):** block never denies. Would-be blocks are logged with
  `wouldBlock: false` and counted, so you can judge the thresholds before
  trusting them.
- **`enforce`:** block denies (`wouldBlock: true`). Deny reason text starts with
  the fixed marker `[jev-guard] `.
- **Fail open everywhere except:** a scoring failure while an `absolute` rule
  was in scope denies (`trigger: 'blocklist'`, rule-named). Rationale: the
  semantic layer lives in the scoring call, so "Jev unreachable" is exactly when
  a rule the user declared inviolable must still hold. Everything else (any
  other failure) delegates and lets the command run; a Jev outage must not make
  the shell unusable.

## Config schema (persisted; normalize on read)

```json
{
  "enabled": false,
  "mode": "monitor",
  "blockThreshold": "high",
  "blockIrreversible": true,
  "confidenceFloor": 0.7,
  "tools": ["pwsh", "bash", "pwsh_persistent", "bash_persistent"],
  "scoreNested": true,
  "scoreDanger": true,
  "commandBlocks": [ { "id": "rule-1", "intent": "git commands",
                       "patterns": ["git fetch"], "prefilter": ["git"],
                       "scope": "global", "workspaceRoot": "",
                       "absolute": false, "enabled": true } ]
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | master switch; off = no interception at all |
| `mode` | `monitor` (default) or `enforce` |
| `blockThreshold` | band at/above which to block (`high` default) |
| `blockIrreversible` | escalate irreversible `moderate`+ commands |
| `confidenceFloor` | below this confidence a block becomes a warning (0.7) |
| `tools` | shell tools whose `command`/`script`/`cmd` argument is scored (default list above); an empty list falls back to the default rather than scoring nothing |
| `scoreNested` | also score commands built inside another tool (nested dispatch) |
| `scoreDanger` | run the severity/irreversibility questions at all; off = rules only |

### Rule fields

| Field | Meaning |
| --- | --- |
| `id` | stable, unique; generated as `rule-N` when absent on POST |
| `patterns` | substrings, lowercased, each ≤ 200 chars (`MAX_PATTERN_CHARS`) |
| `intent` | the action description for the semantic layer; empty = literal-only rule |
| `prefilter` | tokens; a rule is asked about a command only if the command contains one of them. **Empty means always ask** -  the safe default, because a too-narrow prefilter produces false negatives |
| `scope` | `global` or `workspace` (a workspace rule matches only when the session's cwd equals `workspaceRoot`) |
| `absolute` | decides the **fail mode**: on a scoring failure, an absolute rule denies; it does not change normal blocking |
| `enabled` | per-rule switch |

## Counters (what each number means)

`evaluated`, `blockedLiteral`, `blockedSemantic`, `blockedDanger`,
`blockedOversize`, `downgraded`, `failures`, `cached`, `skipped`, `last` - 
all-time: seeded from the persisted store at mount and handed back after **every**
handler pass (blocks, allows, skips, and failures alike), so they survive a
restart. Only `cachedEntries` (the live LRU size) is run-local. The block log
(`denials`) is deliberately in-memory: it is a "what just happened" view, ≤ 100
entries, not a durable audit trail. See [07-accounting.md](07-accounting.md).

## Invariants (do not break these)

- Commands are **never rewritten** and **never truncated**.
- Records are structured at decision time, never re-parsed from the denial text
  in the session log.
- Patterns are substrings, never regex.
- The guard never throws into the dispatch path.
- `enabled: false` + `monitor` is the shipped default; blocking is opt-in.
