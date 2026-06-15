// packages/lib/src/evals/suggestions.ts
//
// LLM-first suggester for agent Simulations (plans/evals/phase-3-suggester.md v1,
// file-by-file in phase-3a-suggester-backend.md). One utility-model call reads the
// draft procedure + effective toolset + existing cases and emits a flat authoring
// shape; the server maps that into the persisted `SimulationConfig` /
// `AgentEvalAssertion` contracts and drops anything that fails validation. Nothing
// is persisted — suggestions live only in this response until the UI accepts one
// via `eval.create`.

import type { EvalCaseEntity } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import type { AgentEvalAssertion, SimulationConfig } from '@auxx/types/evals'
import { agentEvalAssertionsSchema, simulationConfigSchema } from '@auxx/types/evals/schema'
import { generateId } from '@auxx/utils'
import { err, ok, type Result } from 'neverthrow'
import { z } from 'zod'
import { docToDsl } from '../agents/procedures/authoring/doc-to-dsl'
import type { ProcedureDsl, ProcedureDslStep } from '../agents/procedures/authoring/dsl'
import { getAttachedProcedureDraft } from '../agents/procedures/authoring/queries'
import { createCallModel } from '../ai/agent-framework/llm-adapter'
import type { LLMCallParams } from '../ai/agent-framework/types'
import type { Message } from '../ai/clients/base/types'
import {
  type AgentMockToolContext,
  buildSimulationCaseFromAuthoring,
  resolveAgentMockToolContext,
} from './authoring'
import type { EditorToolEntry } from './editor-support'
import { listEvalCasesByAgent } from './queries'
import type { CallModel } from './simulation/persona'
import type { EvalServiceError } from './types'

const logger = createScopedLogger('eval-suggester')

/** A complete, schema-valid proposed simulation case, ready for `eval.create`. */
export interface SimulationSuggestion {
  /** Ephemeral provenance — stamped onto the case when accepted. */
  suggestionId: string
  name: string
  /** One line: which path/behavior this exercises. */
  rationale: string
  config: SimulationConfig
  assertions: AgentEvalAssertion[]
}

export interface SuggestResult {
  /** Content hash of the draft these suggestions were generated from (cache key). */
  draftHash: string
  suggestions: SimulationSuggestion[]
  /** How many emitted items failed validation and were discarded. */
  dropped: number
}

export interface SuggestAgentSimulationsInput {
  organizationId: string
  userId: string
  agentId: string
  procedureId: string
  /** Bypass the Redis cache and regenerate (the UI's Refresh action). */
  force?: boolean
  /** DI seam for tests — defaults to `createCallModel(...)`. */
  callModel?: CallModel
  signal?: AbortSignal
}

/**
 * Generate up to 5 validated simulation suggestions for the procedure the author
 * is editing. A failed/unusable model call returns `EVAL_SUGGESTION_FAILED`;
 * per-item problems never throw — they increment `dropped`. Zero valid items is a
 * success with an empty list.
 */
