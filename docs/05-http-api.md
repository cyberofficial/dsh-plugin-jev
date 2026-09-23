# HTTP API

Base: `http://127.0.0.1:3080` (the harness web server). Every route below is
namespaced under **`/plugins/dsh-plugin-jev/api`** and returns JSON with
`Cache-Control: no-store`. Unless stated otherwise, all methods are GET and
POST bodies must be JSON objects.

All routes work without authentication from localhost (the harness's own
surface). The TypeSafe key itself is never returned by any route.

## POST /ask -  evaluate a state

The same Jev call the tool and service make, over HTTP. Goes through the host
service, so the call is accounted under `bySource.host`.

**Request:**

```json
{
  "state": "Deploy failed twice today; the rollback succeeded",
  "questions": {
    "urgent": { "type": "noul", "instructions": "Is this urgent?",
                "criteria": { "true": "act now", "false": "can wait" } }
  },
  "model": "jev-latest"
}
```

`state` and `questions` required (same validation as everywhere); `model`
optional -  defaults to the stored preference, else `jev-latest`.

**Response 200:**

```json
{
  "model": "jev-1.13.0",
  "answers": { "urgent": { "type": "noul", "noul": 0.85 } },
  "usage": { "input_tokens": 414, "output_tokens": 44 },
  "costUsd": 0.000017388,
  "elapsedMs": 440,
  "credential": { "configured": true, "ref": "typesafe", "source": "file" }
}
```

**Status codes:**

| Status | Meaning |
| --- | --- |
| 200 | answered |
| 400 | your body is malformed (`error.code === 'bad-input'` upstream: missing state/questions, over budget) or not valid JSON |
| 401 | no TypeSafe key configured |
| 429 | rate limited upstream (retries once honoring `retry-after` internally first) |
| 502 | anything else (malformed question values, upstream error, timeout) |

**curl:**

```sh
curl -s -X POST http://127.0.0.1:3080/plugins/dsh-plugin-jev/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"state":"two deploys failed","questions":{"urgent":{"type":"noul","instructions":"Is this urgent?","criteria":{"true":"act now","false":"can wait"}}}}'
```

## GET /models -  list usable models

`GET /models[?refresh=1]` → 200:

```json
{ "models": [{ "name": "jev-latest", "description": "flagship", "releaseDate": "2026-09-01" }],
  "cached": false, "fetchedAt": "2026-09-23T01:00:00.000Z" }
```

The catalog is cached for 5 minutes; `?refresh=1` forces a re-read. 502 when
the upstream fails. `name` values are what you may pass as `model`.

## GET /status -  key configuration state

→ 200: `{ configured, source?, ref?, writable, primaryRef: "typesafe",
refs: ["typesafe", "TYPESAFE_API_KEY"] }`. Never contains the key value.
`writable` says whether the **primary `typesafe` credential record** can be
written through the harness's credential service (false when there is no
credential provider, or the provider reports that record read-only -  e.g. an
environment-sourced composition). It does not describe where the currently
resolved key came from; `source` does that.

## POST /key and DELETE /key -  manage the stored key

- `POST /key` with `{ "value": "sk-..." }` → 200 `{ ok: true, ref: "typesafe" }`.
  Empty/missing value → 400. Credential provider missing → 501. Write failure →
  409.
- `DELETE /key` → 200 `{ ok: true, ref: "typesafe" }`.

## GET /transcript -  fold a session log into text

`GET /transcript?session=<id>&maxChars=<n>` → 200:

```json
{ "available": true, "sessionId": "s1", "text": "USER: ...\nASSISTANT: ...\nTOOL CALL ...\nTOOL RESULT: ...",
  "messages": 8, "chars": 5100, "omitted": 0 }
```

`maxChars` clamps to 2,000-200,000 (default 40,000). The fold keeps the most
recent messages (≤ 80), labels injected context as `CONTEXT:` so a decision
model does not mistake it for the human's prompt, and renders tool calls and
results. Degraded forms: `{ available: false, reason: "no-session" |
"no-session-store" | "unknown-session" | "lookup-failed" }`. This route exists
so an external caller can build a `state` for `POST /ask` from a live chat.

## GET/POST /settings -  the model preference

- `GET` → 200 `{ model, storedModel, defaultModel: "jev-latest", updatedAt }`.
  `model` is what all surfaces fall back to.
