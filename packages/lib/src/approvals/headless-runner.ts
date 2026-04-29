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
import type { Message } from '../ai/clients/base/types'
import {
  createActorCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
  type GetToolDeps,
} from '../ai/kopilot/capabilities'
import { enrichEntitiesWithFieldValues } from '../ai/kopilot/capabilities/entities/enrich-entity-fields'
import { createSubmitFinalAnswerTool } from '../ai/kopilot/meta-tools/submit-final-answer'
import { findCachedResource } from '../cache/org-cache-helpers'
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
/** The single "soft" tool today — its result is durable (a Draft) and gets recorded as a ranDuringCapture action. */
const SOFT_TOOL_NAMES = new Set(['draft_reply'])

const HEADLESS_SYSTEM_PROMPT_ADDITION = `You are running in headless suggestion mode. Propose 0..N actions for the human to triage. You may use read-only tools (search, list, query) to gather context. For broad context on a record, prefer a single \`get_entity_history\` call over assembling the same data from \`find_threads\` + \`list_notes\` + \`list_tasks\` separately. \`draft_reply\` will create a draft (the user reviews it before sending). Other mutation tools will be queued for human approval — they do not execute immediately, but you will see a predicted output (e.g. a \`temp_<n>\` id) so you can chain dependent actions. Plan all actions up front; results from queued mutations are predictions only, not real state. End with a single line: \`[summary] <≤ 12 words>\` if you proposed actions, or \`[noop] <reason>\` if no action is appropriate. Limit yourself to 5 read-tool calls.`

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
 *   minted by the tool's `captureMint`. The single soft tool (`draft_reply`)
 *   runs for real and lands as a `ranDuringCapture` action.
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

  // 2. Build the capability registry. Kopilot's existing capability factories
  // close over a `getDeps` factory for their db handle — give them one keyed
  // off the headless trace so logs / audit lookups can find this run.
  const getDeps: GetToolDeps = () => ({
    db: deps.db,
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    sessionId: headlessTraceId,
    signal: undefined,
    turnId: headlessTraceId,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getDeps))
  registry.register(createKnowledgeCapabilities(getDeps))
  registry.register(createMailCapabilities(getDeps))
  registry.register(createActorCapabilities(getDeps))
  registry.register(createTaskCapabilities(getDeps))
  const tools = registry.getTools('mail')

  // 3. Build the prompt — entity fields, tasks, sanitized event payload.
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

  // 4. Wire the engine in capture mode with a custom one-shot agent.
  const [provider, ...modelParts] = input.modelId.split(':')
  const model = modelParts.join(':')
  if (!provider || !model) {
    return Result.error(new Error(`Invalid modelId "${input.modelId}" (expected "provider:model")`))
  }

  // Soft-tool side channel: capture draft_reply's real result via a tool wrapper
  // (cheaper than rewalking state.messages after the run).
  const softActions: ProposedAction[] = []
  const wrappedTools = tools.map((t) => wrapSoftTool(t, softActions))
  const submitFinalAnswer = createSubmitFinalAnswerTool()
  const agentTools: AgentToolDefinition[] = wrappedTools.some(
    (t) => t.name === submitFinalAnswer.name
  )
    ? wrappedTools
    : [...wrappedTools, submitFinalAnswer]

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
      if (event.type === 'final-message') {
        finalText = event.content
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

  // 5. Merge soft actions (draft_reply) with captured actions (everything
  // else). Re-index `localIndex` so it's monotonic across the merged list.
  const state = engine.getState()
  const captured = state.capturedActions ?? []
  const actions = mergeActions(softActions, captured)

  // 6. Parse [summary] / [noop] line from final text.
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
 * Wrap a tool so that when `draft_reply` (or any future soft tool) succeeds,
 * we record its real output as a `ProposedAction` with `ranDuringCapture` set.
 * The wrapper preserves the original execute return so the engine sees the
 * normal tool result and the model can chain on `draftId`.
 */
function wrapSoftTool(tool: AgentToolDefinition, sink: ProposedAction[]): AgentToolDefinition {
  if (!SOFT_TOOL_NAMES.has(tool.name)) return tool
  return {
    ...tool,
    execute: async (args, ctx) => {
      const result = await tool.execute(args, ctx)
      if (result.success) {
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
  if (toolName === 'draft_reply') {
    const body = typeof args.body === 'string' ? args.body : ''
    const trimmed = body.replace(/\s+/g, ' ').trim().slice(0, 60)
    return `Reply: "${trimmed}${body.length > 60 ? '…' : ''}"`
  }
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
      const messages: Message[] = state.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          const msg: Message = {
            role: m.role as 'user' | 'assistant' | 'tool',
            content: m.content,
          }
          if (m.toolCallId) msg.tool_call_id = m.toolCallId
          if (m.role === 'assistant' && m.toolCalls?.length) {
            msg.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }))
          }
          return msg
        })
      const systemPrompt = `${HEADLESS_SYSTEM_PROMPT_ADDITION}\n\n${opts.prompt}`
      // Replace the synthetic "begin headless run" user message with the real
      // prompt — the engine requires a user message to kick off, but the model
      // shouldn't see our internal kickoff string.
      if (messages.length > 0 && messages[0]?.role === 'user') {
        messages[0] = { role: 'user', content: opts.prompt }
      }
      return [{ role: 'system', content: systemPrompt }, ...messages]
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
