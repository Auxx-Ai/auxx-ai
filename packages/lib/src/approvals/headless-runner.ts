// packages/lib/src/approvals/headless-runner.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { and, eq } from 'drizzle-orm'
import { AgentEngine } from '../ai/agent-framework/engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentState,
  AgentToolDefinition,
  LLMCallParams,
  LLMStreamEvent,
} from '../ai/agent-framework/types'
import { sessionMessagesToWire } from '../ai/agent-framework/utils'
import type { Message } from '../ai/clients/base/types'
import {
  createActorCapabilities,
  createAppCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
  type GetToolDeps,
} from '../ai/kopilot/capabilities'
import { enrichEntitiesWithFieldValues } from '../ai/kopilot/capabilities/entities/enrich-entity-fields'
import { createMcpCapabilities } from '../ai/mcp'
import {
  findCachedResource,
  getCachedKbCatalog,
  getCachedMembers,
} from '../cache/org-cache-helpers'
import { renderKbCatalog } from '../kb/catalog/render-kb-catalog'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import { getCapabilities } from '../permissions/capabilities/get-capabilities'
import { Result, type TypedResult } from '../result'
import { createTaskService } from '../tasks/task-service'
import { sanitizeEventPayloadForLLM } from './sanitize-event-payload'
import type { HeadlessRunInput, HeadlessRunResult, ProposedAction } from './types'
import { mergeActions, parseFinalText } from './utils'

const logger = createScopedLogger('headless-runner')

/** Per-field truncation cap when serializing entity snapshots for the prompt. */
const FIELD_VALUE_CAP = 200
/** Max number of open tasks to include verbatim in the prompt. */
const OPEN_TASKS_CAP = 5
/**
 * Soft calls are draft-mode invocations of write tools — they execute for real
 * (producing a durable Draft) and are recorded as `ranDuringCapture` actions
 * for the bundle. Send-mode calls of the same tools are approval-gated and
 * captured by the engine instead.
 */
function isSoftCall(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === 'reply_to_thread' || toolName === 'start_new_conversation') {
    return args.mode !== 'send'
  }
  return false
}

/**
 * The outcome of resolving the human a capture-mode run is bounded by.
 * `ok: false` is a hard stop, never a widening — see
 * {@link resolveCaptureRunPrincipal}.
 */
export type CaptureRunPrincipal =
  | { ok: true; capabilities: CapabilityView }
  | { ok: false; reason: string }

/**
 * Resolve the {@link CapabilityView} a capture-mode run (headless suggestion /
 * learned extraction) executes under — doc 19 §2.3 applied to a path that has
 * no agent.
 *
 * **Why not `resolveAgentRunCapabilities`.** Neither runner is an agent run:
 * both mint a throwaway `AgentDefinition` in-process, there is no `Agent` row,
 * no synthetic User and therefore no `AgentVersion.permissionPolicy` snapshot to
 * resolve. §2.3's chain degenerates to its last term — the human the run acts
 * for — and that human is `input.ownerUserId`, the member whose Today feed
 * receives the resulting bundle. Bounding the run by the person who will read
 * its output is the only defensible reading; a parallel policy source would be
 * exactly the drift §2.3 warns about.
 *
 * **Fail closed, and stop rather than run blind.** `ownerUserId` is not
 * guaranteed to be a permission principal: both callers fall back to
 * `Organization.systemUserId` (a `userType: 'SYSTEM'` User that is deliberately
 * NOT an `OrganizationMember`) and the stale scanner may hand us an `AGENT`
 * creator. Those compose to an empty capability set, so the run could not read
 * anything useful anyway — and `buildHeadlessPrompt` would still have burned an
 * LLM call after reading field values, tasks and the KB catalog outside the
 * `ToolDeps.capabilities` channel. Refusing up front is both cheaper and
 * strictly tighter than running with empty capabilities.
 */
