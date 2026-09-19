# dsh-plugin-jev

Agent-facing **TypeSafe Jev** (System One) for the DSH Web GUI. The model itself
calls Jev through a `jev_ask` tool whenever a decision needs calibrated
judgment; a **Settings -> Plugins -> Jev (TypeSafe)** tab owns the API key.

Jev is not a chat model. You send a *state* plus typed questions and get back
structured answers with calibrated probabilities, evaluated in parallel in one
call. This plugin makes that decision surface a tool the assistant reaches for on
its own — there is **no human query console** under the composer.

## What it adds

- **Host half** (`lib/index.js` + `lib/tool.js`):
  - the `jev_ask` tool registered on the DSH tool plane, callable by the main
    agent and every subagent that inherits its surface, and
  - a system-prompt guidance section (`tool:jev_ask`) that tells the model to
    use Jev for judgment under uncertainty instead of guessing.
- **Host routes** under `/plugins/dsh-plugin-jev/api/...`: validate the request,
  call `api.typesafe.ai/v1` with the stored credential, normalize the answer
  envelope, and fold a session log into text for use as state. The API key never
  reaches the browser.
- **Client half** (`lib/client.js`, built from `src/client.template.js`): a
  `Jev (TypeSafe)` tab in `settings.plugins.tab` that owns the key and shows
  catalog status. That is the only browser contribution.

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
- `model` — optional alias (default `jev-latest`).

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

Disable the agent surface (routes only) with plugin config `toolEnabled: false`;
rename the tool with `toolName: "jev"`.

## Host routes

All under `/plugins/dsh-plugin-jev/api`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/ask` | POST | Validate `{ state, questions, model }` and call `/v1/systemone` |
| `/models` | GET | `GET /v1/models` (cached ~5 min; `?refresh=1` bypasses) |
| `/status` | GET | Whether the `typesafe` credential is configured (never its value) |
| `/key` | POST / DELETE | Store / remove the `typesafe` credential |
| `/transcript` | GET | Fold session `?session=` into a bounded text state |

The ask route retries once on `429` when the server names a `retry-after` within
the cap.

## Development layout

- `lib/index.js` — the host half (Cordis plugin; routes, credential, folds)
- `lib/tool.js` — the agent tool, guidance text, and model-facing formatters
- `src/client.template.js` — the browser half source
- `lib/client.js` — generated browser bundle (`npm run build`)
- `scripts/build-client.mjs` — copies the template to the served path
  (`npm run check:build` verifies it is current)
- `test/` — `host.test.mjs` (pure helpers), `tool.test.mjs` (the agent tool),
  `key.test.mjs` (routes with a canned fetch), `client.test.mjs` (drives the
  real bundle factory)

Run the checks with `npm test`; `npm run check` does a `npm pack --dry-run`.

## Behavior and limits

- Requests are bounded to 64 questions and ~400k serialized characters, well
  under Jev's 64k-token context budget.
- The transcript is bounded to the most recent ~80 messages and ~40k characters,
  preserving the head and tail when it must drop text.
- The cost figure is an **estimate**: it prices input tokens at the published
  Jev 1.13 rate ($42 per billion tokens) and treats output tokens as free. Pin a
  model id instead of an alias if you tune thresholds against a version.
- Every call bills input tokens, so guidance is scoped to genuine judgment rather
  than routine work.
- English is Jev's strongest language; test other languages on your own content.
- Confidence is derived from the probability distribution. Use it as a second
  axis: the answer says what, confidence says whether to act.
