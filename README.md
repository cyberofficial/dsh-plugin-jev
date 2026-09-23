# dsh-plugin-jev

Agent-facing **TypeSafe Jev** (System One) for the DSH Web GUI. The model itself
calls Jev through a `jev_ask` tool whenever a decision needs calibrated
judgment; the browser adds a per-chat usage chip and a
**Settings -> Plugins -> Jev (TypeSafe)** tab for the API key, the default model,
and overall stats.

Jev is not a chat model. You send a *state* plus typed questions and get back
structured answers with calibrated probabilities, evaluated in parallel in one
call. This plugin makes that decision surface a tool the assistant reaches for on
its own — there is **no human query console**.

## What it adds

- **Host half** (`lib/index.js` + `lib/tool.js`):
  - the `jev_ask` tool registered on the DSH tool plane, callable by the main
    agent and every subagent that inherits its surface;
  - a system-prompt guidance section (`tool:jev_ask`) that tells the model to
    use Jev for judgment under uncertainty instead of guessing.
- **Host service** (`lib/service.js`): the same validated call exposed to
  sibling plugins as `ctx.get('jev')`, so a plugin can get a calibrated
  judgment without spending a main-model round trip. See
  [Host service](#host-service).
- **Usage accounting** (`lib/usage.js` + `lib/store.js`):
  - every successful call records its usage on the `tool/result` event — via `meta` for root calls, and readable from the result's rendered text for nested ones (no custom session event, which the harness's log reader would refuse),
    folded by the `jevUsage` session projection and shipped to the browser; and
  - the same call updates a small JSON aggregate under the DSH home for the
    Settings totals, split by whether the model (`tool`) or a plugin (`host`)
    made the call.
- **Host routes** under `/plugins/dsh-plugin-jev/api/...`: validate the request,
  call `api.typesafe.ai/v1` with the stored credential, normalize the answer
  envelope, and fold a session log into text for use as state. The API key never
  reaches the browser.
- **Client half** (`lib/client.js`, built from `src/client.template.js`):
  - an always-visible read-only **per-chat stats chip** in
    `conversation.composer.dock` showing how many times Jev ran in this chat and
    what it cost, and
  - a `Jev (TypeSafe)` tab in `settings.plugins.tab` with the key, the default
    model, overall usage totals, and the catalog the key can see.

## Host service

`jev_ask` is reachable only by the model, so any other plugin wanting a judgment
had to spend a main-model round trip asking for prose and parsing it back. The
host service removes that step:

```js
export const inject = ['jev']

export function apply(ctx) {
  ctx.on('agent/turn-stopping', async () => {
    const jev = ctx.get('jev')
    const { answers } = await jev.ask({
      state: describeRecentSteps(),
      questions: {
        complete: { type: 'noul', instructions: 'Is the stated objective fully met?' },
        drifting: { type: 'noul', instructions: 'Has the work drifted from the objective?' },
      },
    })
    // answers.complete.noul is a calibrated probability; your code owns the threshold.
  })
}
```

`ask({ state, questions, model? })` returns
`{ model, answers, usage, costUsd, elapsedMs, credential }` and throws a
`TypeError`/`RangeError` on malformed input (before any network work) or an
error with `.code === 'no-key'` when no credential is configured. The same
limits the routes enforce apply: 64 questions, a bounded state.

**This module supplies calibrated numbers, not policy.** It has no opinion about
what a probability should mean for your feature. A consumer decides its own
question shapes, its own thresholds, and — if it gates agent behaviour — should
fail **open** on any error, so a broken Jev call can never strand or prematurely
end work.

### Where host calls are counted

Host calls land in the persisted aggregate and in the Settings totals under a
`host` bucket, and the Settings tab shows the split between `tool` (the model's
`jev_ask` calls) and `host` (plugin calls). They **cannot** appear in the
per-chat chip: that chip reads the `jevUsage` session projection, whose only
source is `tool/result` meta, and an out-of-tree plugin cannot append a session
event of its own — the envelope's `ignorable` marker is not settable through
`Session.append`, so a custom event type would make the log unreadable. The
split exists so that gap is visible rather than hidden in one number.

