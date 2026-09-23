# dsh-plugin-jev -  Documentation index

Documentation for **dsh-plugin-jev**, a DeepSeek Harness (DSH) plugin that wires
**TypeSafe Jev (System One)** into the harness as a calibrated judgment service.

The audience is primarily **AI models and agents** that live in the same harness
or integrate with it: everything here states exact shapes, exact constants, and
exact error semantics so another model never has to guess. Human maintainers can
read the same files; `08-codebase-map.md` is written for them.

## Read in this order

| File | What it covers |
| --- | --- |
| [01-what-jev-is.md](01-what-jev-is.md) | The upstream Jev API: what it can and cannot do, question types, answer envelope, pricing, hard limits. |
| [02-interaction-surfaces.md](02-interaction-surfaces.md) | The three ways to call Jev through this plugin (`jev_ask` tool, `ctx.get('jev')` service, HTTP routes) and how to choose. |
| [03-jev-ask-tool.md](03-jev-ask-tool.md) | The agent-facing `jev_ask` tool: parameters, answer rendering, prompt guidance, usage projection. |
| [04-host-service.md](04-host-service.md) | The injectable host service for sibling plugins: `ask()` contract, typed errors, fail-open guidance. |
| [05-http-api.md](05-http-api.md) | Every HTTP route: request/response JSON, status codes, curl examples. |
| [06-command-guard.md](06-command-guard.md) | The tool-command guard: layers, config schema, rules, modes, failure modes, counters. |
| [07-accounting.md](07-accounting.md) | Where every call is recorded: per-chat projection, durable aggregate, `bySource` split, what survives a restart. |
| [08-codebase-map.md](08-codebase-map.md) | Module-by-module map, invariants, test layout, and known pitfalls. |

## The one-paragraph version

Jev is a decision model, not a chat model: you send `{ state, questions }` and
get back `{ answers, usage, model }` where each answer carries calibrated
probabilities. This plugin exposes that in three ways -  a `jev_ask` tool the
agent's model calls, an injectable `jev` service sibling plugins call
in-process, and HTTP routes under `/plugins/dsh-plugin-jev/api/*` anything with
network access can call. It adds a command guard that scores shell commands
before they dispatch and can refuse them, and it records every call's usage in
a small JSON store that survives harness restarts.

## Non-negotiable facts (verified against the code, 2.0.0)

- Jev answers **typed questions only**. It does not generate prose, cannot
  enumerate anything, has no memory between calls, and cannot read your
  filesystem. Everything it knows arrives in the `state` you send.
- Pricing: **$42 per billion input tokens** (`DEFAULT_COST_PER_TOKEN = 4.2e-8`).
  Output tokens are free. A typical call costs `$0.00002`-`$0.00008`.
- Limits: **64 questions** per call, serialized request **≤ 400,000 chars**,
  service-level state budget **≤ 200,000 chars** (the API allows ~32k tokens of
  state plus the longest question).
- No TypeSafe key configured → error with `.code === 'no-key'` (HTTP: 401).
  Malformed caller input → `ServiceInputError` with `.code === 'bad-input'`
  (HTTP: 400). Upstream failure → HTTP 502. Never retry a 429 faster than its
  `retry-after` says.
- Consumers that gate agent behavior **must fail open** on any error here. This
  plugin supplies numbers; your code owns the decision.
