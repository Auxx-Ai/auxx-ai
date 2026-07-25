// packages/lib/src/evals/authoring.ts
//
// Shared authoring → persisted mapping for agent Simulations. A flat authoring
// shape (opening message, customer context, mocks, safe-4 assertions) is mapped
// into the validated `SimulationConfig` / `AgentEvalAssertion[]` contracts the
// engine and `eval.create` enforce. Two callers share this one path:
//   • the LLM suggester (`suggestions.ts`) — maps each emitted item, drops bad ones
//   • the Kopilot `create_eval_case` tool — maps the model's authored params
// so both get identical guardrails: canonical tool names, validated mock
// outputs, the safe-4 assertion allowlist, and the final schema gate.

import { createScopedLogger } from '@auxx/logger'
import type { AgentEvalAssertion, SimulationConfig, SimulationToolMock } from '@auxx/types/evals'
import { agentEvalAssertionsSchema, simulationConfigSchema } from '@auxx/types/evals/schema'
import { generateId } from '@auxx/utils'
import { err, ok, type Result } from 'neverthrow'
import { z } from 'zod'
import { isToolVisibleOn } from '../agents/tool-visibility'
import { buildEffectiveAgentRuntime } from '../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition } from '../ai/agent-framework/types'
import { getCachedAgentById } from '../cache'
import { type EditorToolEntry, projectEditorToolEntries } from './editor-support'
import { validateMockOutput } from './simulation/mock-tools'

const logger = createScopedLogger('eval-authoring')

// ── Authoring contract (the flat shape both callers map FROM) ───────────────

/**
 * One authored assertion — the safe-4 subset only. Per-type fields are nullable
 * (mirroring the strict structured-output schema the suggester's model emits),
 * with a `superRefine` that requires exactly the field each `type` needs. There
 * is deliberately no `crm_field` / `local_variable` / `procedure_selected`: an
 * authoring model gets the four assertion types that need no CRM/variable
 * plumbing, and can't grade itself against record state it can't observe.
 */
export const authoringAssertionSchema = z
  .object({
    type: z.enum(['terminal_outcome', 'response_criteria', 'tool_called', 'tool_not_called']),
    outcome: z.enum(['finished', 'handoff', 'switch']).nullish(),
    criteria: z.array(z.string().min(1)).nullish(),
    toolName: z.string().min(1).nullish(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.type === 'terminal_outcome' && !a.outcome) {
      ctx.addIssue({ code: 'custom', message: 'terminal_outcome requires an outcome' })
    }
    if (a.type === 'response_criteria' && (!a.criteria || a.criteria.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'response_criteria requires criteria' })
    }
    if ((a.type === 'tool_called' || a.type === 'tool_not_called') && !a.toolName) {
      ctx.addIssue({ code: 'custom', message: `${a.type} requires a toolName` })
    }
  })

/**
 * One authored simulation case. `.strict()` so any stray field fails the parse —
 * this IS the allowlist (no `startingFields` / `subject` / `timeFrozenAt`; the
 * only identity hook is `claimed`). `rationale` is optional: the suggester fills
 * it (one line naming the path), the tool omits it.
 *
 * `mocks[].output` rides as a JSON STRING — structured-output providers reject a
 * schemaless "any" property, so the value is JSON-encoded and parsed + schema-
 * checked here. The Kopilot tool's param schema mirrors this for the same reason.
 */
export const authoringCaseSchema = z
  .object({
    name: z.string().min(1),
    rationale: z.string().min(1).optional(),
    openingMessage: z.string().min(1),
    customerContext: z.string().nullable(),
    claimed: z
      .object({
        name: z.string().nullish(),
        email: z.string().nullish(),
      })
      .nullish(),
    channel: z.enum(['chat', 'email']),
    maxCustomerTurns: z.number().int(),
    mocks: z.array(
      z
        .object({
          toolName: z.string().min(1),
          output: z.string().transform((s, ctx): unknown => {
            try {
              return JSON.parse(s)
            } catch {
              ctx.addIssue({ code: 'custom', message: 'mock output must be a JSON string' })
              return z.NEVER
            }
          }),
        })
        .strict()
    ),
    assertions: z.array(authoringAssertionSchema).min(1),
  })
  .strict()

