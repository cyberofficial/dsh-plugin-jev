# dsh-plugin-jev

TypeSafe **Jev** (System One) in the DSH Web GUI: ask typed `choice` / `score` /
`noul` questions from a composer-dock console, and manage the TypeSafe API key
from **Settings -> Plugins -> Jev (TypeSafe)**.

Jev is not a chat model. You send a *state* plus typed questions and get back
structured answers with calibrated probabilities, evaluated in parallel in one
call. This plugin puts that decision surface one click from the composer.

## What it adds

- **Host half** (`lib/index.js`): the plugin's own routes under
  `/plugins/dsh-plugin-jev/api/...`. It validates the request, calls
  `api.typesafe.ai/v1` with the stored credential, normalizes the answer
  envelope, and folds a session log into text for use as state. The API key
  never reaches the browser.
- **Client half** (`lib/client.js`, built from `src/client.template.js`):
  - a `Jev` pill in `conversation.composer.dock` that opens the question
    console, and
  - a `Jev (TypeSafe)` tab in `settings.plugins.tab` that owns the key and
    shows catalog status.

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
Plugins -> Jev (TypeSafe)** (password field + Save, then Remove when needed), or
from the set-key field inside the console. Both write the same record through the
host's own key route; the literal never rides a response.

Resolution order, newest first:

| Priority | Reference | Source |
| --- | --- | --- |
| 1 | `typesafe` | credential store (Settings or the console) |
| 2 | `TYPESAFE_API_KEY` | credential store, then launch environment |

Get a key from `console.typesafe.ai/keys`.

## The console

Open the `Jev` pill under the chat input. Inside:

- **State** — use the current chat transcript (the host folds it from the
  session log) or paste a custom state. Editing the transcript flips to Custom.
  Presets fill a representative state and question set.
- **Questions** — add `noul` (yes/no probability), `choice` (one option from a
  set), and `score` (ordered levels) questions. Each carries `instructions`;
  choice options and score levels are defined inline. Every question is
  evaluated against the same state in parallel.
- **Answers** — the chosen option with the full probability distribution, the
  probability-weighted score with its legend, or the yes/no probability, each
  with a **confidence**; plus model, token usage, latency, and an estimated
  input cost.

The last request is kept in `localStorage` so the console reopens where you left
it. The default model is `jev-latest`.

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

- `lib/index.js` — the host half (Cordis plugin; routes and folds)
- `src/client.template.js` — the browser half source
- `lib/client.js` — generated browser bundle (`npm run build`)
- `scripts/build-client.mjs` — copies the template to the served path
  (`npm run check:build` verifies it is current)
- `test/` — `host.test.mjs` (pure helpers), `key.test.mjs` (routes with a canned
  fetch), `client.test.mjs` (drives the real bundle factory)

Run the checks with `npm test`; `npm run check` does a `npm pack --dry-run`.

## Behavior and limits

- Requests are bounded to 64 questions and ~400k serialized characters, well
  under Jev's 64k-token context budget.
- The transcript is bounded to the most recent ~80 messages and ~40k characters,
  preserving the head and tail when it must drop text.
- The cost figure is an **estimate**: it prices input tokens at the published
  Jev 1.13 rate ($42 per billion tokens) and treats output tokens as free. Pin a
  model id instead of an alias if you tune thresholds against a version.
- English is Jev's strongest language; test other languages on your own content.
- Confidence is derived from the probability distribution. Use it as a second
  axis: the answer says what, confidence says whether to act.
