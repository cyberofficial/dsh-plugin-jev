# The host service (`ctx.get('jev')`)

For sibling DSH plugins that want calibrated judgment inside their own code.
The service is provided at mount by dsh-plugin-jev under the name **`jev`**
(`JEV_SERVICE_NAME`, `lib/service.js`).

## Quick start

```js
// your plugin's entry module
import { createUserMessage } from '@deepseek-ai/dsh-llm'

// Do NOT add `export const inject = ['jev']`: a hard inject holds your plugin
// PENDING until the service exists, so this listener would never register when
// Jev is absent. Reading opportunistically keeps your plugin running either way.
export function apply(ctx) {
  ctx.effect(() => ctx.on('agent/turn-stopping', async ({ agent }) => {
    const jev = ctx.get('jev')
    if (jev === undefined) return // Jev not mounted; fail open
    try {
      const { answers } = await jev.ask({
        state: describeRecentSteps(),
        questions: {
          complete: { type: 'noul', instructions: 'Is the stated objective fully met?' },
          drifting: { type: 'noul', instructions: 'Has the work drifted from the objective?' },
        },
      })
      // A listener's return value is IGNORED - only agent.steer(...) continues
      // the turn. Guard the steer with your own stopping condition: an
      // unconditional steer force-continues the turn forever.
      if (answers.complete.noul < 0.5) {
        agent.steer(createUserMessage({
          content: [{ type: 'text', text: 'Objective not met (Jev says p=' + answers.complete.noul.toFixed(2) + '); continue.' }],
          source: { kind: 'plugin:your-plugin' },
        }))
      }
    } catch {
      // fail open: a Jev outage must never strand or end a goal
    }
  }), 'your-plugin: jev check')
}
```

## The `ask()` contract

```ts
jev.ask(input: {
  state: string | object | array,   // required, non-empty, <= 200,000 chars serialized
  questions: { [id]: Question },    // required, 1..64 entries (noul | choice | score)
  model?: string,                   // default: the preference captured at mount, else 'jev-latest' (Settings changes apply after restart; the tool and /ask route re-read live)
  signal?: AbortSignal,             // abort the upstream call (e.g. the user cancelled)
  source?: 'host' | 'guard',        // accounting label; default 'host'
}) : Promise<{
  model: string,                    // resolved model that answered
  answers: { [id]: Answer },        // typed answers keyed by YOUR question ids
  usage: { input_tokens, output_tokens },
  costUsd: number,                  // input tokens × 4.2e-8; output free
  elapsedMs: number,
  credential: { configured: true, ref: string, source: string }, // never the key value
}>
```

Question shapes are exactly the three documented in
[01-what-jev-is.md](01-what-jev-is.md) and validated before any network or
credential work.

## Error taxonomy

| Error | `.code` | Meaning | What you should do |
| --- | --- | --- | --- |
| `ServiceInputError` | `'bad-input'` | Caller-shape mistakes at the service seam: a non-options argument, missing/null `state` or `questions`, a non-object `questions`, an over-budget or blank-string state, more than 64 questions, a non-string `model`. Thrown **before** any network work. | Fix your call; do not retry. |
| `Error` | `'no-key'` | No TypeSafe credential is configured. | Surface a "set the key" hint once; fail open meanwhile. |
| `Error` (HTTP 429) | -  | Rate limited upstream. | Honor `retry-after` once, then fail open. |
| `Error` (other HTTP / network) | -  | Deeper value problems that pass the seam (malformed question values, an empty questions map, empty object/array state, invalid JSON, requests over 400k chars) **or** an upstream/transport failure. Both are deliberately untagged. | Fail open; fix your input if it was a value problem. |

The plugin HTTP route maps `bad-input` to 400, `no-key` to 401, an upstream 429
to 429, and everything else -  including the untagged value problems -  to 502,
so a 502 can mean either your input or the upstream; see
[05-http-api.md](05-http-api.md).

## Accounting

Each successful call is recorded in the durable aggregate under
`bySource.host` (or `bySource.guard` if you pass `source: 'guard'`) and
persists across restarts. It does **not** appear in the per-chat pill: that
reads the session log, and a host call leaves no session event. See
[07-accounting.md](07-accounting.md).

Accounting failures never fail your decision -  a broken store write is logged
and swallowed.

## Rules for consumers

1. **Fail open.** If the call gates agent behavior, catch everything and leave
   the gate open on failure. The command guard is the deliberate exception
   pattern: *its* fail modes are explicit (rules fail closed when marked
   `absolute`, everything else fails open) -  do not copy "fail closed" without
   a reason as strong as its.
2. **You own thresholds and policy.** This service supplies calibrated
   numbers. It has no opinion on what your probability means.
3. **Pass a `signal` when the caller can cancel.** The command guard passes the
   dispatch's `exec.signal` so an aborted turn does not leave a request running.
4. **Do not log `credential`.** The envelope carries metadata only; keep it
   that way.
5. **Batch.** Up to 64 questions in one call. Parallel-in-isolation semantics:
   answers never see each other.

## Composing your own policy

The command guard is the reference implementation of "service as a component":
when `scoreDanger` is on and rules pass their prefilters, it fuses one `score`
question (severity over 5 bands) + one `noul` (irreversibility) + one `noul` per
in-scope blocked-command rule intent into a **single** call, applies a
deterministic decision table, and records structured evidence. (With
`scoreDanger` off only the intent nouls ride the call, and prefiltred-out rules
are never asked.) Read `lib/guard.js` and [06-command-guard.md](06-command-guard.md)
before building something similar.
