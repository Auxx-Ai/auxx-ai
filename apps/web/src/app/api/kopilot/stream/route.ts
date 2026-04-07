// apps/web/src/app/api/kopilot/stream/route.ts

import path from 'node:path'
import { database as db } from '@auxx/database'
import { type UsageTrackingRequest, UsageTrackingService } from '@auxx/lib/ai'
import {
  AgentEngine,
  type AgentEngineConfig,
  type AgentEvent,
  createCallModel,
  enqueueAgentJob,
  subscribeToAgentEvents,
} from '@auxx/lib/ai/agent-framework'
import {
  createCapabilityRegistry,
  createEntityCapabilities,
  createKnowledgeCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  generateSessionTitle,
} from '@auxx/lib/ai/kopilot'
import { createToolDepsFactory } from '@auxx/lib/ai/kopilot/capabilities'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { withRunLog } from '@auxx/logger/run-log'
import {
  createSession,
  getSessionById,
  saveSessionMessages,
  updateSessionDomainState,
  updateSessionTitle,
} from '@auxx/services'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('kopilot-stream')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface KopilotStreamRequest {
  sessionId?: string
  message: string
  type?: 'message' | 'approval'
  page?: string
  context?: Record<string, unknown>
  /** Approval action — required when type is 'approval' */
  approvalAction?: 'approve' | 'reject'
  /** Input amendment for approval actions (e.g. { saveAsDraft: true }) */
  inputAmendment?: Record<string, unknown>
  /** Model override in "provider:model" format — omit to use system default */
  modelId?: string
}

/**
 * Whether to dispatch this request to the BullMQ worker.
 * Currently always in-process — enable worker dispatch by setting USE_AGENT_WORKER=true.
 */
function shouldUseWorker(): boolean {
  return process.env.USE_AGENT_WORKER === 'true'
}

