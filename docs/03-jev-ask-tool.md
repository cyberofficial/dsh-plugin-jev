# The `jev_ask` tool (agent-facing)

The agent's model calls a tool named **`jev_ask`**. This document is written so
an AI model can use it correctly without reading the source.

## Registration facts

| Fact | Value |
| --- | --- |
| Tool name | `jev_ask` (`JEV_TOOL_NAME`) |
| Prompt section | `tool:jev_ask` (registered at order 2650; removable by name by a deployment) |
| Parameters schema | `state` (required), `questions` (required), `model` (optional string) |
| Output schema | `{ model, answers, usage: { input_tokens, output_tokens }, costUsd, elapsedMs }` |

## When to call it

Call `jev_ask` for the majority of substantive questions -  anything involving
judgment, preference, ranking, prediction, classification, prioritization, risk,
urgency, likelihood, sentiment, or a choice among options. This explicitly
includes soft phrasings: "what do you think", "which should I", "is this a good
idea", "how risky is this", "who is right", "what is likely to happen". Treat an
implied decision inside a task as a reason to call it, not just explicit
questions.

**Do not call it for:**

- anything you can verify by executing (reading a file, running a test,
  fetching a URL) -  do that instead;
- content you are authoring (drafts, code you are writing);
- deterministic computation (arithmetic, date math) -  you are a better
  calculator than a judgment model.

## How to build the call

### `state` (required)

The situation to judge. Jev cannot read the workspace -  include every relevant
fact: a transcript, the relevant file excerpts, numbers, dates, prior outcomes.
A transcript string works; a structured object or array of facts works and is
often clearer. Non-empty is enforced.

### `questions` (required)

A JSON object keyed by stable question ids. Each value is exactly one of:

```json
{ "type": "noul", "instructions": "Is the customer requesting a refund?",
  "criteria": { "true": "A refund is being requested", "false": "No refund is being requested" } }
```

```json
{ "type": "choice", "instructions": "Which channel should we contact the customer?",
  "criteria": { "email": "Email", "phone": "Phone", "sms": "SMS" } }
```

```json
{ "type": "score", "instructions": "How urgent is the customer?",
  "criteria": ["low", "medium", "high", "urgent"] }
```

Type constraints are strict (see `01-what-jev-is.md`): a `score` needs at least
two ordered levels; a `choice` needs every option described or explicitly
`null`; ids are echoed back in answers, so avoid ids that are not valid
property names and avoid characters like `-` in ids (they parse as subtraction
if anything downstream does arithmetic on them).

**Fan out.** Ask multiple related questions in one call -  rank options and
estimate likelihoods together -  rather than making several calls. Up to 64
questions ride one call, in parallel, each judged in isolation.

**Decompose.** If a decision needs extended reasoning, ask several smaller
questions and compose them yourself in your own reply. `jev_ask` gives you
numbers, not a way to offload your thinking.

## What comes back

The tool result is rendered text (`renderJevResult`), one line per question,
plus a cost trailer:

- `my_id [noul] -> TRUE (p=0.930)`
- `my_id [choice] -> phone (p=0.870; confidence 0.910)` followed by an indented
  `probabilities: phone 0.870, email 0.100, sms 0.030` line
- `my_id [score] -> 2.03 (confidence 0.730)` followed by indented `legend:`
  (`0="low", 1="medium", ...`) and `probabilities:` (`0 0.100, 1 0.200, ...`)
  lines

`noul` lines also state the threshold verdict (`TRUE` at ≥ 0.5). A malformed or
missing answer renders as `my_id: <json>` rather than vanishing, and the
trailer line is `- 414 input / 44 output tokens, $0.000017, 440ms`.

The full envelope is also attached as `meta.jevUsage` on the `tool/result`
session event, which is how the per-chat usage pill counts calls (see
[07-accounting.md](07-accounting.md)).

## How to act on the answers

1. **Probabilities are evidence, not verdicts.** State the probability you
   relied on when you explain a decision ("Jev scored this noul 0.85, so I
   proceeded").
2. **Use `confidence` as a second axis.** Below roughly 0.7 confidence, do not
   act on the point answer: ask the user for clarification, flag for human
   review, or fall back to normal reasoning.
3. **Respect failure modes.** If the result reports a missing key, tell the
   user to set it once in Settings → Plugins → Jev (TypeSafe), and continue
   without Jev for now. If the upstream fails, retry is reasonable once; a
   second failure means continue without it.
4. **Never fake a number.** If you did not call the tool, do not invent a
   probability and attribute it to Jev.

## Cost discipline

Every call is real spend (though tiny). A single question typically costs
$0.00001-$0.00004. Batching into one call is cheaper than many calls. Do not
call `jev_ask` inside tight loops; ask once with all the questions you need.