Security note: the resolved credential is attached only to the upstream
`Authorization` header. It is never part of the value the service returns, so a
caller cannot log it by accident.


## Installing

Each plugin is its own DSH bundle (it declares `dsh.bundle`), so DSH's own
plugin command wires up both the dependency and the profile layer:

```sh
# `pnpm` must be on PATH; `corepack enable pnpm` provides it.
cd dsh-plugin-jev
dsh plugin --profile web install "link:$PWD"
```

`link:` keeps the plugin symlinked, so edits in this workspace are what the
harness loads on its next start. Use `file:` instead to install a frozen copy.

A plugin contributes to the running harness only at startup: restart `dsh web`
(and reload the page) after installing, removing, or editing one.

## The API key

The key is stored as the **`typesafe`** credential. Set it in **Settings ->
Plugins -> Jev (TypeSafe)** (password field + Save, then Remove when needed). The
literal never rides a response.

Resolution order, newest first:

| Priority | Reference | Source |
| --- | --- | --- |
| 1 | `typesafe` | credential store (Settings) |
| 2 | `TYPESAFE_API_KEY` | credential store, then launch environment |

Get a key from `console.typesafe.ai/keys`. Set it once; the model then uses Jev
without any further UI.

## How the model uses it

The tool takes:

- `state` — the facts and context to judge (a transcript string, or a structured
  object/array). The model must include everything relevant because Jev cannot
  read the workspace.
- `questions` — a JSON object keyed by a stable question id; each value is:
  - `{"type":"noul","instructions":"...","criteria":{"true":"...","false":"..."}}`
  - `{"type":"choice","instructions":"...","criteria":{"optionA":"...","optionB":"..."}}`
  - `{"type":"score","instructions":"...","criteria":["lowest","...","highest"]}`
- `model` — optional alias (defaults to the model chosen in Settings).

It returns `{ model, answers, usage, costUsd, elapsedMs }`. Choice and score
answers carry the full `probabilities` distribution and a `confidence`; noul
answers carry the yes-probability. The tool renders those as compact probability
lines so the model can cite the number it acted on.

The guidance section makes Jev the **default for the majority of substantive
questions**: anything involving judgment, preference, ranking, prediction,
classification, prioritization, risk / urgency / likelihood, sentiment, or a
trade-off between options — including soft phrasings such as "what do you
think", "which should I", or "is this a good idea" — plus implied decisions
inside a task. The model is told to decompose a question into several typed
questions and ask them in one call. Only work the model can verify or execute
itself (reading code or files, running tests, fetching a URL), content it is
authoring, and deterministic computation are excluded. If no key is configured
the tool fails with a message telling the user where to set one, and the model
continues without it.

The guidance also instills the TypeSafe patterns directly:

- **Confidence as a second decision axis** — when an answer's confidence is low
  (below ~0.7), the model tells you it is unsure, asks for clarification, or
  flags for human review rather than guessing: the answer says *what*,
  confidence says *whether to act*.
- **Speculative fan-out** — ask several related questions in one call (e.g. rank
  options *and* their likelihoods together) instead of one high-effort question,
  which costs one call instead of many.
- **Decomposition** — when a judgment weighs several independent factors, break
  it into narrow per-factor questions and compose the results with your own
  reasoning. The tool returns typed values, not prose, so the model can branch,
  sort, and route on them.
- **Explicit types** — questions are always one of `noul`, `choice`, or `score`,
  each with concrete criteria, so Jev always returns calibrated probabilities.

Disable the agent surface (routes only) with plugin config `toolEnabled: false`;
rename the tool with `toolName: "jev"`.

## Model choice

The **Default model** field in Settings stores a model alias or id. `jev_ask`
uses it whenever the model does not name its own; the `/ask` route uses it too.
The field autocompletes from the catalog the key can see (`GET /v1/models`) and
falls back to the known aliases `jev-latest`, `jev-preview`, `jev-1.13.0`.

