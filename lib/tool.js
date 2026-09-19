/**
 * Agent-facing half of dsh-plugin-jev: the JEV tool the model calls, the
 * system-prompt guidance that makes it reach for Jev, and the pure formatters
 * that render answers back to the model.
 *
 * The transport (buildRequest / askJev) is injected by lib/index.js instead of
 * being imported, so this module stays dependency-free and there is no import
 * cycle between the two halves.
 *
 * @module dsh-plugin-jev/tool
 */

/** Default name of the tool the model calls (config override: toolName). */
export const JEV_TOOL_NAME = 'jev_ask'

/**
 * Placement of the Jev guidance section among the built-in tool guidance
 * sections: after TOOL_WORKFLOW (2600) and before TOOL_RALPH (2700).
 */
export const JEV_TOOL_PROMPT_ORDER = 2650

/**
 * Section name for the Jev guidance. Uses the same 'tool:<name>' convention the
 * first-party tool plugins use, so a deployment can shadow it by name.
 */
export const JEV_TOOL_SECTION = 'tool:' + JEV_TOOL_NAME

/**
 * The model-facing description of JEV_TOOL_NAME. It carries the whole wire
 * shape because the questions map is open by question id and by type, so a
 * JSON schema cannot express it.
 */
export const JEV_TOOL_DESCRIPTION = [
  'Ask TypeSafe Jev (System One) typed questions about a situation and get back calibrated probabilities instead of a guess.',
  'Use it whenever a decision turns on judgment you cannot verify from the workspace - which of several valid options to take, how risky or urgent something is, how to classify or prioritize an item, or how a person is likely to react.',
  'Do NOT use it for work you can settle directly by reading files, running tests, or fetching a URL.',
  'Pass state: the facts and context to judge (a transcript string, or a structured object/array). Jev cannot read the workspace, so include everything relevant.',
  'Pass questions: a JSON object keyed by a stable question id; each value is exactly one of:',
  '{"type":"noul","instructions":"...","criteria":{"true":"what true means","false":"what false means"}} - a yes/no answer;',
  '{"type":"choice","instructions":"...","criteria":{"optionA":"meaning","optionB":"meaning"}} - pick exactly one option (criteria maps every option to its meaning, or null);',
  '{"type":"score","instructions":"...","criteria":["lowest","...","highest"]} - an ordered scale of at least two levels.',
  'Answers carry probabilities (and confidence for choice/score), or a noul probability, plus the resolved model and usage cost.',
  'Treat them as evidence: state the probability you relied on when you explain the decision.',
  'If the call reports a missing API key, tell the user to set it once in Settings > Plugins > Jev (TypeSafe) and continue without Jev for now.',
].join(' ')

/**
 * The system-prompt guidance that makes the model reach for Jev on its own.
 * Registered as its own section, not persona prose, so a deployment can remove
 * it by name.
 */
export const JEV_TOOL_GUIDANCE = [
  '## Jev (TypeSafe System One) - call ' + JEV_TOOL_NAME + ' before guessing',
  'The ' + JEV_TOOL_NAME + ' tool is a calibrated decision model, not a chat partner: you give it a state and typed questions, and it returns probabilities.',
  'Whenever the answer depends on judgment under uncertainty - choosing between valid approaches, rating risk, urgency, or confidence, classifying or prioritizing something, or predicting how a user will react - call ' + JEV_TOOL_NAME + ' instead of asserting your own uncalibrated guess, and use the returned probabilities as evidence in your response.',
  'Do not ask it to do work you can verify yourself (reading code, running tests, fetching a page).',
  'If it fails because no API key is configured, tell the user to set one in Settings > Plugins > Jev (TypeSafe) and proceed without it.',
].join(' ')

/**
 * Raw JSON Schema of the JEV_TOOL_NAME parameters. This is the enforced subset
 * (an out-of-tree plugin cannot import the schema compiler), with an
 * unconstrained 'state' node validated by buildRequest's normalizeState and an
 * open 'questions' map validated by parseQuestions.
 */
export const JEV_TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['state', 'questions'],
  properties: {
    state: {
      description: 'The situation to judge: a transcript string, or a structured object/array of facts. Include every relevant detail - Jev cannot read the workspace.',
    },
    questions: {
      type: 'object',
      additionalProperties: true,
      description: 'Map of question id to question object. See the tool description for the three accepted shapes (noul, choice, score). Ids are echoed back in answers.',
    },
    model: {
      type: 'string',
      description: 'Optional Jev model alias, e.g. "jev-latest". Omit to use the deployment default.',
    },
  },
}

/** Raw JSON Schema of the JEV_TOOL_NAME result, enforced against every success. */
export const JEV_TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'answers', 'usage', 'costUsd', 'elapsedMs'],
  properties: {
    model: { type: 'string', description: 'The resolved Jev model that answered.' },
    answers: { type: 'object', additionalProperties: true, description: 'Typed answers keyed by the question ids you supplied.' },
    usage: {
      type: 'object',
      additionalProperties: false,
      required: ['input_tokens', 'output_tokens'],
      properties: {
        input_tokens: { type: 'integer' },
        output_tokens: { type: 'integer' },
      },
    },
    costUsd: { type: 'number', description: 'Estimated input cost in USD (output tokens are free).' },
    elapsedMs: { type: 'integer', description: 'Round-trip time for the TypeSafe call.' },
  },
}

/** Format one probability-like value for the model-facing answer text. */
function fmtProbability(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : 'n/a'
}