export type AuthoringCase = z.infer<typeof authoringCaseSchema>

/** A mapped, schema-valid case ready for `createEvalCase`. */
export interface BuiltSimulationCase {
  name: string
  rationale?: string
  config: SimulationConfig
  assertions: AgentEvalAssertion[]
}

// ── Tool runtime resolution (shared so the runtime builds once per caller) ──

export interface AgentMockToolContext {
  /** mockEditor-visible tools keyed by canonical name — valid mock/assertion targets. */
  toolMap: Map<string, AgentToolDefinition>
  /** Projection the suggester prompt renders; unused by the tool. */
  toolEntries: EditorToolEntry[]
  /** Utility model the suggester calls; unused by the tool. */
  utilityModel: { provider: string; model: string }
}

/**
 * Resolve the agent's effective runtime once and project the mock-targetable
 * tools. Control tools are excluded by construction (invalid mock targets).
 * Throws on a runtime-build failure — callers wrap it in their own error code.
 */
export async function resolveAgentMockToolContext(input: {
  organizationId: string
  userId: string
  agentId: string
  sessionId: string
}): Promise<AgentMockToolContext> {
  const agent = await getCachedAgentById(input.organizationId, input.agentId)
  const hasProcedures = (agent?.procedures ?? []).length > 0
  const runtime = await buildEffectiveAgentRuntime({
    organizationId: input.organizationId,
    userId: input.userId,
    sessionId: input.sessionId,
    agentId: input.agentId,
    domain: 'kopilot',
    hasProcedures,
    // Mock-EDITOR context: this enumerates the agent's tool universe so a mock can
    // be authored against a real `outputSchema`. It never executes a tool, so there
    // is no operation to authorize — and filtering the list by the agent's policy
    // would hide tools whose mocks still need to validate. Explicit `undefined`
    // rather than an omission (see `createToolDepsFactory`).
    capabilities: undefined,
  })
  const visibleTools = runtime.tools.filter((t) => isToolVisibleOn(t, 'mockEditor'))
  return {
    toolMap: new Map(visibleTools.map((t) => [t.name, t])),
    toolEntries: projectEditorToolEntries(runtime.tools),
    utilityModel: runtime.utilityModel,
  }
}

// ── Mapping core (pure; sync) ───────────────────────────────────────────────

/**
 * Resolve a model-emitted tool name to a canonical registered name. An exact hit
 * wins; otherwise a UNIQUE `_`-boundary suffix match rescues a "simplified" app
 * tool name (`find_shopify_order` → `shopify_find_shopify_order`). Ambiguity or
 * no match → null, which drops the item.
 */
