// packages/lib/src/ai/agent-framework/process-agent-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getSessionById, saveSessionMessages, updateSessionDomainState } from '@auxx/services'
import { and, eq } from 'drizzle-orm'
import {
  filterToolsByToolsets,
  getOrgToolCatalog,
  getOrgToolsetCatalog,
  resolveAgentConfig,
} from '../../agents'
import type { JobContext } from '../../jobs/types'
import { docToText } from '../../tiptap'
import {
  createAppCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKopilotCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  createToolDepsFactory,
} from '../kopilot'
import { buildInstructionReferenceResolver } from '../kopilot/prompts/resolve-instruction-references'
import type { TriggerContext, TriggerKind } from '../kopilot/prompts/trigger-context'
import type { UsageTrackingRequest } from '../orchestrator/types'
import { getModelCreditMultiplier } from '../quota/credit-multiplier'
import { UsageTrackingService } from '../usage/usage-tracking-service'
import { BUILDER_MODEL } from './builder-model'
import { AgentEngine } from './engine'
import type { AgentJobPayload } from './enqueue-agent-job'
import { createAgentEventPublisher } from './event-publisher'
import { createCallModel } from './llm-adapter'
import { withAgentRunLog } from './run-log'
import type { AgentEngineConfig, SessionMessage } from './types'

const logger = createScopedLogger('agent-job')

/**
 * BullMQ job handler for processing agent messages.
 * Runs the AgentEngine and publishes events to Redis for SSE relay.
 */
export async function processAgentMessage(ctx: JobContext<AgentJobPayload>) {
  const { data } = ctx
  const { sessionId, domain, type } = data

  logger.info('Processing agent message', { sessionId, domain, type })

  const run = async () => {
    try {
      return await processAgentMessageInternal(ctx)
    } catch (err) {
      if (data.agentTriggerId) {
        try {
          const { AgentTriggerService } = await import('../../agents/agent-trigger-service')
          await new AgentTriggerService().recordError(
            data.agentTriggerId,
            err instanceof Error ? err.message : String(err)
          )
        } catch (recordErr) {
          logger.warn('Failed to record agent trigger error', {
            agentTriggerId: data.agentTriggerId,
            error: recordErr instanceof Error ? recordErr.message : String(recordErr),
          })
        }
      }
      throw err
    }
  }

  // Dev only: tee agent-relevant logs to a per-session file. Gated on
  // `!== 'production'` so the worker dev script (which doesn't set NODE_ENV)
  // still gets traces — same convention as `apps/worker/src/server.ts`.
  if (process.env.NODE_ENV !== 'production') {
    return withAgentRunLog(sessionId, run)
  }

  return run()
}