## Usage and cost

- **Per chat** — the composer-dock chip reads the `jevUsage` session projection:
  `Jev · 3 calls · $0.00006`. It is derived from that session's own log, so it
  is exact for the chat and travels with the session. It always renders; a chat
  with no calls shows `Jev · 0 calls · $0`. It counts the **model's** `jev_ask`
  calls only; a plugin calling the host service is counted below instead.
- **Overall** — the Settings tab shows total calls, input/output tokens, and
  estimated cost, a `tool`/`host` split of where those calls came from, plus a
  per-model breakdown and the last call. These come from
  `GET /stats`, backed by the aggregate at
  `$DSH_HOME/dsh-plugin-jev.json` (default `~/.dsh/dsh-plugin-jev.json`), so
  they survive restarts. The file never contains the API key.
- **What the key can see** — the TypeSafe API exposes only `POST /v1/systemone`
  and `GET /v1/models`; there is no account or billing endpoint. The "catalog"
  in Settings is therefore the full extent of what a key reveals about the
  account.
- **How cost is computed** — input tokens from the response's `usage`, priced at
  the published Jev 1.13 rate of **$42 per billion tokens** ($0.042 per million);
  output tokens are free. It is a metered estimate, not a billing statement.

## Host routes

All under `/plugins/dsh-plugin-jev/api`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/ask` | POST | Validate `{ state, questions, model }` and call `/v1/systemone` |
| `/models` | GET | `GET /v1/models` (cached ~5 min; `?refresh=1` bypasses) |
| `/status` | GET | Whether the `typesafe` credential is configured (never its value) |
| `/key` | POST / DELETE | Store / remove the `typesafe` credential |
| `/transcript` | GET | Fold session `?session=` into a bounded text state |
| `/settings` | GET / POST | Read / set the default model |
| `/stats` | GET | Overall usage aggregate + projected key + price per token |

The ask route retries once on `429` when the server names a `retry-after` within
the cap.

## Development layout

- `lib/index.js` — the host half (Cordis plugin; routes, credential, folds)
- `lib/service.js` — the host-side `ctx.get('jev')` service sibling plugins call
- `lib/tool.js` — the agent tool, guidance text, and model-facing formatters
- `lib/usage.js` — the per-session usage fold (from `tool/result` meta), the `jevUsage` projection, and
  the stats formatting
- `lib/store.js` — the persisted model choice + overall aggregate (with the
  `tool`/`host` split)
- `src/client.template.js` — the browser half source
- `lib/client.js` — generated browser bundle (`npm run build`)
- `scripts/build-client.mjs` — copies the template to the served path
  (`npm run check:build` verifies it is current)
- `test/` — `host.test.mjs` (pure helpers + the store split), `tool.test.mjs`
  (the agent tool, the projection, and usage recording), `service.test.mjs` (the
  host service), `key.test.mjs` (routes with a canned fetch),
  `client.test.mjs` (drives the real bundle factory)

Run the checks with `npm test`; `npm run check` does a `npm pack --dry-run`.

## Behavior and limits

- Requests are bounded to 64 questions and ~400k serialized characters, well
  under Jev's 64k-token context budget.
- The transcript is bounded to the most recent ~80 messages and ~40k characters,
  preserving the head and tail when it must drop text.
- The aggregate keeps the most recent 200 sessions before pruning the oldest.
- The cost figure is an **estimate** at the published rate (see above). Pin a
  model id instead of an alias if you tune thresholds against a version.
- Every call bills input tokens, so guidance is scoped to genuine judgment rather
  than routine work.
- English is Jev's strongest language; test other languages on your own content.
- Confidence is derived from the probability distribution. Use it as a second
  axis: the answer says what, confidence says whether to act.

## License

MIT — do whatever you like with it; no warranty, no liability. See the
[MIT license text](https://opensource.org/licenses/MIT).
