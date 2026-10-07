# The three interaction surfaces

dsh-plugin-jev exposes the same Jev call through three surfaces. All three run
the identical validation (`buildRequest` → `parseQuestions`) and the identical
transport, so question types, limits, and answer shapes cannot drift between
them. The difference is **who can reach each surface** and **how the usage is
accounted**.

## Comparison

| | `jev_ask` tool | `ctx.get('jev')` service | HTTP `POST /api/ask` |
| --- | --- | --- | --- |
| Who calls it | the agent's main model | a sibling DSH plugin (host-side JS) | anything with HTTP access to the harness |
| Where it runs | tool plane, per-dispatch | in-process function call | the harness web server (`http://127.0.0.1:3080`) |
| Surface | `{ state, questions, model? }` via tool arguments | `jev.ask({ state, questions, model?, signal?, source? })` | `POST /plugins/dsh-plugin-jev/api/ask` with a JSON body |
| Returns | rendered text answer + the usage meta `meta.jevUsage` on the `tool/result` event (root executions only; nested dispatches are counted from the rendered text instead) | `{ model, answers, usage, costUsd, elapsedMs, credential }` | the same envelope as JSON, plus one `host`-bucket aggregate record per call (host calls cannot produce session-log events) |
| Usage recorded | `source: 'tool'` + per-chat projection | `source: 'host'` (or `'guard'`) | `source: 'host'` |
| Aborts on turn cancel | no: the transport does not forward `exec.signal`, so a cancelled turn discards the result but the upstream call runs (and bills) to completion; only the 30s timeout aborts it | only if the caller passes a `signal` | not propagated: the upstream call completes server-side even if the client disconnects |
| Errors surfaced as | rendered failure text the model reads | thrown `Error` with `.code` | HTTP status + `{ error }` |
| Key required | yes | yes | yes |

Route paths in this doc are shorthand for the full namespace
`/plugins/dsh-plugin-jev/api/<path>`; there is no bare `/api/...` route.

## How to choose

- **You are the model** → use `jev_ask`. It is already registered; the system
  prompt documents it at section `tool:jev_ask`.
- **You are a DSH plugin and want a calibrated number inside your own decision
  code** → use the host service. One function call, no HTTP, structured answers
  you can branch on directly. See [04-host-service.md](04-host-service.md).
- **You are anything else** (a script, an external tool, another process on the
  host) → use the HTTP route. See [05-http-api.md](05-http-api.md).
- **You want to stop a shell command before it runs** → do not call Jev
  yourself for this; the plugin already owns a guard on `tools/pre-execute`.
  Configure rules via `POST /api/guard`. See
  [06-command-guard.md](06-command-guard.md).

## Rules that hold on every surface

1. **The key must be configured.** Resolution walks (reference, environment)
   pairs: the `typesafe` credential first, then env `TYPESAFE_API_KEY`, then the
   legacy `TYPESAFE_API_KEY` credential, then env again (so with no primary key
   stored, an environment key outranks a legacy-stored one). With none, you get
   `.code === 'no-key'` (HTTP 401). Set the key once in Settings →
   Plugins → Jev (TypeSafe), or `POST /api/key`.
2. **Fail open.** If your feature gates agent behavior on a Jev answer, any
   error must leave the gate open (allow, continue, retry later). A Jev outage
   must never strand an agent mid-goal or make the shell unusable. (The plugin's
   own command guard is the documented exception: rules you mark `absolute` fail
   closed when Jev is unreachable - see
   [06-command-guard.md](06-command-guard.md).)
3. **You own the thresholds.** Jev supplies probabilities; nobody in this
   plugin decides for you what "enough" means -  except the command guard,
   whose thresholds are explicit, persisted, and documented.
4. **State is everything.** No surface gives Jev workspace access. If a fact
   matters, put it in `state`.
5. **Batch questions.** Up to 64 go out in parallel per call; several related
   questions in one call are cheaper and more consistent than several calls.
