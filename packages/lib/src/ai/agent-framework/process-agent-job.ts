// packages/lib/src/ai/agent-framework/process-agent-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getSessionById, saveSessionMessages, updateSessionDomainState } from '@auxx/services'
import { filterToolsByToolsets, resolveAgentConfig } from '../../agents'
import type { JobContext } from '../../jobs/types'
import {
  createCapabilityRegistry,
  createEntityCapabilities,
  createKopilotCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  createToolDepsFactory,
} from '../kopilot'
import type { UsageTrackingRequest } from '../orchestrator/types'
import { getModelCreditMultiplier } from '../quota/credit-multiplier'
import { UsageTrackingService } from '../usage/usage-tracking-service'
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
  const { data, signal } = ctx
  const { sessionId, organizationId, userId, message, type, domain, page, context } = data

  logger.info('Processing agent message', { sessionId, domain, type })

  const run = () => processAgentMessageInternal(ctx)

  // Dev only: tee agent-relevant logs to a per-session file
  if (process.env.NODE_ENV === 'development') {
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
  })

  // 3. Create LLM adapter
  const callModel = createCallModel({
    organizationId,
    userId,
    source: domain,
    sourceId: sessionId,
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

    // Accumulate usage from LLM completions for batch tracking
    if (event.type === 'llm-complete') {
      usageEntries.push({
        organizationId,
        userId,
        provider: event.provider,
        model: event.model,
        usage: event.usage,
        timestamp: new Date(),
        source: 'agent',
        sourceId: sessionId,
        providerType: event.providerType as 'SYSTEM' | 'CUSTOM' | undefined,
        credentialSource: event.credentialSource as
          | 'SYSTEM'
          | 'CUSTOM'
          | 'MODEL_SPECIFIC'
          | 'LOAD_BALANCED'
          | undefined,
        creditsUsed:
          event.providerType === 'SYSTEM'
            ? getModelCreditMultiplier(event.provider, event.model)
            : 0,
      })
    }

    await publisher.publish(event)
  }

  // 7. Save final state to DB — strip reasoning_content to avoid bloating storage.
  // It's ephemeral (only needed within the current tool-calling cycle) and providers
  // re-strip or re-generate it on subsequent API calls anyway.
  const finalState = engine.getState()
  const messagesForStorage = finalState.messages.map((m) => {
    if (m.reasoning_content) {
      const { reasoning_content, ...rest } = m
      return rest
    }
    return m
  })
  await saveSessionMessages({
    sessionId,
    organizationId,
    messages: messagesForStorage as Record<string, unknown>[],
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
  }
) {
  switch (domain) {
    case 'kopilot': {
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

      const agentConfig = await resolveAgentConfig(params.organizationId, params.agentId)
      const resolvedPage = params.page ?? '__none__'
      const filteredTools = filterToolsByToolsets(registry.getTools(resolvedPage), agentConfig)

      return createKopilotDomainConfig({
        capabilityRegistry: registry,
        page: resolvedPage,
        tools: filteredTools,
        defaultModel,
        defaultProvider,
        agentConfig,
        // Long-running plans (≥30 steps × ~1–2 LLM rounds each) need
        // headroom past the framework's small-loop default.
        maxIterations: 30,
      })
    }
    default:
      throw new Error(`Unknown agent domain: ${domain}`)
  }
}