/**
 * POST /api/kopilot/stream
 *
 * SSE endpoint for Kopilot agent interactions.
 * Supports two modes:
 * - In-process: runs the AgentEngine directly and streams events
 * - Worker: dispatches to BullMQ, subscribes to Redis pub/sub for events
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const organizationId = (session.user as any).defaultOrganizationId as string
  const userId = session.user.id

  if (!organizationId) {
    return new Response('Organization required', { status: 400 })
  }

  // Feature gate: check Kopilot access on the org's plan
  const hasKopilot = await new FeaturePermissionService().hasAccess(
    organizationId,
    FeatureKey.kopilot
  )
  if (!hasKopilot) {
    return new Response('Kopilot is not available on your plan', { status: 403 })
  }

  let body: KopilotStreamRequest
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!body.message || typeof body.message !== 'string') {
    return new Response('Message is required', { status: 400 })
  }

  const { message, type = 'message', page, context } = body

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (event: AgentEvent | { type: string; [key: string]: unknown }) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          )
        } catch (error) {
          logger.error('Failed to send SSE event', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      let heartbeatInterval: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }
        try {
          controller.close()
        } catch {
          // Controller might already be closed
        }
      }

      // Start heartbeat
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          cleanup()
        }
      }, 15000)

      try {
        // 1. Resolve or create session
        let sessionId = body.sessionId
        let isNewSession = false
        let savedMessages: Record<string, unknown>[] = []
        let savedDomainState: Record<string, unknown> = {}

        if (sessionId) {
          const sessionResult = await getSessionById({ sessionId, organizationId })
          if (sessionResult.isErr()) {
            send({ type: 'error', error: sessionResult.error.message })
            cleanup()
            return
          }
          savedMessages = (sessionResult.value.messages ?? []) as Record<string, unknown>[]
          savedDomainState = (sessionResult.value.domainState ?? {}) as Record<string, unknown>
        } else {
          const createResult = await createSession({
            organizationId,
            userId,
            type: 'kopilot',
            title: message.slice(0, 100),
          })
          if (createResult.isErr()) {
            send({ type: 'error', error: createResult.error.message })
            cleanup()
            return
          }
          sessionId = createResult.value.id
          isNewSession = true
          send({ type: 'session-created', sessionId })
        }

        const runPath = shouldUseWorker()
          ? () =>
              runWorkerPath({
                sessionId,
                organizationId,
                userId,
                message,
                type,
                page,
                context,
                approvalAction: body.approvalAction,
                inputAmendment: body.inputAmendment,
                modelId: body.modelId,
                send,
                cleanup,
                request,
              })
          : () =>
              runInProcessPath({
                sessionId,
                organizationId,
                userId,
                message,
                type,
                page,
                context,
                approvalAction: body.approvalAction,
                inputAmendment: body.inputAmendment,
                modelId: body.modelId,
                savedMessages,
                savedDomainState,
                send,
                request,
                isNewSession,
              })

        // Dev only: tee all logs to a per-session file
        if (process.env.NODE_ENV === 'development') {
          const logFile = path.join(
            process.cwd(),
            '.logs',
            'agent-sessions',
            sessionId,
            `${Date.now()}.log`
          )
          await withRunLog(sessionId, logFile, runPath)
        } else {
          await runPath()
        }

        // Send terminal event
        send({ type: 'done' })
      } catch (error) {
        logger.error('Kopilot stream error', {
          error: error instanceof Error ? error.message : String(error),
        })
        send({
          type: 'pipeline-error',
          error: error instanceof Error ? error.message : 'Internal server error',
        })
      } finally {
        cleanup()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ── In-process engine execution ──

async function runInProcessPath(params: {
  sessionId: string
  organizationId: string
  userId: string
  message: string
  type: 'message' | 'approval'
  page?: string
  context?: Record<string, unknown>
  approvalAction?: 'approve' | 'reject'
  inputAmendment?: Record<string, unknown>
  modelId?: string
  savedMessages: Record<string, unknown>[]
  savedDomainState: Record<string, unknown>
  send: (event: AgentEvent | { type: string; [key: string]: unknown }) => void
  request: NextRequest
  isNewSession: boolean
}) {
  const {
    sessionId,
    organizationId,
    userId,
    message,
    type,
    page,
    context,
    approvalAction,
    inputAmendment,
    modelId,
    savedMessages,
    savedDomainState,
    send,
    request,
    isNewSession,
  } = params

  // Build domain config with capabilities
  const getToolDeps = createToolDepsFactory({
    organizationId,
    userId,
    sessionId,
    signal: request.signal,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getToolDeps))
  registry.register(createKnowledgeCapabilities(getToolDeps))
  registry.register(createMailCapabilities(getToolDeps))

  // Resolve model: explicit override → system default → hardcoded fallback
  let defaultModel: string | undefined
  let defaultProvider: string | undefined
  if (modelId) {
    const [provider, ...modelParts] = modelId.split(':')
    defaultProvider = provider
    defaultModel = modelParts.join(':')
  } else {
    const { SystemModelService } = await import('@auxx/lib/ai')
    const { ModelType } = await import('@auxx/lib/ai/providers/types')
    const systemModelService = new SystemModelService(db, organizationId)
    const systemDefault = await systemModelService.getDefault(ModelType.LLM)
    if (systemDefault) {
      defaultProvider = systemDefault.provider
      defaultModel = systemDefault.model
    }
  }

  const domainConfig = createKopilotDomainConfig({
    capabilityRegistry: registry,
    page: page ?? 'mail',
    defaultModel,
    defaultProvider,
  })

  // Create LLM adapter
  const callModel = createCallModel({
    organizationId,
    userId,
    source: 'kopilot',
    sourceId: sessionId,
  })

  const engineConfig: AgentEngineConfig = {
    organizationId,
    userId,
    sessionId,
    domainConfig,
    callModel,
    signal: request.signal,
  }

  // Create engine with restored state (including approval state if paused)
  const initialState =
    savedMessages.length > 0
      ? {
          messages: savedMessages as any[],
          domainState: savedDomainState,
          waitingForApproval: savedDomainState._waitingForApproval as boolean | undefined,
          pendingToolCall: savedDomainState._pendingToolCall as any,
          currentRoute: savedDomainState._currentRoute as string | undefined,
        }
      : undefined

  const engine = new AgentEngine(engineConfig, initialState)

  // Handle client disconnect
  request.signal.addEventListener('abort', () => {
    logger.info('Client disconnected from Kopilot SSE', { sessionId })
    engine.interrupt()
  })

  // Build session context from request
  const sessionContext = { page, ...context }

  // Run the engine
  const generator =
    type === 'approval'
      ? engine.resume({
          action: approvalAction ?? 'approve',
          inputAmendment,
          context: sessionContext,
        })
      : engine.submitMessage(message, sessionContext)

  const usageEntries: UsageTrackingRequest[] = []

  for await (const event of generator) {
    if (request.signal.aborted) break

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
        creditsUsed: event.providerType === 'SYSTEM' ? 1 : 0,
      })
    }

    send(event)
  }

  // Persist state — stash approval fields inside domainState so they survive reload
  const finalState = engine.getState()
  const domainStateToSave = {
    ...(finalState.domainState as Record<string, unknown>),
    _waitingForApproval: finalState.waitingForApproval ?? false,
    _pendingToolCall: finalState.pendingToolCall ?? null,
    _currentRoute: finalState.currentRoute ?? null,
  }
  await saveSessionMessages({
    sessionId,
    organizationId,
    messages: finalState.messages as unknown as Record<string, unknown>[],
  })
  await updateSessionDomainState({
    sessionId,
    organizationId,
    domainState: domainStateToSave,
  })

  // Batch usage tracking
  if (usageEntries.length > 0) {
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

  // Auto-title new sessions after first exchange
  if (isNewSession) {
    generateSessionTitle(message, { organizationId, userId, db })
      .then((title) => updateSessionTitle({ sessionId, organizationId, title }))
      .catch((err) => logger.warn('Session auto-title failed', { sessionId, error: String(err) }))
  }
}

// ── Worker dispatch path ──

async function runWorkerPath(params: {
  sessionId: string
  organizationId: string
  userId: string
  message: string
  type: 'message' | 'approval'
  page?: string
  context?: Record<string, unknown>
  approvalAction?: 'approve' | 'reject'
  inputAmendment?: Record<string, unknown>
  modelId?: string
  send: (event: AgentEvent | { type: string; [key: string]: unknown }) => void
  cleanup: () => void
  request: NextRequest
}) {
  const { sessionId, organizationId, userId, message, type, page, context, send, request } = params

  // 1. Subscribe to Redis events BEFORE enqueuing to avoid race conditions.
  // Use a promise to detect terminal events and close the stream.
  let resolveCompletion: () => void
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const { handlerId, router } = await subscribeToAgentEvents(sessionId, (event) => {
    send(event)
    if (
      event.type === 'done' ||
      event.type === 'pipeline-error' ||
      event.type === 'pipeline-completed'
    ) {
      resolveCompletion()
    }
  })

  // Handle client disconnect
  request.signal.addEventListener('abort', () => {
    logger.info('Client disconnected during worker dispatch', { sessionId })
    resolveCompletion()
  })

  // 2. Enqueue the job
  await enqueueAgentJob({
    sessionId,
    organizationId,
    userId,
    message,
    type,
    domain: 'kopilot',
    page,
    context: context as Record<string, unknown>,
    approvalAction: params.approvalAction,
    inputAmendment: params.inputAmendment,
    modelId: params.modelId,
  })

  // 3. Wait for terminal event or disconnect
  await completionPromise

  // 4. Cleanup subscription
  try {
    await router.unsubscribe(handlerId)
  } catch {
    // Best effort
  }
}