- `POST` with `{ "model": "jev-preview" }` → 200 same shape. Empty → 400.

## GET /stats -  the usage aggregate

→ 200. Shape (all keys present):

```json
{
  "model": null,
  "guard": { "enabled": true, "mode": "enforce", "...": "the whole guard config, verbatim" },
  "guardCounters": { "evaluated": 9, "blockedLiteral": 1, "blockedSemantic": 0,
                     "blockedDanger": 3, "blockedOversize": 0, "downgraded": 0,
                     "failures": 0, "cached": 2, "skipped": 1,
                     "last": { "at": "...", "tool": "pwsh", "command": "...",
                               "action": "block", "reason": "...", "rule": null,
                               "severity": "critical", "confidence": 0.97,
                               "trigger": "danger", "downgraded": false,
                               "costUsd": 0.000032, "model": "jev-1.13.0" } },
  "totals":   { "calls": 159, "inputTokens": 96400, "outputTokens": 9300, "costUsd": 0.004 },
  "byModel":  { "jev-1.13.0": { "calls": 100, "inputTokens": 60000, "outputTokens": 5000, "costUsd": 0.0025 } },
  "bySource": { "tool": { "calls": 50, "inputTokens": 30000, "outputTokens": 4000, "costUsd": 0.0012 },
                "host": { "calls": 2,  "inputTokens": 1200,  "outputTokens": 90,  "costUsd": 0.00005 },
                "guard": { "calls": 105, "inputTokens": 65000, "outputTokens": 5200, "costUsd": 0.0027 } },
  "lastCall": { "calls": 1, "inputTokens": 414, "outputTokens": 44, "costUsd": 0.000017388,
                "model": "jev-1.13.0", "sessionId": "s1", "at": "...", "source": "tool" },
  "sessionsTracked": 12,
  "updatedAt": "...",
  "defaultModel": "jev-latest",
  "costPerToken": 4.2e-8,
  "projectionKey": "jevUsage",
  "guard": { "evaluated": 9, "blockedLiteral": 1, "cachedEntries": 4, "...": "live counters incl. run-local cache size" }
}
```

Notes:

- `totals` / `bySource` / `guardCounters` / `byModel` are **durable** -  they
  survive a harness restart (persisted in `~/.dsh/dsh-plugin-jev.json`).
- The top-level `guard` key is the stored guard **config**; the bottom `guard`
  key (added by the route) is the guard's **live counters**. `cachedEntries`
  there is run-local.
- `bySource.tool.calls` counts model `jev_ask` calls; `host` counts plugin and
  HTTP asks; `guard` counts scored commands.

## GET/POST /guard -  the command guard

- `GET` → 200 `{ config, stats, denials, defaults }`:
 - `config` -  the normalized guard config (see
    [06-command-guard.md](06-command-guard.md));
 - `stats` -  live counters `{ evaluated, blockedLiteral, blockedSemantic,
    blockedDanger, blockedOversize, downgraded, failures, cached, skipped,
    last, cachedEntries }` (all-time numbers seeded from the store, except
    `cachedEntries` which is run-local);
 - `denials` -  the in-memory block log, newest first (≤ 100): entries
    `{ at, tool, command (FULL, never truncated), reason, detail, rule, intent,
    trigger, severity, confidence, costUsd, model, wouldBlock }`;
 - `defaults` -  `{ blockThreshold, confidenceFloor, tools, severityBands }`.
- `POST` -  a **partial** config patch; only keys present are replaced.
  `commandBlocks` is merged by rule id (entries with an `id` update in place,
  entries without get `rule-N` ids; a non-array leaves rules untouched).
  Unknown/invalid keys are normalized away by `normalizeGuardConfig`. Returns
  the same payload as GET. Malformed body → 400.

```sh
curl -s http://127.0.0.1:3080/plugins/dsh-plugin-jev/api/guard
curl -s -X POST http://127.0.0.1:3080/plugins/dsh-plugin-jev/api/guard \
  -H 'Content-Type: application/json' \
  -d '{"mode":"enforce"}'
```

## Error body convention

Every non-200 response is `{ "error": "<message>" }`. The message is the
underlying error verbatim -  a `bad-input` message names the caller's mistake
(e.g. `jev.ask: state is required…`), a `no-key` message tells the user where
to set the key.
