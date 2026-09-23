# What Jev is (and is not)

TypeSafe Jev ("System One") is a hosted decision model at
`https://api.typesafe.ai/v1`. This document describes its contract as this
plugin uses it. The plugin talks to exactly two endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/systemone` | Evaluate one state against typed questions. |
| `GET /v1/models` | List the model aliases/ids the account can send. |

Authentication: `Authorization: Bearer <key>`. The key is resolved from the
credential ref `typesafe` (legacy fallback `TYPESAFE_API_KEY`), then the
launch-environment variable `TYPESAFE_API_KEY`.

## The request

```json
{
  "state": "<string, or an object/array of facts>",
  "model": "jev-latest",
  "questions": {
    "<question-id>": { "type": "noul",   "instructions": "...", "criteria": { "true": "...", "false": "..." } },
    "<question-id>": { "type": "choice", "instructions": "...", "criteria": { "optionA": "meaning", "optionB": "meaning" } },
    "<question-id>": { "type": "score",  "instructions": "...", "criteria": ["lowest", "...", "highest"] }
  }
}
```

- `state` -  what Jev is judging. A string, or a non-empty JSON object/array.
  **Jev cannot read your workspace.** Whatever context the judgment needs must
  be inside this value: transcripts, file contents, numbers, dates, prior
  outcomes. It is stateless between calls.
- `model` -  optional alias (`jev-latest` by default). The `/models` route
  lists what is valid; anything else is the caller's risk.
- `questions` -  1 to 64 entries, keyed by a **stable question id**. Ids are
  echoed back verbatim in `answers`, so use ids you can switch on.

### The three question types

| Type | Shape | Answer returned |
| --- | --- | --- |
| `noul` | `criteria` is OPTIONAL; when present it is `{ true?: "...", false?: "..." }` (either side may be omitted; values must be strings) | `{ type: "noul", noul: <0..1> }` -  the calibrated probability that the answer is TRUE. |
| `choice` | `criteria` is REQUIRED: an object mapping **every option name** to a description string or `null`; at least one option | `{ type: "choice", choice: "<option>", confidence: <0..1>, probabilities: { <option>: p } }` -  exactly one option wins. |
| `score` | `criteria` is REQUIRED: an ordered array of **at least two** non-empty strings (lowest → highest) | `{ type: "score", score: <index as float>, confidence: <0..1>, legend: { "0": band0, ... }, probabilities: { "0": p, ... } }` |

Validation rules enforced by the plugin before anything leaves the host
(`parseQuestions` / `buildRequest` in `lib/index.js`):

- unknown fields on a question are **dropped**, not passed through;
- `instructions` must be a non-empty string (or an array of strings);
- question ids must be unique after trimming; a duplicate id is refused;
- `noul` criteria are optional (an object of optional `true`/`false` string
  descriptions); `choice` requires ≥ 1 option, no empty option names, values
  string-or-null; `score` requires ≥ 2 non-empty level strings;
- ≤ 64 questions per call; the whole serialized request ≤ 400,000 chars;
- an empty state (empty string, empty object, empty array) is rejected.

## The response envelope

```json
{
  "model": "jev-1.13.0",
  "answers": { "<question-id>": { "type": "noul", "noul": 0.85 }, "...": {} },
  "usage": { "input_tokens": 414, "output_tokens": 44 }
}
```

The plugin normalizes this and adds:

- `costUsd` -  `input_tokens × 4.2e-8` (output tokens are free);
- `elapsedMs` -  round-trip time;
- `credential` -  `{ configured, ref, source }`; **never the key value**.

## Pricing (verified 2026, Jev 1.13)

| Item | Value |
| --- | --- |
| Input | **$42 per billion tokens** = `4.2e-8` USD per token = `$0.042` per million tokens |
| Output | **free** |
| Typical single-question call | 300-800 input tokens → **$0.00001-$0.00004** |
| 20-question fan-out | ~2k-10k input tokens → **$0.0001-$0.0004** |

Calls are billed per request; batching many questions into one call is the
cheapest way to get a lot of judgment.

## What Jev can do

Judgment, preference, ranking, prediction, classification, prioritization, risk
and urgency estimation, sentiment, choosing among options -  including "soft"
questions like "is this a good idea" or "which of these is more likely".
Sixty-four questions go out **in parallel, each in isolation**: answers do not
influence each other within a call.

## What Jev CANNOT do

- **No text generation.** It will not write code, emails, or prose.
- **No memory.** Every call must re-state its context in `state`.
- **No enumeration or search.** It cannot list files, query a database, or
  fetch a URL.
- **No filesystem access.** It judges only what you put in `state`.
- **No policy.** It returns probabilities; the caller applies thresholds.

Send it work you could verify by executing something (run a test, read a file)
and you have misused it. Send it a deterministic computation and you have paid
for a worse calculator.

## Reliability model

Probabilities are calibrated, not guaranteed. Treat `noul: 0.9` as strong
evidence, not certainty. When an answer carries `confidence` below your bar
(the plugin's own guidance uses 0.7), act as if the judgment were unavailable:
ask the user, take a slower path, or fail open.