export async function resolveCaptureRunPrincipal(params: {
  organizationId: string
  ownerUserId: string
}): Promise<CaptureRunPrincipal> {
  const { organizationId, ownerUserId } = params
  const member = (await getCachedMembers(organizationId)).find((m) => m.userId === ownerUserId)

  if (!member) {
    return { ok: false, reason: `owner ${ownerUserId} is not a member of this organization` }
  }
  if (member.status !== 'ACTIVE') {
    return { ok: false, reason: `owner ${ownerUserId} membership is ${member.status}` }
  }
  if (member.user?.userType !== 'USER') {
    return {
      ok: false,
      reason: `owner ${ownerUserId} is not a human member (userType ${member.user?.userType ?? 'unknown'})`,
    }
  }

  return { ok: true, capabilities: await getCapabilities(ownerUserId, organizationId) }
}

const HEADLESS_SYSTEM_PROMPT_ADDITION = `You are running in headless suggestion mode. Propose 0..N actions for the human to triage. You may use read-only tools (search, list, query) to gather context. For broad context on a record, prefer a single \`get_entity_history\` call over assembling the same data from \`find_threads\` + \`list_notes\` + \`list_tasks\` separately. \`reply_to_thread\` and \`start_new_conversation\` with \`mode: 'draft'\` create a draft for the user to review before sending. The same tools with \`mode: 'send'\` (and other mutation tools) will be queued for human approval — they do not execute immediately, but you will see a predicted output (e.g. a \`temp_<n>\` id) so you can chain dependent actions. Plan all actions up front; results from queued mutations are predictions only, not real state. End with a single line: \`[summary] <≤ 12 words>\` if you proposed actions, or \`[noop] <reason>\` if no action is appropriate. Limit yourself to 5 read-tool calls.`

/**
 * Run kopilot once in headless capture mode and produce a bundle of proposed
 * actions for a human to triage. Designed to be called from a scanner job
 * (Phase 3c) or, eventually, an event-driven trigger (Phase 3d).
 *
 * Behavior:
 * - Loads the entity snapshot + open tasks for prompt context.
 * - Sanitizes the trigger event payload to strip raw free-text PII.
 * - Runs `AgentEngine` with `approvalMode: 'capture'`. Read-only tools execute;
 *   approval-required tools are captured (not executed) with a `predictedOutput`
 *   minted by the tool's `captureMint`. Draft-mode write tools (`reply_to_thread`
 *   / `start_new_conversation` with `mode: 'draft'`) run for real and land as a
 *   `ranDuringCapture` action.
 * - Parses the final assistant text for `[summary]` / `[noop]`.
 *
 * No session row is written; headless runs are not part of chat history.
 *
 * Failure: returns `Result.error` if the model fails or the entity is missing.
 * Partial bundles are not salvaged — apply-time expects all-or-nothing.
 */