async function processAgentMessageInternal(ctx: JobContext<AgentJobPayload>) {
  const { data, signal } = ctx
  const { sessionId, organizationId, userId, message, type, domain, page, context, modelId } = data

  // 1. Load session from DB
  const sessionResult = await getSessionById({ sessionId, organizationId })
  if (sessionResult.isErr()) {
    throw new Error(`Session not found: ${sessionResult.error.message}`)
  }
  const session = sessionResult.value

  // Prefer the agentId persisted on the session row; the job payload's
  // `agentId` is only authoritative on the very first turn before the row
  // is read back.
  const agentId = session.agentId ?? data.agentId ?? null

  // 1b. Resolve trigger context for autonomous runs. The trigger row is
  // re-fetched (not passed via the job payload) so operator edits to
  // `instructions` between enqueue and execution are picked up.
  const triggerContext = await resolveTriggerContext({
    organizationId,
    agentTriggerId: session.agentTriggerId ?? data.agentTriggerId ?? null,
    sessionTriggerContext: session.triggerContext as Record<string, unknown> | null,
  })

  // 2. Build domain config based on domain type
  const domainConfig = await buildDomainConfig(domain, {
    organizationId,
    userId,
    sessionId,
    page,
    context,
    signal,
    modelId,
    agentId,
    triggerContext,
  })

  // 3. Create LLM adapter
  const callModel = createCallModel({
    organizationId,
    userId,
    source: domain,
    sourceId: sessionId,
    forceSystem: domain === 'builder',
  })

  // 4. Create engine with saved state
  const engineConfig: AgentEngineConfig = {
    organizationId,
    userId,
    sessionId,
    db: database,
    domainConfig,
    callModel,
    signal,
    // Kopilot domain: long-running plans routinely chain >5 approvals
    // (one per ticket reply, etc.) and need iteration headroom for plan
    // step churn. Other domains stay on framework defaults.
    ...(domain === 'kopilot' ? { maxTotalIterations: 100, maxApprovalsPerTurn: 50 } : {}),
    ...(data.approvalMode ? { approvalMode: data.approvalMode } : {}),
  }

  const engine = new AgentEngine(engineConfig, {
    messages: (session.messages ?? []) as SessionMessage[],
    domainState: (session.domainState ?? {}) as Record<string, unknown>,
  })

  // 5. Create event publisher
  const publisher = createAgentEventPublisher(sessionId)

  // 6. Run engine and publish events
  const sessionContext = { page, ...(context ?? {}) }
  const usageEntries: UsageTrackingRequest[] = []

  const generator =
    type === 'approval'
      ? engine.resume({
          action: data.approvalAction ?? 'approve',
          inputAmendment: data.inputAmendment,
          context: sessionContext,
        })
      : engine.submitMessage(message, sessionContext)

  for await (const event of generator) {
    if (signal?.aborted) {
      engine.interrupt()
      break
    }

    // Per-LLM-call billing breakdown lives on `event.iterations` (one entry
    // per agent iteration). Iterate to push one usage record per call with
    // correct SYSTEM-vs-CUSTOM credit gating — BYOK customers consume no
    // credits. Drain on both `paused` and `finished`: pre-pause iterations
    // ride on `paused`, post-resume iterations on `finished`. Each event
    // carries only segment-fresh iterations so no double-billing.
    if (
      (event.type === 'assistant-message-finished' || event.type === 'assistant-message-paused') &&
      event.iterations?.length
    ) {
      for (const it of event.iterations) {
        usageEntries.push({
          organizationId,
          userId,
          provider: it.provider,
          model: it.model,
          usage: it.usage,
          timestamp: new Date(),
          source: 'agent',
          sourceId: sessionId,
          providerType: it.providerType,
          credentialSource: it.credentialSource,
          creditsUsed:
            it.providerType === 'SYSTEM' ? getModelCreditMultiplier(it.provider, it.model) : 0,
        })
      }
    }

    await publisher.publish(event)
  }

  // 7. Save final state to DB. Strip `thinking` parts on stored messages
  // except the most recent one — reasoning is turn-specific and the cached
  // tail is enough for the next iteration to chain off.
  const finalState = engine.getState()
  const messagesForStorage = stripStaleThinkingForStorage(finalState.messages)
  await saveSessionMessages({
    sessionId,
    organizationId,
    messages: messagesForStorage as unknown as Record<string, unknown>[],
  })
  await updateSessionDomainState({
    sessionId,
    organizationId,
    domainState: finalState.domainState as Record<string, unknown>,
  })

  // 8. Batch usage tracking
  if (usageEntries.length > 0) {
    logger.info('Tracking agent usage batch', {
      sessionId,
      entries: usageEntries.length,
      totalTokens: usageEntries.reduce((sum, e) => sum + (e.usage.total_tokens || 0), 0),
    })
    try {
      const usageService = new UsageTrackingService()
      await usageService.trackUsageBatch(usageEntries)
    } catch (err) {
      logger.error('Failed to track usage batch', {
        sessionId,
        entries: usageEntries.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 9. Publish terminal event
  await publisher.publish({ type: 'done' })

  // 10. If this run was kicked off by a trigger, record a fire on the row.
  if (data.agentTriggerId) {
    try {
      const { AgentTriggerService } = await import('../../agents/agent-trigger-service')
      await new AgentTriggerService().recordFire(data.agentTriggerId)
    } catch (err) {
      logger.warn('Failed to record agent trigger fire', {
        agentTriggerId: data.agentTriggerId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('Agent message processed', { sessionId, domain })
}

/**
 * Build the appropriate domain config based on the session type.
 */
async function buildDomainConfig(
  domain: string,
  params: {
    organizationId: string
    userId: string
    sessionId: string
    page?: string
    context?: Record<string, unknown>
    signal?: AbortSignal
    modelId?: string
    agentId: string | null
    triggerContext: TriggerContext | undefined
  }
) {
  switch (domain) {
    case 'kopilot': {
      // Resolve model: explicit override → system default → hardcoded fallback
      let defaultModel: string | undefined
      let defaultProvider: string | undefined
      if (params.modelId) {
        const [provider, ...modelParts] = params.modelId.split(':')
        defaultProvider = provider
        defaultModel = modelParts.join(':')
      } else {
        const { getCachedDefaultModel } = await import('../../cache/org-cache-helpers')
        const { ModelType } = await import('../providers/types')
        const systemDefault = await getCachedDefaultModel(params.organizationId, ModelType.LLM)
        if (systemDefault) {
          defaultProvider = systemDefault.provider
          defaultModel = systemDefault.model
        }
      }

      return buildKopilotShapedConfig(params, {
        provider: defaultProvider,
        model: defaultModel,
      })
    }
    case 'builder': {
      // Builder pins BUILDER_MODEL and ignores params.modelId — paired with
      // forceSystem on the call-model side so SYSTEM credentials are used
      // regardless of the org's provider-type preference.
      return buildKopilotShapedConfig(params, {
        provider: BUILDER_MODEL.provider,
        model: BUILDER_MODEL.model,
      })
    }
    default:
      throw new Error(`Unknown agent domain: ${domain}`)
  }
}

async function buildKopilotShapedConfig(
  params: {
    organizationId: string
    userId: string
    sessionId: string
    page?: string
    signal?: AbortSignal
    agentId: string | null
    triggerContext: TriggerContext | undefined
  },
  defaults: { provider: string | undefined; model: string | undefined }
) {
  const getToolDeps = createToolDepsFactory({
    organizationId: params.organizationId,
    userId: params.userId,
    sessionId: params.sessionId,
    signal: params.signal,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getToolDeps))
  registry.register(createMailCapabilities(getToolDeps))
  registry.register(createKopilotCapabilities(getToolDeps))
  registry.register(
    await createAppCapabilities({
      organizationId: params.organizationId,
      // Background agent jobs run autonomously — no human in the loop.
      // User-scope tools are hidden by the bridge (decision A2).
      userId: null,
      agentId: params.agentId,
      triggerId: null,
      sessionId: params.sessionId,
      getToolDeps,
    })
  )

  const agentConfig = await resolveAgentConfig(params.organizationId, params.agentId)
  const resolvedPage = params.page ?? '__none__'
  const filteredTools = filterToolsByToolsets(registry.getTools(resolvedPage), agentConfig)

  return createKopilotDomainConfig({
    capabilityRegistry: registry,
    page: resolvedPage,
    tools: filteredTools,
    defaultModel: defaults.model,
    defaultProvider: defaults.provider,
    agentConfig,
    triggerContext: params.triggerContext,
    // Long-running plans (≥30 steps × ~1–2 LLM rounds each) need
    // headroom past the framework's small-loop default.
    maxIterations: 30,
  })
}

/**
 * Re-loads the AgentTrigger row when the session was kicked off by a trigger
 * and shapes a `TriggerContext` for the prompt builder. Returns undefined for
 * chat runs (no trigger) so the prompt renders identically to today.
 */
async function resolveTriggerContext(params: {
  organizationId: string
  agentTriggerId: string | null | undefined
  sessionTriggerContext: Record<string, unknown> | null
}): Promise<TriggerContext | undefined> {
  const { organizationId, agentTriggerId, sessionTriggerContext } = params
  if (!agentTriggerId) return undefined

  const [trigger] = await database
    .select({
      kind: schema.AgentTrigger.kind,
      instructions: schema.AgentTrigger.instructions,
    })
    .from(schema.AgentTrigger)
    .where(
      and(
        eq(schema.AgentTrigger.id, agentTriggerId),
        eq(schema.AgentTrigger.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!trigger) return undefined

  // The session's triggerContext JSONB carries the `kind` discriminator and
  // the kind-specific payload (e.g. `commentId`, `parentRecordId` for mention).
  // Falling back to `trigger.kind` keeps the renderer working even if the
  // session row was created without a triggerContext (legacy / forward-compat).
  const payload = sessionTriggerContext ?? {}
  const kind = (asKind(payload.kind) ?? asKind(trigger.kind)) as TriggerKind | null
  if (!kind) return undefined

  const [toolCatalog, toolsetCatalog] = await Promise.all([
    getOrgToolCatalog(organizationId),
    getOrgToolsetCatalog(organizationId),
  ])
  const references = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })
  const instructions = renderInstructionsAsText(trigger.instructions, references)

  return { kind, instructions, payload }
}

function renderInstructionsAsText(
  instructions: Record<string, unknown> | null | undefined,
  references: (id: string) => string
): string | null {
  if (!instructions) return null
  if (typeof instructions === 'string') return instructions.length > 0 ? instructions : null
  const text = docToText(instructions, { references })
  return text.length > 0 ? text : null
}

function asKind(value: unknown): TriggerKind | null {
  if (value === 'scheduled' || value === 'event' || value === 'app') return value
  if (value === 'mention' || value === 'assignment') return value
  return null
}

/**
 * Strip `thinking` parts on every assistant message except the most recent
 * with thinking. Cuts persisted storage size — reasoning is turn-specific
 * and the tail is enough for the next iteration's chain-of-thought to land.
 */
function stripStaleThinkingForStorage(messages: SessionMessage[]): SessionMessage[] {
  const lastIdx = messages.findLastIndex(
    (m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'thinking')
  )
  if (lastIdx === -1) return messages
  return messages.map((m, i) => {
    if (i >= lastIdx || m.role !== 'assistant') return m
    if (!m.parts.some((p) => p.type === 'thinking')) return m
    return { ...m, parts: m.parts.filter((p) => p.type !== 'thinking') }
  })
}