export async function suggestAgentSimulations(
  input: SuggestAgentSimulationsInput
): Promise<Result<SuggestResult, EvalServiceError>> {
  const { organizationId, userId, agentId, procedureId } = input

  // 1. Draft doc + metadata (enforces attachment / cross-org via the query).
  const draftResult = await getAttachedProcedureDraft({ organizationId, agentId, procedureId })
  if (draftResult.isErr()) {
    return err({
      code: 'EVAL_VALIDATION',
      message: errorMessage(draftResult.error, 'Could not load the procedure draft'),
      cause: draftResult.error,
    })
  }
  const draft = draftResult.value
  const draftHash = draft.draftContentHash

  // Content-keyed cache: identical draft → reuse the generation across reloads and
  // users instead of re-spending tokens. Refresh (`force`) bypasses it.
  const cacheKey = suggestionCacheKey(organizationId, agentId, procedureId, draftHash)
  if (!input.force) {
    const cached = await readCachedSuggestions(cacheKey)
    if (cached) {
      logger.info('suggestions cache hit', { procedureId, draftHash })
      return ok(cached)
    }
  }

  // 2. Effective runtime, resolved ONCE — tools + utilityModel come from the same
  //    build `prepare-run` uses. Shared with the `create_eval_case` tool so both
  //    canonicalize against the identical tool universe. Runtime build is infra.
  let toolMap: AgentMockToolContext['toolMap']
  let toolEntries: EditorToolEntry[]
  let utilityModel: { provider: string; model: string }
  try {
    ;({ toolMap, toolEntries, utilityModel } = await resolveAgentMockToolContext({
      organizationId,
      userId,
      agentId,
      sessionId: `eval-suggest-${agentId}`,
    }))
  } catch (cause) {
    return err({
      code: 'EVAL_SUGGESTION_FAILED',
      message: 'Could not build the agent runtime',
      cause,
    })
  }

  // 3. Existing cases for the procedure — fed to the prompt so the model proposes
  //    what is not yet covered (the LLM-native replacement for structural dedup).
  const casesResult = await listEvalCasesByAgent({ organizationId, agentId, procedureId })
  if (casesResult.isErr()) {
    return err({
      code: 'EVAL_SUGGESTION_FAILED',
      message: 'Could not list existing eval cases',
      cause: casesResult.error,
    })
  }
  const existing = projectExistingCases(casesResult.value)

  // Render the draft DSL into an indented outline the model can read.
  const procedureText = renderProcedureText(docToDsl(draft.draftDoc), draft.name, draft.whenToUse)

  // 4. The single structured call.
  const callModel =
    input.callModel ??
    createCallModel({ organizationId, userId, source: 'eval', sourceId: `suggest-${procedureId}` })
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(procedureText, toolEntries, existing) },
  ]
  const params: LLMCallParams = {
    provider: utilityModel.provider,
    model: utilityModel.model,
    messages,
    responseFormat: SUGGESTIONS_RESPONSE_SCHEMA,
    signal: input.signal,
  }

  let content = ''
  let finishReason: string | undefined
  let usage: unknown
  try {
    for await (const event of callModel(params)) {
      if (event.type === 'done') {
        content = event.content
        finishReason = event.finishReason
        usage = event.usage
      }
    }
  } catch (cause) {
    return err({ code: 'EVAL_SUGGESTION_FAILED', message: 'Suggestion model call failed', cause })
  }

  // A truncated JSON array must not be repaired — fail the whole call.
  if (finishReason === 'length') {
    return err({ code: 'EVAL_SUGGESTION_FAILED', message: 'model output truncated' })
  }
  if (!content.trim()) {
    return err({ code: 'EVAL_SUGGESTION_FAILED', message: 'model returned empty output' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (cause) {
    return err({ code: 'EVAL_SUGGESTION_FAILED', message: 'model returned non-JSON', cause })
  }

  // Lenient outer parse — item strictness is per-item so one bad item can't sink
  // the batch.
  const envelope = z.object({ suggestions: z.array(z.unknown()) }).safeParse(parsed)
  if (!envelope.success) {
    return err({
      code: 'EVAL_SUGGESTION_FAILED',
      message: 'model output is missing a suggestions array',
      cause: envelope.error,
    })
  }

  // Belt for a prompt-ignoring model.
  const rawItems = envelope.data.suggestions.slice(0, 5)
  const suggestions: SimulationSuggestion[] = []
  let dropped = 0
  for (let i = 0; i < rawItems.length; i++) {
    // Same map+validate path the `create_eval_case` tool uses; a bad item drops.
    const built = buildSimulationCaseFromAuthoring(rawItems[i], toolMap)
    if (built.isErr()) {
      logger.info('dropped suggestion', { index: i, reason: built.error })
      dropped++
      continue
    }
    suggestions.push({
      suggestionId: generateId(),
      name: built.value.name,
      rationale: built.value.rationale ?? '',
      config: built.value.config,
      assertions: built.value.assertions,
    })
  }

  logger.info('suggestions generated', { kept: suggestions.length, dropped, usage })
  const out: SuggestResult = { draftHash, suggestions, dropped }
  // A fully-dropped generation is a model failure, not the draft's truth — don't
  // pin an empty list to the cache for an hour; the next request retries.
  if (suggestions.length > 0 || dropped === 0) await writeCachedSuggestions(cacheKey, out)
  return ok(out)
}

// ── Redis cache (content-keyed by draftHash; degrades to no-op) ─────────────

/** TTL for a cached generation — content-keyed, so edits naturally rotate the key. */
const SUGGESTION_CACHE_TTL_SECONDS = 60 * 60 // 1 hour

function suggestionCacheKey(
  orgId: string,
  agentId: string,
  procedureId: string,
  draftHash: string
): string {
  return `eval:suggest:${orgId}:${agentId}:${procedureId}:${draftHash}`
}

/** Read a cached result; any Redis problem (incl. unavailable) is a cache miss. */
async function readCachedSuggestions(key: string): Promise<SuggestResult | null> {
  try {
    const client = await getRedisClient(false)
    if (!client) return null
    const raw = await client.get(key)
    return raw ? (JSON.parse(raw) as SuggestResult) : null
  } catch (error) {
    logger.warn('suggestion cache read failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Cache a result under its draft-hash key; failures are swallowed (best-effort). */
async function writeCachedSuggestions(key: string, value: SuggestResult): Promise<void> {
  try {
    const client = await getRedisClient(false)
    if (!client) return
    await client.setex(key, SUGGESTION_CACHE_TTL_SECONDS, JSON.stringify(value))
  } catch (error) {
    logger.warn('suggestion cache write failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ── Existing-case projection ───────────────────────────────────────────────

interface ExistingCaseHint {
  name: string
  openingMessage: string
  assertionTypes: string[]
}

/** Project saved cases to the prompt hint, skipping rows that don't parse. */
function projectExistingCases(rows: EvalCaseEntity[]): ExistingCaseHint[] {
  const out: ExistingCaseHint[] = []
  for (const row of rows) {
    const config = simulationConfigSchema.safeParse(row.config)
    const assertions = agentEvalAssertionsSchema.safeParse(row.assertions)
    if (!config.success || !assertions.success) continue
    out.push({
      name: row.name,
      openingMessage: config.data.openingMessage,
      assertionTypes: [...new Set(assertions.data.map((a) => a.type))],
    })
  }
  return out
}

// ── DSL rendering (pure) ───────────────────────────────────────────────────

const MAX_INSTRUCTION_CHARS = 500
const MAX_EXAMPLE_CHARS = 1000

/**
 * Render a {@link ProcedureDsl} tree into an indented, numbered outline. The
 * numbering gives the model stable referents for `rationale`. Pure — no I/O.
 */
export function renderProcedureText(dsl: ProcedureDsl, name: string, whenToUse: string): string {
  const lines: string[] = [`Procedure: ${name}`, `When to use: ${whenToUse}`, '']
  renderSteps(dsl.steps, '', lines, dsl)
  for (const sp of dsl.subProcedures ?? []) {
    lines.push('', `Sub-procedure "${sp.name || sp.id}":`)
    renderSteps(sp.steps, '', lines, dsl)
  }
  return lines.join('\n')
}

function renderSteps(
  steps: ProcedureDslStep[],
  prefix: string,
  lines: string[],
  dsl: ProcedureDsl
): void {
  steps.forEach((step, i) => renderStep(step, `${prefix}${i + 1}`, lines, dsl))
}

function renderStep(step: ProcedureDslStep, num: string, lines: string[], dsl: ProcedureDsl): void {
  const depth = (num.match(/\./g) ?? []).length
  const indent = '  '.repeat(depth)

  switch (step.kind) {
    case 'instruction':
      lines.push(`${indent}${num}. ${truncate(step.text, MAX_INSTRUCTION_CHARS)}`)
      return
    case 'route':
      lines.push(`${indent}${num}. ${renderRoute(step)}`)
      return
    case 'call': {
      const sub = dsl.subProcedures?.find((s) => s.id === step.subProcedureId)
      lines.push(`${indent}${num}. → run sub-procedure "${sub?.name || step.subProcedureId}"`)
      return
    }
    case 'opaque':
      lines.push(`${indent}${num}. [${step.label}]`)
      return
    case 'condition': {
      step.cases.forEach((c, ci) => {
        lines.push(`${indent}${num}. ${ci === 0 ? 'IF' : 'ELSE IF'} ${c.when}`)
        renderSteps(c.steps, `${num}.`, lines, dsl)
      })
      if (step.else !== undefined) {
        lines.push(`${indent}ELSE`)
        renderSteps(step.else, `${num}.`, lines, dsl)
      }
      return
    }
  }
}

function renderRoute(step: Extract<ProcedureDslStep, { kind: 'route' }>): string {
  switch (step.outcome) {
    case 'finished':
      return '→ finish'
    case 'handoff':
      return '→ hand off'
    case 'switch':
      return `→ switch to procedure "${step.switchToProcedureId}"`
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// ── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You design test simulations for an AI customer-support agent that follows a',
  'written procedure.',
  '',
  'How a simulation runs: a synthetic customer persona improvises a conversation',
  'starting from the opening message, guided by the customer context (their',
  "situation, tone, and what information they do or don't have). When the agent",
  'calls a tool, the simulation answers with the mock output you provide instead',
  'of a live system. After the conversation ends, each assertion is checked.',
  '',
  'Assertion types:',
  '- terminal_outcome: how the procedure ends — finished | handoff | switch',
  "- response_criteria: statements about what the agent's replies must contain;",
  '  write each criterion as ONE independently checkable statement',
  '- tool_called / tool_not_called: whether the agent invoked a named tool',
  '',
  'Rules:',
  '- Propose at most 5 simulations; fewer if the procedure is trivial.',
  '- Each simulation must exercise a DISTINCT path: the happy path, each major',
  '  condition arm, a customer missing required information, an edge/refusal case.',
  '- Do not duplicate the existing simulations listed.',
  '- toolName values must be the exact backticked identifier from the tool list,',
  '  copied verbatim — never shortened, reordered, or re-derived from the label.',
  '- A tool listed with an example output returns that example automatically; only',
  '  provide a mock when the path needs a DIFFERENT output (e.g. order not found,',
  '  refund ineligible). Tools with no example need a mock if the path calls them.',
  '- Each mock "output" must be a JSON STRING following the tool\'s example output',
  '  shape, e.g. "{\\"status\\":\\"shipped\\"}".',
  '- Set customerContext so the persona can actually play the path (what they',
  '  know, what they want, what they refuse to provide).',
  '- When the path needs the customer to provide identity, set "claimed" with a',
  '  concrete, realistic name/email; for any other identifier the path needs (order',
  '  number, account id) state a concrete value in customerContext. NEVER use a',
  '  placeholder or redaction like "[email redacted]" — the agent needs usable values.',
  '- channel is "chat" unless the procedure is clearly about email.',
  '- name: a short label of at most 5 words naming the path under test',
  '  (e.g. "Happy path", "Missing order number", "Refund refusal"). Not a sentence.',
  '- rationale: one line naming the step/branch the simulation exercises.',
  '- Every simulation must include at least one assertion.',
].join('\n')

function buildUserMessage(
  procedureText: string,
  toolEntries: EditorToolEntry[],
  existing: ExistingCaseHint[]
): string {
  const toolsBlock =
    toolEntries.length > 0
      ? toolEntries
          .map((t) => {
            const example = t.example ?? t.scaffold
            const exampleText =
              example === undefined
                ? 'none declared'
                : truncate(JSON.stringify(example), MAX_EXAMPLE_CHARS)
            // Exact name first — models copy headings far more reliably than
            // parentheticals, and registered app names double the app slug
            // (`shopify_find_shopify_order`), which invites "simplification".
            return `### \`${t.name}\` — ${t.displayName}\n${t.description}\nExample output: ${exampleText}`
          })
          .join('\n\n')
      : 'No tools are available to this agent.'

  const existingBlock =
    existing.length > 0
      ? existing
          .map(
            (c) =>
              `- "${c.name}" — opens with: "${c.openingMessage}" — checks: ${c.assertionTypes.join(', ')}`
          )
          .join('\n')
      : 'None yet.'

  return [
    '## Procedure (what the agent follows)',
    procedureText,
    '',
    '## Tools available to the agent',
    toolsBlock,
    '',
    '## Existing simulations (do not duplicate)',
    existingBlock,
  ].join('\n')
}

// ── Structured-output contracts (provider literal + Zod twin, kept adjacent) ──

/**
 * Provider-facing JSON-schema literal (same pattern as `JUDGE_RESPONSE_SCHEMA`).
 * Assertions are ONE object shape with optional per-type fields — provider
 * `oneOf` support is inconsistent. Only a hint: `authoringCaseSchema` in
 * `./authoring` is authoritative (it parses + maps each emitted item).
 */
const SUGGESTIONS_RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  jsonSchema: {
    name: 'simulation_suggestions',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['suggestions'],
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'name',
              'rationale',
              'openingMessage',
              'customerContext',
              'claimed',
              'channel',
              'maxCustomerTurns',
              'mocks',
              'assertions',
            ],
            properties: {
              name: { type: 'string' },
              rationale: { type: 'string' },
              openingMessage: { type: 'string' },
              customerContext: { type: ['string', 'null'] },
              // The identity the customer states when asked. Concrete values, never
              // placeholders — an unfilled path emits `null` for both.
              claimed: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'email'],
                properties: {
                  name: { type: ['string', 'null'] },
                  email: { type: ['string', 'null'] },
                },
              },
              channel: { type: 'string', enum: ['chat', 'email'] },
              maxCustomerTurns: { type: 'integer' },
              mocks: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['toolName', 'output'],
                  properties: {
                    toolName: { type: 'string' },
                    // A JSON-encoded string — structured-output providers (OpenAI)
                    // reject a schemaless "any" property, so the mock output rides
                    // as text and is JSON.parsed + schema-checked server-side.
                    output: {
                      type: 'string',
                      description: "The tool's mock output, encoded as a JSON string.",
                    },
                  },
                },
              },
              assertions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  // Strict structured output requires EVERY key in `required`, so
                  // the per-type fields are nullable rather than optional — the
                  // model emits `null` for the ones its `type` doesn't use, and the
                  // Zod twin validates which field each type actually needs.
                  required: ['type', 'outcome', 'criteria', 'toolName'],
                  properties: {
                    type: {
                      type: 'string',
                      enum: [
                        'terminal_outcome',
                        'response_criteria',
                        'tool_called',
                        'tool_not_called',
                      ],
                    },
                    outcome: { type: ['string', 'null'] },
                    criteria: { type: ['array', 'null'], items: { type: 'string' } },
                    toolName: { type: ['string', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown })?.message === 'string'
      ? (error as { message: string }).message
      : fallback
}
