// packages/lib/src/ai/agent-framework/process-agent-job.ts

import path from 'node:path'
import { createScopedLogger } from '@auxx/logger'
import { withRunLog } from '@auxx/logger/run-log'
import { getSessionById, saveSessionMessages, updateSessionDomainState } from '@auxx/services'
import type { JobContext } from '../../jobs/types'
import {
  createCapabilityRegistry,
  createEntityCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  createToolDepsFactory,
} from '../kopilot'
import { AgentEngine } from './engine'
import type { AgentJobPayload } from './enqueue-agent-job'
import { createAgentEventPublisher } from './event-publisher'
import { createCallModel } from './llm-adapter'
import type { AgentEngineConfig, SessionMessage } from './types'

const logger = createScopedLogger('process-agent-job')

/**
 * BullMQ job handler for processing agent messages.
 * Runs the AgentEngine and publishes events to Redis for SSE relay.
 */
export async function processAgentMessage(ctx: JobContext<AgentJobPayload>) {
  const { data, signal } = ctx
  const { sessionId, organizationId, userId, message, type, domain, page, context } = data

  logger.info('Processing agent message', { sessionId, domain, type })

  const run = () => processAgentMessageInternal(ctx)

  // Dev only: tee all logs to a per-session file
  if (process.env.NODE_ENV === 'development') {
    const logFile = path.join(
      process.cwd(),
      '.logs',
      'agent-sessions',
      sessionId,
      `${Date.now()}.log`
    )
    return withRunLog(sessionId, logFile, run)
  }

  return run()
}

async function processAgentMessageInternal(ctx: JobContext<AgentJobPayload>) {
  const { data, signal } = ctx
  const { sessionId, organizationId, userId, message, type, domain, page, context } = data

  // 1. Load session from DB
  const sessionResult = await getSessionById({ sessionId, organizationId })
  if (sessionResult.isErr()) {
    throw new Error(`Session not found: ${sessionResult.error.message}`)
  }
  const session = sessionResult.value

  // 2. Build domain config based on domain type
  const domainConfig = buildDomainConfig(domain, {
    organizationId,
    userId,
    sessionId,
    page,
    context,
    signal,
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
    domainConfig,
    callModel,
    signal,
  }

  const engine = new AgentEngine(engineConfig, {
    messages: (session.messages ?? []) as SessionMessage[],
    domainState: (session.domainState ?? {}) as Record<string, unknown>,
  })

  // 5. Create event publisher
  const publisher = createAgentEventPublisher(sessionId)

  // 6. Run engine and publish events
  const sessionContext = { page, ...(context ?? {}) }

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
    await publisher.publish(event)
  }

  // 7. Save final state to DB
  const finalState = engine.getState()
  await saveSessionMessages({
    sessionId,
    organizationId,
    messages: finalState.messages as Record<string, unknown>[],
  })
  await updateSessionDomainState({
    sessionId,
    organizationId,
    domainState: finalState.domainState as Record<string, unknown>,
  })

  // 8. Publish terminal event
  await publisher.publish({ type: 'done' })

  logger.info('Agent message processed', { sessionId, domain })
}

/**
 * Build the appropriate domain config based on the session type.
 */
function buildDomainConfig(
  domain: string,
  params: {
    organizationId: string
    userId: string
    sessionId: string
    page?: string
    context?: Record<string, unknown>
    signal?: AbortSignal
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

      return createKopilotDomainConfig({
        capabilityRegistry: registry,
        page: params.page,
      })
    }
    default:
      throw new Error(`Unknown agent domain: ${domain}`)
  }
}