/**
 * Render a normalized answers map as compact model-facing lines. Pure and
 * exported so the tool renderer and the tests share one formatter.
 * @param answers - the answers object from a normalized response.
 * @returns newline-joined lines, one per question.
 */
export function formatJevAnswers(answers) {
  const raw = answers !== null && typeof answers === 'object' ? answers : {}
  const lines = []
  for (const [id, answer] of Object.entries(raw)) {
    if (answer === null || typeof answer !== 'object') {
      lines.push(id + ': ' + JSON.stringify(answer))
      continue
    }
    const type = typeof answer.type === 'string' ? answer.type : 'answer'
    if (type === 'noul') {
      lines.push(id + ' [noul] -> ' + (answer.noul >= 0.5 ? 'TRUE' : 'FALSE') + ' (p=' + fmtProbability(answer.noul) + ')')
    } else if (type === 'choice') {
      const probabilities = answer.probabilities !== null && typeof answer.probabilities === 'object' ? answer.probabilities : {}
      const ranked = Object.entries(probabilities).map(([option, p]) => option + ' ' + fmtProbability(p)).join(', ')
      lines.push(
        id + ' [choice] -> ' + String(answer.choice) +
        ' (p=' + fmtProbability(probabilities[answer.choice]) +
        (answer.confidence != null ? '; confidence ' + fmtProbability(answer.confidence) : '') + ')' +
        (ranked === '' ? '' : '\n    probabilities: ' + ranked),
      )
    } else if (type === 'score') {
      const probabilities = answer.probabilities !== null && typeof answer.probabilities === 'object' ? answer.probabilities : {}
      const ranked = Object.entries(probabilities).map(([level, p]) => level + ' ' + fmtProbability(p)).join(', ')
      const legend = answer.legend !== null && typeof answer.legend === 'object'
        ? Object.entries(answer.legend).map(([level, label]) => level + '=' + JSON.stringify(label)).join(', ')
        : ''
      lines.push(
        id + ' [score] -> ' + String(answer.score) +
        (answer.confidence != null ? ' (confidence ' + fmtProbability(answer.confidence) + ')' : '') +
        (legend === '' ? '' : '\n    legend: ' + legend) +
        (ranked === '' ? '' : '\n    probabilities: ' + ranked),
      )
    } else {
      lines.push(id + ' [' + type + ']: ' + JSON.stringify(answer))
    }
  }
  return lines.join('\n')
}

/**
 * Render a normalized Jev result as the single text block the model reads.
 * @param result - { model, answers, usage, costUsd, elapsedMs }.
 * @returns the model-facing text.
 */
export function renderJevResult(result) {
  const usage = result && result.usage !== null && typeof result.usage === 'object' ? result.usage : {}
  const cost = Number.isFinite(result && result.costUsd) ? '$' + result.costUsd.toFixed(6) : 'unknown cost'
  const elapsed = Number.isFinite(result && result.elapsedMs) ? result.elapsedMs + 'ms' : 'unknown time'
  return [
    'Jev (' + (result && result.model ? result.model : 'unknown model') + ') answered:',
    formatJevAnswers(result && result.answers),
    '- ' + (usage.input_tokens ?? 0) + ' input / ' + (usage.output_tokens ?? 0) + ' output tokens, ' + cost + ', ' + elapsed,
  ].join('\n')
}

/** Substitute the configured tool name into the guidance section text. */
function guidanceFor(toolName) {
  return toolName === JEV_TOOL_NAME ? JEV_TOOL_GUIDANCE : JEV_TOOL_GUIDANCE.split(JEV_TOOL_NAME).join(toolName)
}

/**
 * Build the registry-ready tool definition. Hand-built rather than through the
 * first-party defineTool helper because Node cannot resolve that package from an
 * out-of-tree plugin; the schemas above are the exact compiled raw form.
 *
 * @param transport - { run(args) } performs one validated call and returns the canonical value.
 * @param options - optional toolName override.
 * @returns a definition accepted by ctx.tools.register.
 * @throws when the transport is missing.
 */
export function createJevToolDefinition(transport = {}, options = {}) {
  if (typeof transport.run !== 'function') throw new Error('dsh-plugin-jev: tool transport requires a run(args) function')
  const toolName = typeof options.toolName === 'string' && options.toolName.trim() !== '' ? options.toolName.trim() : JEV_TOOL_NAME
  return {
    name: toolName,
    description: JEV_TOOL_DESCRIPTION,
    parameters: JEV_TOOL_PARAMETERS,
    output: {
      schema: JEV_TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderJevResult(value) }],
    },
    execute(args) {
      return transport.run(args)
    },
  }
}

/**
 * Register the agent-facing Jev surface on a host context: the guidance section
 * that tells the model to use it, and the tool itself. Both are wrapped in
 * ctx.effect so they unregister with the plugin.
 *
 * @param ctx - host plugin context with tools and systemPrompt injected.
 * @param transport - { run(args) } transport from lib/index.js.
 * @param options - optional toolName override.
 * @returns the registered definition (useful for tests).
 */
export function registerJevTool(ctx, transport = {}, options = {}) {
  const toolName = typeof options.toolName === 'string' && options.toolName.trim() !== '' ? options.toolName.trim() : JEV_TOOL_NAME
  const definition = createJevToolDefinition(transport, { toolName })
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:' + toolName,
    order: JEV_TOOL_PROMPT_ORDER,
    text: guidanceFor(toolName),
  }), 'dsh-plugin-jev: ' + toolName + ' guidance section')
  ctx.effect(() => ctx.tools.register(definition), 'dsh-plugin-jev: ' + toolName + ' tool')
  return definition
}