export function resolveToolName(
  name: string,
  toolMap: Map<string, AgentToolDefinition>
): string | null {
  const cleaned = name.trim().replace(/^`+|`+$/g, '')
  if (toolMap.has(cleaned)) return cleaned
  const matches = [...toolMap.keys()].filter((n) => n.endsWith(`_${cleaned}`))
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** Wrap one authoring assertion into the persisted discriminated-union envelope. */
function mapAssertion(a: AuthoringCase['assertions'][number]): AgentEvalAssertion {
  const id = generateId()
  switch (a.type) {
    case 'terminal_outcome':
      return { id, type: 'terminal_outcome', data: { outcome: a.outcome! } }
    case 'response_criteria':
      return { id, type: 'response_criteria', data: { criteria: a.criteria! } }
    case 'tool_called':
      return { id, type: 'tool_called', data: { toolName: a.toolName! } }
    case 'tool_not_called':
      return { id, type: 'tool_not_called', data: { toolName: a.toolName! } }
  }
}

/**
 * Map + validate one authored item into a persisted-shape case. Returns the
 * built case or a single-line reason string the caller surfaces (the tool) or
 * logs as a drop (the suggester). Mirrors phase-3a §3.6.
 */
export function buildSimulationCaseFromAuthoring(
  raw: unknown,
  toolMap: Map<string, AgentToolDefinition>
): Result<BuiltSimulationCase, string> {
  // 1. Shape + allowlist.
  const parsed = authoringCaseSchema.safeParse(raw)
  if (!parsed.success) {
    return err(`invalid shape: ${parsed.error.issues[0]?.message ?? 'parse error'}`)
  }
  const item = parsed.data

  // 2. Tool-name existence + canonicalization (mocks + tool_(not_)called).
  const mocks: AuthoringCase['mocks'] = []
  for (const mock of item.mocks) {
    const canonical = resolveToolName(mock.toolName, toolMap)
    if (!canonical) return err(`unknown mock tool "${mock.toolName}"`)
    mocks.push({ ...mock, toolName: canonical })
  }
  const itemAssertions: AuthoringCase['assertions'] = []
  for (const a of item.assertions) {
    if (a.type === 'tool_called' || a.type === 'tool_not_called') {
      const canonical = a.toolName ? resolveToolName(a.toolName, toolMap) : null
      if (!canonical) return err(`unknown assertion tool "${a.toolName}"`)
      itemAssertions.push({ ...a, toolName: canonical })
    } else {
      itemAssertions.push(a)
    }
  }

  // 3. Mock outputs against each tool's declared outputSchema.
  for (const mock of mocks) {
    const tool = toolMap.get(mock.toolName)!
    const validation = validateMockOutput(tool, mock.output)
    if (!validation.ok) return err(`bad mock output for "${mock.toolName}": ${validation.error}`)
  }

  // 4. Dedupe mocks by toolName (first wins — drawer's one-mock-per-tool model).
  const seenTools = new Set<string>()
  const connectorMocks: SimulationToolMock[] = []
  for (const mock of mocks) {
    if (seenTools.has(mock.toolName)) continue
    seenTools.add(mock.toolName)
    connectorMocks.push({
      id: generateId(),
      toolName: mock.toolName,
      output: mock.output,
      usage: 'repeat',
    })
  }

  // 5. Map to persisted shapes. Keep only the claimed fields actually filled.
  const claimedName = item.claimed?.name ?? undefined
  const claimedEmail = item.claimed?.email ?? undefined
  const claimed =
    claimedName || claimedEmail
      ? {
          ...(claimedName ? { name: claimedName } : {}),
          ...(claimedEmail ? { email: claimedEmail } : {}),
        }
      : undefined

  const assertions: AgentEvalAssertion[] = itemAssertions.map(mapAssertion)
  const config: SimulationConfig = {
    openingMessage: item.openingMessage,
    customerContext: item.customerContext,
    channel: item.channel,
    timeFrozenAt: null,
    maxCustomerTurns: Math.min(8, Math.max(1, item.maxCustomerTurns)),
    subject: { recordIds: [], identityVerified: false, ...(claimed ? { claimed } : {}) },
    startingFields: [],
    // Mocked-path cases should fail loudly on an unexpected tool call.
    unmatchedToolPolicy: 'error',
    connectorMocks,
  }

  // 6. Final gate — the same contracts `eval.create` enforces. Failure here is a
  //    mapping bug, not a caller problem: log AND surface.
  const configCheck = simulationConfigSchema.safeParse(config)
  const assertionsCheck = agentEvalAssertionsSchema.safeParse(assertions)
  if (!configCheck.success || !assertionsCheck.success) {
    logger.warn('mapped case failed the final schema gate', {
      config: configCheck.success ? undefined : configCheck.error.issues,
      assertions: assertionsCheck.success ? undefined : assertionsCheck.error.issues,
    })
    return err('mapped case failed schema validation')
  }

  return ok({
    name: item.name,
    rationale: item.rationale,
    config: configCheck.data,
    assertions: assertionsCheck.data,
  })
}
