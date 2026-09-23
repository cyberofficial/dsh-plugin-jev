# Accounting: where every call is counted

Every Jev call the plugin makes is priced (`input_tokens × 4.2e-8`, output
free) and recorded. There are two ledgers with different lifetimes and
different visibility.

## Ledger 1: the per-chat projection (session log)

- Written by the **tool path only**: each completed `jev_ask` attaches its
  usage as `meta.jevUsage` on the `tool/result` session event
  (`output.presentationMeta`; root executions only).
- The `jevUsage` session projection (`lib/usage.js`, key `jevUsage`, state
  version 1) folds those events into `{ calls, inputTokens, outputTokens,
  costUsd, lastAt, byModel, guardBlocks }` and the client reads it with
  `useProjection('jevUsage')` to render the composer-dock pill:
  `Jev · N calls · M blocked · $cost`.
- `guardBlocks` counts refusals: a guard denial produces **no** usage meta (the
  command never ran), so the fold recognizes the denial by its fixed text
  prefix `[jev-guard] ` anchored at the start of the result text. Text that
  merely *quotes* a denial is not counted.
- Host and HTTP calls **cannot** appear here: a plugin cannot append a session
  event (the envelope's `ignorable` marker is unsettable through
  `Session.append`, and a custom event type breaks session reload). This gap is
  deliberate and visible, not hidden -  see the `bySource` split below.
- The pill refreshes its durable figures from `/stats` on open, on a 3-second
  poll while open, and whenever the chat's own meter moves (the only turn-end
  signal the dock slot can see).

## Ledger 2: the durable aggregate (JSON store)

- File: `~/.dsh/dsh-plugin-jev.json` (`$DSH_HOME` overrides the home), written
  atomically (temp file + rename) so a crash cannot tear it. Corrupt/missing
  file degrades to defaults at load; it never fails boot. Never contains the
  API key.
- Shape (see `JevStore.snapshot()` in `lib/store.js`):
 - `model` -  the stored model preference;
 - `guard` -  the persisted guard config (verbatim; `lib/guard.js` owns the
    schema);
 - `guardCounters` -  the guard's lifetime counters + `last` decision record,
    persisted across restarts. Updated by the guard after every pass via
    `setGuardCounters`; unchanged reports write nothing;
 - `totals` -  all calls: `{ calls, inputTokens, outputTokens, costUsd }`;
 - `byModel` -  the same split per resolved model;
 - `bySource` -  the same split per origin: `tool` | `host` | `guard`;
 - `sessions` -  per-session usage (≤ 200 most recent, pruned by `lastAt`);
 - `lastCall` -  the most recent single call with `source` and `at`;
 - `updatedAt`.

### The `bySource` split

| Source | Counts | Visible in |
| --- | --- | --- |
| `tool` | model `jev_ask` calls | per-chat pill + aggregate |
| `host` | sibling-plugin service calls **and** HTTP `POST /api/ask` | aggregate only |
| `guard` | commands the guard scored (allowed and blocked alike -  both cost a call) | aggregate only; `guardCounters` details them |

Commands refused by a literal rule or the oversize rail cost nothing and appear
nowhere in `bySource` -  they never reached Jev. The pill's "scored" figure
reads `bySource.guard.calls`: every command the guard sent to Jev, all-time,
across chats and restarts.

## What survives a restart

| Data | Durable? | Where |
| --- | --- | --- |
| Aggregate totals, byModel, bySource | yes | store file |
| Guard config | yes | store file (`setGuard`) |
| Guard lifetime counters + last decision | yes | store file (`setGuardCounters`) |
| Guard block log (`denials`) | **no** -  deliberate | memory only (≤ 100) |
| Per-chat projection (calls, guardBlocks) | lives in the session log | session file |
| Model catalog cache | no | memory (5 min TTL) |

## Do not break these

- `record()` must carry `guard` and `guardCounters` through the state rebuild - 
  omitting either silently erases it on the next recorded call (this bug has
  happened once each and is test-pinned).
- The fold must carry `guardBlocks` through usage-path folds (test-pinned).
- Denials are structured at decision time; nobody re-parses the `[jev-guard]`
  text to reconstruct facts (the prefix is only a counter signal).
- The store never holds the API key.