export async function runHeadlessSuggestion(
  deps: HeadlessRunDeps,
  input: HeadlessRunInput
): Promise<TypedResult<HeadlessRunResult, Error>> {
  const headlessTraceId = generateId('hrun')
  const computedForActivityAt = new Date()

  // 1. Load the entity — fail fast if it doesn't exist or is archived.
  const entity = await deps.db.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, input.entityInstanceId),
      eq(schema.EntityInstance.organizationId, input.organizationId)
    ),
  })
  if (!entity) {
    return Result.error(new Error(`Entity ${input.entityInstanceId} not found`))
  }
  if (entity.archivedAt) {
    return Result.error(new Error(`Entity ${input.entityInstanceId} is archived`))
  }
  const entityDefinitionId = entity.entityDefinitionId

  // 2. Resolve the principal BEFORE any prompt read or LLM call. A run with no
  // resolvable human is a no-op bundle, not an unrestricted run (doc 19 §2.3).
  const principal = await resolveCaptureRunPrincipal({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  })
  if (!principal.ok) {
    logger.warn('Headless run skipped — no resolvable permission principal', {
      headlessTraceId,
      organizationId: input.organizationId,
      entityInstanceId: input.entityInstanceId,
      reason: principal.reason,
    })
    return Result.ok({
      actions: [],
      noopReason: `no_permission_principal: ${principal.reason}`,
      modelId: input.modelId,
      headlessTraceId,
      computedForActivityAt,
      computedForLatestMessageId: undefined,
      entityDefinitionId,
    })
  }

  // 3. Build the capability registry. Kopilot's existing capability factories
  // close over a `getDeps` factory for their db handle — give them one keyed
  // off the headless trace so logs / audit lookups can find this run.
  const getDeps: GetToolDeps = () => ({
    db: deps.db,
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    sessionId: headlessTraceId,
    signal: undefined,
    turnId: headlessTraceId,
    // Doc 19 §2.3 — the bundle owner's own view bounds every tool read/write.
    // See `resolveCaptureRunPrincipal` for why this is a human view and not an
    // `AgentVersion.permissionPolicy`.
    capabilities: principal.capabilities,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getDeps))
  registry.register(createKnowledgeCapabilities(getDeps))
  // Browse-first knowledge: the prompt injects the KB catalog; these read
  // tools (get_article / list_articles) let the model follow it.
  registry.register(createKbReadCapabilities(getDeps))
  registry.register(createMailCapabilities(getDeps))
  registry.register(createActorCapabilities(getDeps))
  registry.register(createTaskCapabilities(getDeps))
  registry.register(
    await createAppCapabilities({
      organizationId: input.organizationId,
      // Headless runs are autonomous — userId=null hides user-scope app tools.
      userId: null,
      agentId: null,
      triggerId: null,
      sessionId: headlessTraceId,
      getToolDeps: getDeps,
    })
  )
  // MCP-backed tools — capture mode never pauses, so keep the autonomous filter (untrusted
  // write tools shouldn't be capturable-by-default).
  registry.register(
    await createMcpCapabilities({ organizationId: input.organizationId, autonomous: true })
  )
  const tools = registry.getTools('mail')

  // 4. Build the prompt — entity fields, tasks, sanitized event payload.
  const prompt = await buildHeadlessPrompt({
    db: deps.db,
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    entity,
    entityDefinitionId,
    triggerSource: input.triggerSource,
    triggerEventType: input.triggerEventType,
    triggerEventPayload: input.triggerEventPayload,
  })

  // 5. Wire the engine in capture mode with a custom one-shot agent.
  const [provider, ...modelParts] = input.modelId.split(':')
  const model = modelParts.join(':')
  if (!provider || !model) {
    return Result.error(new Error(`Invalid modelId "${input.modelId}" (expected "provider:model")`))
  }

  // Soft-tool side channel: capture draft-mode write tool results via a wrapper
  // (cheaper than rewalking state.messages after the run).
  const softActions: ProposedAction[] = []
  const wrappedTools = tools.map((t) => wrapWithSoftCapture(t, softActions))
  const agentTools: AgentToolDefinition[] = wrappedTools

  const agent = buildHeadlessAgent({ tools: agentTools, prompt })
  const domainConfig = buildHeadlessDomainConfig({ agent, model, provider })

  const engineConfig: AgentEngineConfig = {
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    sessionId: headlessTraceId,
    db: deps.db,
    domainConfig,
    callModel: deps.callModel,
    approvalMode: 'capture',
  }

  const engine = new AgentEngine(engineConfig)

  let finalText = ''
  try {
    for await (const event of engine.submitMessage('begin headless run')) {
      if (event.type === 'assistant-message-finished') {
        finalText = event.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join('')
      }
      if (event.type === 'turn-error') {
        logger.error('Headless run errored', {
          headlessTraceId,
          entityInstanceId: input.entityInstanceId,
          error: event.error,
        })
        return Result.error(new Error(event.error))
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Headless run threw', { headlessTraceId, error: msg })
    return Result.error(err instanceof Error ? err : new Error(msg))
  }

  // 6. Merge soft actions (draft-mode write tools) with captured actions
  // (everything else). Re-index `localIndex` so it's monotonic across the merged list.
  const state = engine.getState()
  const captured = state.capturedActions ?? []
  const actions = mergeActions(softActions, captured)

  // 7. Parse [summary] / [noop] line from final text.
  logUnparsedFinal(finalText)
  const parsed = parseFinalText(finalText)

  return Result.ok({
    actions,
    summary: parsed.summary,
    noopReason: parsed.noopReason,
    modelId: input.modelId,
    headlessTraceId,
    computedForActivityAt,
    computedForLatestMessageId: undefined,
    entityDefinitionId,
  })
}

// ===== TYPES =====

export interface HeadlessRunDeps {
  db: Database
  callModel: (params: LLMCallParams) => AsyncGenerator<LLMStreamEvent>
}

// ===== INTERNALS =====

/**
 * Wrap a tool so that when a soft call (draft-mode write tool) succeeds, we
 * record its real output as a `ProposedAction` with `ranDuringCapture` set.
 * The wrapper preserves the original execute return so the engine sees the
 * normal tool result and the model can chain on `draftId`. Whether a call is
 * "soft" is decided per-invocation by `isSoftCall(toolName, args)`.
 */
function wrapWithSoftCapture(
  tool: AgentToolDefinition,
  sink: ProposedAction[]
): AgentToolDefinition {
  return {
    ...tool,
    execute: async (args, ctx) => {
      const result = await tool.execute(args, ctx)
      if (result.success && isSoftCall(tool.name, args)) {
        sink.push({
          // localIndex is rewritten in mergeActions; placeholder here.
          localIndex: -1,
          toolName: tool.name,
          args,
          summary: softToolSummary(tool.name, args),
          ranDuringCapture: {
            output: (result.output as Record<string, unknown>) ?? {},
          },
        })
      }
      return result
    },
  }
}

function softToolSummary(toolName: string, args: Record<string, unknown>): string {
  const body = typeof args.body === 'string' ? args.body : ''
  const trimmed = body.replace(/\s+/g, ' ').trim().slice(0, 60)
  const tail = body.length > 60 ? '…' : ''
  if (toolName === 'reply_to_thread') return `Draft reply: "${trimmed}${tail}"`
  if (toolName === 'start_new_conversation') return `Draft message: "${trimmed}${tail}"`
  return `${toolName}(${JSON.stringify(args).slice(0, 60)}…)`
}

function logUnparsedFinal(text: string): void {
  if (text.length > 0 && !/\[(?:summary|noop)\]/.test(text)) {
    logger.warn('Headless run did not emit [summary] or [noop] line', {
      finalTextLength: text.length,
    })
  }
}

// ===== PROMPT BUILDER =====

interface BuildPromptParams {
  db: Database
  organizationId: string
  userId: string
  entity: typeof schema.EntityInstance.$inferSelect
  entityDefinitionId: string
  triggerSource: 'event' | 'stale_scan' | 'manual'
  triggerEventType?: string
  triggerEventPayload?: Record<string, unknown>
}

/**
 * KNOWN GAP (doc 19 step 5, distinct from G0). Everything this function reads —
 * the entity's field values, its open tasks, the KB catalog — is fetched
 * DIRECTLY, not through a tool, so `ToolDeps.capabilities` cannot bound it. The
 * up-front principal check in {@link runHeadlessSuggestion} stops the whole run
 * when there is no human at all, but an owner holding `None` on this definition
 * still gets its fields injected into the prompt. Closing that needs a
 * `canViewEntity(entityDefinitionId)` gate here (and the same in
 * `buildExtractionPrompt`'s transcript read), which is a separate slice: the
 * scanner picks candidates without consulting the owner's view, so gating here
 * without also filtering candidate selection just moves the cost, not the leak.
 */
async function buildHeadlessPrompt(params: BuildPromptParams): Promise<string> {
  const lines: string[] = []

  // Entity header
  const resource = await findCachedResource(params.organizationId, params.entityDefinitionId)
  const entityLabel = resource?.label ?? 'Entity'
  const recordId = `${params.entityDefinitionId}:${params.entity.id}`
  lines.push(`# ${entityLabel}: ${params.entity.displayName ?? params.entity.id}`)
  lines.push(`recordId: ${recordId}`)
  if (params.entity.secondaryDisplayValue) {
    lines.push(`subtitle: ${truncate(params.entity.secondaryDisplayValue, FIELD_VALUE_CAP)}`)
  }
  if (params.entity.lastActivityAt) {
    lines.push(`lastActivityAt: ${params.entity.lastActivityAt.toISOString()}`)
  }

  // Field snapshot
  try {
    const enriched = await enrichEntitiesWithFieldValues({
      organizationId: params.organizationId,
      userId: params.userId,
      db: params.db,
      entities: [
        {
          recordId,
          entityDefinitionId: params.entityDefinitionId,
          entityInstanceId: params.entity.id,
        },
      ],
    })
    const fields = enriched.get(recordId)
    if (fields && Object.keys(fields).length > 0) {
      lines.push('')
      lines.push('## Fields')
      for (const [label, field] of Object.entries(fields)) {
        const display = field.displayValue
        if (display === null || display === undefined || display === '') continue
        const serialized = typeof display === 'string' ? display : JSON.stringify(display)
        lines.push(`- ${label}: ${truncate(serialized, FIELD_VALUE_CAP)}`)
      }
    }
  } catch (err) {
    logger.warn('Failed to enrich entity fields for headless prompt', {
      entityInstanceId: params.entity.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Open tasks linked to this entity (cap 5, deadline ascending, NULL last).
  try {
    const taskService = createTaskService(params.db)
    const taskResult = await taskService.listTasks({
      organizationId: params.organizationId,
      includeCompleted: false,
      limit: 25,
    })
    const linked = taskResult.tasks.filter((t) =>
      t.references.some((r) => r.entityInstanceId === params.entity.id)
    )
    linked.sort((a, b) => {
      const aD = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY
      const bD = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY
      return aD - bD
    })
    const top = linked.slice(0, OPEN_TASKS_CAP)
    if (top.length > 0) {
      lines.push('')
      lines.push('## Open tasks')
      for (const t of top) {
        const deadline = t.deadline ? t.deadline.toISOString().slice(0, 10) : 'no deadline'
        lines.push(`- ${truncate(t.title, FIELD_VALUE_CAP)} (${deadline})`)
      }
    }
  } catch (err) {
    logger.warn('Failed to load open tasks for headless prompt', {
      entityInstanceId: params.entity.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Knowledge catalog — browse-first retrieval (headless runs are internal,
  // so INTERNAL KBs are visible).
  try {
    const catalog = await getCachedKbCatalog(params.organizationId)
    const rendered = renderKbCatalog(catalog, { publicOnly: false })
    if (rendered) {
      lines.push('')
      lines.push(rendered)
    }
  } catch (err) {
    logger.warn('Failed to load KB catalog for headless prompt', {
      organizationId: params.organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Trigger context
  lines.push('')
  lines.push('## Trigger')
  lines.push(`source: ${params.triggerSource}`)
  if (params.triggerEventType) lines.push(`eventType: ${params.triggerEventType}`)
  if (params.triggerEventPayload) {
    const sanitized = sanitizeEventPayloadForLLM(params.triggerEventPayload)
    lines.push(`payload: ${JSON.stringify(sanitized)}`)
  }

  lines.push('')
  lines.push(
    'Decide what (if anything) to do next on behalf of the owner. Use read-only tools to gather context if needed.'
  )

  return lines.join('\n')
}

function truncate(value: string, cap: number): string {
  if (value.length <= cap) return value
  return `${value.slice(0, cap)}… [truncated]`
}

// ===== MINIMAL AGENT/DOMAIN CONFIG =====

function buildHeadlessAgent(opts: {
  tools: AgentToolDefinition[]
  prompt: string
}): AgentDefinition {
  return {
    name: 'headless-agent',
    tools: opts.tools,
    maxIterations: 10,
    async buildMessages(state: AgentState): Promise<Message[]> {
      const filtered = state.messages.filter((m) => m.role !== 'system')
      const wire = sessionMessagesToWire(filtered)
      // Replace the synthetic "begin headless run" user message with the real
      // prompt — the engine requires a user message to kick off, but the model
      // shouldn't see our internal kickoff string.
      if (wire.length > 0 && wire[0]?.role === 'user') {
        wire[0] = { role: 'user', content: opts.prompt }
      }
      const systemPrompt = `${HEADLESS_SYSTEM_PROMPT_ADDITION}\n\n${opts.prompt}`
      return [{ role: 'system', content: systemPrompt }, ...wire]
    },
    async processResult(_c, _tc, state) {
      return state
    },
  }
}

function buildHeadlessDomainConfig(opts: {
  agent: AgentDefinition
  model: string
  provider: string
}): AgentDomainConfig {
  return {
    type: 'kopilot',
    agents: { 'headless-agent': opts.agent },
    routes: [{ name: 'default', agents: ['headless-agent'] }],
    createInitialState: () => ({}),
    defaultModel: opts.model,
    defaultProvider: opts.provider,
  }
}
