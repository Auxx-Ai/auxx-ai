// apps/web/src/app/api/kopilot/stream/route.ts

import { database as db } from '@auxx/database'
import {
  buildDmTriggerContext,
  filterToolsByToolsets,
  resolveAgentConfig,
  resolveAgentKnowledgeScope,
} from '@auxx/lib/agents'
import {
  type AgentDomainConfig,
  AgentEngine,
  type AgentEngineConfig,
  type AgentEvent,
  cleanDomainStateForModelSwitch,
  createCallModel,
  enqueueAgentJob,
  flattenMessagesForModelSwitch,
  resolveAgentRunCapabilities,
  subscribeToAgentEvents,
  withAgentRunLog,
} from '@auxx/lib/ai/agent-framework'
import type { SessionContext, TriggerContext } from '@auxx/lib/ai/kopilot'
import {
  createActorCapabilities,
  createAgentsBuilderCapabilities,
  createAppCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKbCapabilities,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createKopilotCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  createRecordViewCapabilities,
  createSuggestRepliesGlobalCapability,
  createTaskCapabilities,
  createWorkflowBuilderCapabilities,
  findRef,
  generateSessionTitle,
  KOPILOT_TURN_BUDGET,
  LAST_CONTEXT_KEY,
  LAST_PAGE_KEY,
  resolveContinuationSurface,
  WORKFLOW_BUILDER_PAGE,
} from '@auxx/lib/ai/kopilot'
import {
  createLearnedKbCapabilities,
  createToolDepsFactory,
} from '@auxx/lib/ai/kopilot/capabilities'
import { createMcpCapabilities } from '@auxx/lib/ai/mcp'
import { getCachedAgentById } from '@auxx/lib/cache'
import { AuxxError, ForbiddenError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
import {
  type CapabilityView,
  FeatureKey,
  FeaturePermissionService,
  getCapabilities,
  PermissionKey,
} from '@auxx/lib/permissions'
import { docToText } from '@auxx/lib/tiptap'
import { createScopedLogger } from '@auxx/logger'
import {
  createSession,
  getSessionById,
  saveSessionMessages,
  updateSessionDomainState,
  updateSessionModelId,
  updateSessionTitle,
} from '@auxx/services'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { resolveTaskNotification } from './task-notification'

const logger = createScopedLogger('kopilot-stream')

interface SessionRefLike {
  kind?: string
  id?: string
  origin?: string
}

/**
 * Convert the DM trigger's Tiptap instructions doc into plain text for the
 * system prompt. Mirrors the worker-path conversion in
 * `process-agent-job.ts:resolveTriggerContext` but kept inline to avoid
 * pulling the heavier reference-resolver dependency on every DM send.
 *
 * `AgentTrigger.instructions` is a jsonb column declared as a Tiptap doc, but
 * jsonb can hold a bare string, so the plain-string case stays handled — the
 * parameter type says so instead of the guard narrowing to `never`.
 */
function renderDmInstructions(
  instructions: Record<string, unknown> | string | null
): string | null {
  if (!instructions) return null
  if (typeof instructions === 'string') {
    return instructions.length > 0 ? instructions : null
  }
  const text = docToText(instructions, {})
  return text.length > 0 ? text : null
}

/**
 * Whether the caller may run a turn that targets a user-authored agent.
 * Returns `null` when allowed, or the denial message when not.
 *
 * **This closes a live authorization hole.** Until 2026-07-27 this route
 * authenticated with `auth.api.getSession` alone and read no capabilities at
 * all, while every `agent.*` tRPC procedure requires
 * {@link PermissionKey.agentsManage}. `agentId` arrives verbatim on the request
 * body, so any authenticated member could POST an arbitrary agent id and chat
 * with an agent they cannot see in the UI — including the DM path, whose only
 * agent-side check (`buildDmTriggerContext`) tests the org-wide `dmEnabled`
 * toggle, not the caller.
 *
 * Three gates, and the id-aware one is the point (permissions v2 item 4, plan
 * 25 §4.2 — the TODO that used to sit here is DONE):
 *
 *  1. the {@link FeatureKey.agents} plan-AND (the route's existing
 *     {@link FeatureKey.kopilot} gate does not cover the agents feature);
 *  2. the coarse {@link PermissionKey.agentsView} rung. This used to be
 *     `agentsManage`, because `Area.agents` had no lower rung to aim at.
 *     Chatting with an agent is USING it, not authoring it, so Read is the
 *     correct front door now that the area has one;
 *  3. per-agent instance access on the RESOLVED agent id. `agentId` arrives
 *     verbatim on the request body, so it goes through
 *     {@link assertAgentAccess} — which resolves id-or-slug to a real
 *     `Agent.id` first. Asserting the raw value would find no `ResourceAccess`
 *     row for a slug, fall through to the area level, and hand over a
 *     restricted agent.
 *
 * **Denials are returned, never thrown.** App Router route handlers have no
 * `auxxErrorMiddleware`, so an escaping `AuxxError` surfaces as a 500 rather
 * than the 403 the caller must see. Every `AuxxError` from the resolve+assert
 * is collapsed into the same message on purpose: a restricted agent, an
 * archived one and an id from another org are then indistinguishable, so this
 * endpoint cannot be used to enumerate the org's agents. Anything that is not
 * an `AuxxError` is a genuine fault and rethrows.
 *
 * **Extend this function — do not add a second gate elsewhere.**
 */
async function resolveAgentAccessDenial(params: {
  organizationId: string
  userId: string
  agentId: string
}): Promise<string | null> {
  const { organizationId, userId, agentId } = params
  const hasAgents = await new FeaturePermissionService().hasAccess(
    organizationId,
    FeatureKey.agents
  )
  if (!hasAgents) return 'Agents are not available on your plan'

  const capabilities = await getCapabilities(userId, organizationId)
  if (!capabilities.can(PermissionKey.agentsView)) {
    return 'You do not have access to this agent'
  }

  try {
    await assertAgentAccess({ capabilities, organizationId, idOrSlug: agentId, tier: 'view' })
  } catch (error) {
    if (error instanceof AuxxError) return 'You do not have access to this agent'
    throw error
  }
  return null
}

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
  /** Input amendment for approval actions (e.g. { mode: 'draft' }) */
  inputAmendment?: Record<string, unknown>
  /** Model override in "provider:model" format — omit to use system default */
  modelId?: string
  /** Target a user-authored agent on session create; ignored on existing sessions. */
  agentId?: string | null
  /**
   * Session-domain discriminator for newly-created sessions. 'builder' is used
   * when the agent detail page hosts the chat; 'kopilot' is the default.
   * Ignored when sessionId is provided (existing session keeps its type).
   */
  sessionType?: 'kopilot' | 'builder'
  /**
   * Agent Chat-tab test-run flag: resolve the agent's UNPUBLISHED draft config
   * instead of the active version (build-plan §4.2). Honored only for admins
   * (agent-edit permission) on a non-builder agent session — silently ignored
   * otherwise, so a non-admin DMing the agent can't probe unpublished config.
   * Per-request, never sticky: no session row stores it.
   */
  useDraft?: boolean
  /**
   * Trigger discriminator for the run. 'dm' means the request originated
   * from the agent Chat tab or the composer sender picker; the route
   * resolves the agent's `dm` AgentTrigger gating (enabled? instructions?)
   * and layers the DM trigger-instructions slot into the system prompt.
   */
  triggerKind?: 'dm'
  /**
   * Async-task continuation (plans/kopilot/task-notifications/plan.md). When
   * set, `task` is required, the session must exist, and the route rewrites
   * `message` from DB truth via the kind handler — the client is a trigger,
   * never the source of result data.
   */
  origin?: 'task-notification'
  /** The watched task this notification is for. Required with `origin`. */
  task?: { kind: string; ref: string }
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

  // Agent authorization, first half: a NEW session binds `body.agentId`
  // verbatim, so refuse before `createSession` writes a row pointing at an
  // agent the caller can't reach — and as plain HTTP, before the stream opens.
  // `agentId` is documented as ignored on existing sessions, so a stale value
  // from the client must not deny a turn it has no effect on; the resolved id
  // is authorized separately below. Plain Kopilot (no agent) skips this
  // entirely.
  if (!body.sessionId && body.agentId) {
    const denial = await resolveAgentAccessDenial({
      organizationId,
      userId,
      agentId: body.agentId,
    })
    if (denial) return new Response(denial, { status: 403 })
  }

  // Async-task continuation: validate, dedupe, and rewrite the body from DB
  // truth BEFORE the stream opens, so failures are plain HTTP, not SSE.
  let taskNotificationMetadata: Record<string, unknown> | undefined
  if (body.origin === 'task-notification') {
    if ((body.type ?? 'message') !== 'message') {
      return new Response('Task notifications must use type "message"', { status: 400 })
    }
    const resolved = await resolveTaskNotification({
      sessionId: body.sessionId,
      task: body.task,
      organizationId,
    })
    if (!resolved.ok) {
      return new Response(resolved.error, { status: resolved.status })
    }
    if (resolved.deduped) {
      // Another tab already delivered this notification — idempotent no-op.
      // Shaped as a one-event SSE stream so the client's normal turn pipeline
      // (which POSTed expecting an event stream) completes cleanly.
      return new Response('event: done\ndata: {"type":"done","deduped":true}\n\n', {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }
    body.message = resolved.message
    taskNotificationMetadata = resolved.metadata
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
        let storedModelId: string | null = null
        let sessionAgentId: string | null = null
        let sessionType: 'kopilot' | 'builder' = 'kopilot'
        let resolvedPage: string | undefined = page
        let resolvedContext: Record<string, unknown> | undefined = context
        // Computed when body.triggerKind === 'dm'. Threaded to the engine so the
        // system prompt's trigger-instructions slot renders. Gate is re-run on
        // every send so disabling DM mid-thread surfaces a 403.
        let inProcessTriggerContext: TriggerContext | undefined

        if (sessionId) {
          const sessionResult = await getSessionById({ sessionId, organizationId })
          if (sessionResult.isErr()) {
            send({ type: 'error', error: sessionResult.error.message })
            cleanup()
            return
          }
          savedMessages = (sessionResult.value.messages ?? []) as Record<string, unknown>[]
          savedDomainState = (sessionResult.value.domainState ?? {}) as Record<string, unknown>
          storedModelId = sessionResult.value.modelId ?? null
          sessionAgentId = sessionResult.value.agentId ?? null
          sessionType = (sessionResult.value.type ?? 'kopilot') as 'kopilot' | 'builder'

          // Continuation turns (approval resumes, task-notification drains)
          // arrive without `page`/`context` — the originating surface isn't on
          // screen. Restore it from the persisted state so the toolset is
          // rebuilt the same way the proposing turn had it; otherwise resume
          // can't find the page-scoped tool it paused on and the turn wedges.
          // Request values always win; this fallback never applies to a fresh
          // page-less message (which must keep getting __global__ tools only).
          const isContinuation = type === 'approval' || body.origin === 'task-notification'
          const surface = resolveContinuationSurface({
            requestPage: resolvedPage,
            requestContext: resolvedContext,
            isContinuation,
            domainState: savedDomainState,
          })
          resolvedPage = surface.page
          resolvedContext = surface.context
        } else {
          const placeholderTitle = message.slice(0, 100)
          sessionAgentId = body.agentId ?? null
          sessionType = body.sessionType ?? 'kopilot'

          // DM sessions get tagged with the dm AgentTrigger + a triggerContext
          // payload so the worker path (`resolveTriggerContext`) can recover
          // the DM kind on subsequent sends without re-reading the agent.
          let createAgentTriggerId: string | null = null
          let createTriggerContext: Record<string, unknown> | null = null
          if (body.triggerKind === 'dm' && sessionType !== 'builder' && sessionAgentId) {
            const cachedAgent = await getCachedAgentById(organizationId, sessionAgentId)
            if (!cachedAgent) {
              send({ type: 'turn-error', error: 'Agent not found', code: 'not_found' })
              cleanup()
              return
            }
            try {
              const dm = buildDmTriggerContext({ agent: cachedAgent })
              createAgentTriggerId = dm.triggerContext.triggerId
              createTriggerContext = {
                kind: dm.triggerContext.kind,
                firedAt: dm.triggerContext.firedAt,
              }
              inProcessTriggerContext = {
                kind: 'dm',
                instructions: renderDmInstructions(dm.triggerInstructions),
                payload: { firedAt: dm.triggerContext.firedAt },
              }
              resolvedPage = 'agents.dm'
            } catch (err) {
              if (err instanceof ForbiddenError) {
                send({ type: 'turn-error', error: err.message, code: 'forbidden' })
                cleanup()
                return
              }
              throw err
            }
          }

          // Workflow-builder threads are scoped to the workflow they were
          // started from, so the builder panel resolves its own thread instead
          // of whatever the global Kopilot was last on. The id comes from the
          // pinned session ref rather than a body field: every graph tool
          // already refuses without it (`NO_WORKFLOW_REF_ERROR`), so that ref
          // is the one source of truth. Tagged at create only — like `agentId`,
          // an existing global thread is never retroactively adopted.
          const createWorkflowAppId =
            resolvedPage === WORKFLOW_BUILDER_PAGE
              ? (findRef((resolvedContext ?? {}) as SessionContext, 'workflow')?.id ?? null)
              : null

          const createResult = await createSession({
            organizationId,
            userId,
            type: sessionType,
            title: placeholderTitle,
            agentId: sessionAgentId,
            agentTriggerId: createAgentTriggerId,
            workflowAppId: createWorkflowAppId,
            triggerContext: createTriggerContext,
          })
          if (createResult.isErr()) {
            send({ type: 'error', error: createResult.error.message })
            cleanup()
            return
          }
          sessionId = createResult.value.id
          isNewSession = true
          send({
            type: 'session-created',
            sessionId,
            sessionType: createResult.value.type,
            title: placeholderTitle,
            createdAt: createResult.value.createdAt.toISOString(),
          })
        }

        // Agent authorization, second half — the one that matters on turn 2.
        // `sessionAgentId` is restored from the SESSION ROW on continuation
        // turns, not from the body, so authorizing only the body-supplied id
        // would let every turn after the first sail through on a session whose
        // agent the caller can't access (including one bound before their
        // profile was tightened). Authorize the RESOLVED id on every turn.
        //
        // Builder sessions are included on purpose: their agent is the subject
        // of editing, and `view` is the floor for touching it at all (the
        // authoring tools re-assert Edit/Full for themselves). Sessions with no
        // agent (plain Kopilot) read no capabilities at all.
        if (sessionAgentId) {
          const denial = await resolveAgentAccessDenial({
            organizationId,
            userId,
            agentId: sessionAgentId,
          })
          if (denial) {
            send({ type: 'turn-error', error: denial, code: 'forbidden' })
            cleanup()
            return
          }
        }

        // Existing-session DM gate: re-resolve the cached agent on every send
        // so disabling DM mid-thread surfaces a fresh 403, not a stale OK.
        // Builder sessions can never carry a DM trigger — their agentConfig is
        // forced to the master sentinel (agentId null), which `buildKopilotPrompt`
        // rejects alongside a triggerContext. A `dm` flag on a builder session is
        // always a stale-client artifact; drop it and run a normal builder turn.
        if (
          body.triggerKind === 'dm' &&
          sessionType !== 'builder' &&
          sessionAgentId &&
          !inProcessTriggerContext
        ) {
          const cachedAgent = await getCachedAgentById(organizationId, sessionAgentId)
          if (!cachedAgent) {
            send({ type: 'turn-error', error: 'Agent not found', code: 'not_found' })
            cleanup()
            return
          }
          try {
            const dm = buildDmTriggerContext({ agent: cachedAgent })
            inProcessTriggerContext = {
              kind: 'dm',
              instructions: renderDmInstructions(dm.triggerInstructions),
              payload: { firedAt: dm.triggerContext.firedAt },
            }
            resolvedPage = 'agents.dm'
          } catch (err) {
            if (err instanceof ForbiddenError) {
              send({ type: 'turn-error', error: err.message, code: 'forbidden' })
              cleanup()
              return
            }
            throw err
          }
        }

        logger.info('Kopilot turn context', {
          sessionId,
          page: resolvedPage,
          references: (
            resolvedContext as { references?: SessionRefLike[] } | undefined
          )?.references?.map((r) => ({
            kind: r?.kind,
            id: r?.id,
            origin: r?.origin,
            label: (r as { label?: string } | undefined)?.label ?? null,
          })),
        })

        // Task-notification turns always run in-process: the worker job path
        // doesn't carry the user-message metadata stamp yet, and without it
        // the server-side dedupe (metadata scan) breaks. Revisit with §E
        // (worker-side delivery).
        const useWorkerPath = shouldUseWorker() && body.origin !== 'task-notification'
        const runPath = useWorkerPath
          ? () =>
              runWorkerPath({
                sessionId,
                organizationId,
                userId,
                message,
                type,
                page: resolvedPage,
                context: resolvedContext,
                approvalAction: body.approvalAction,
                inputAmendment: body.inputAmendment,
                // Fall back to the session's stamped model so a continuing
                // conversation stays on the model it started on — the worker
                // resolves an absent modelId to the org default, same as the
                // in-process path.
                modelId: body.modelId ?? storedModelId ?? undefined,
                agentId: sessionAgentId,
                sessionType,
                triggerKind: body.triggerKind,
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
                page: resolvedPage,
                context: resolvedContext,
                approvalAction: body.approvalAction,
                inputAmendment: body.inputAmendment,
                modelId: body.modelId,
                agentId: sessionAgentId,
                sessionType,
                useDraft: body.useDraft,
                triggerContext: inProcessTriggerContext,
                savedMessages,
                savedDomainState,
                storedModelId,
                userMessageMetadata: taskNotificationMetadata,
                send,
                request,
                isNewSession,
              })

        // Dev only: tee agent-relevant logs to a per-session file.
        if (process.env.NODE_ENV !== 'production') {
          await withAgentRunLog(sessionId, runPath)
        } else {
          await runPath()
        }

        // KB turn lifecycle (lock release on success, auto-revert on error)
        // now runs inside the engine's onTurnEnd hook — for both the
        // in-process and worker paths. The route no longer owns it.
        send({ type: 'done' })
      } catch (error) {
        logger.error('Kopilot stream error', {
          error: error instanceof Error ? error.message : String(error),
        })
        const errName = error instanceof Error ? error.name : ''
        const isQuotaExhaustion = errName === 'QuotaExceededError'
        const isRateLimited = errName === 'UsageLimitError' || errName === 'RateLimitError'
        send({
          type: 'turn-error',
          error: error instanceof Error ? error.message : 'Internal server error',
          code: isQuotaExhaustion
            ? 'quota_exhausted'
            : isRateLimited
              ? 'rate_limited'
              : 'internal_error',
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
  agentId: string | null
  sessionType: 'kopilot' | 'builder'
  /** Resolve the agent's draft config instead of the active version (admin-gated below). */
  useDraft?: boolean
  triggerContext?: TriggerContext
  savedMessages: Record<string, unknown>[]
  savedDomainState: Record<string, unknown>
  storedModelId: string | null
  /** Stamped onto the persisted user message (task-notification origin markers). */
  userMessageMetadata?: Record<string, unknown>
  send: (event: AgentEvent | { type: string; [key: string]: unknown }) => void
  request: NextRequest
  isNewSession: boolean
}) {
  let {
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
    agentId,
    sessionType,
    triggerContext,
    savedMessages,
    savedDomainState,
    storedModelId,
    userMessageMetadata,
    send,
    request,
    isNewSession,
  } = params

  const isBuilder = sessionType === 'builder'

  // Kick off LLM title generation in parallel with the engine turn so its
  // latency overlaps. The result is awaited + persisted + emitted at the end.
  // Errors are swallowed here — a title failure must not block the turn.
  const titlePromise: Promise<string | null> = isNewSession
    ? generateSessionTitle(message, { organizationId, userId, db }).catch((err) => {
        logger.warn('Session auto-title failed', { sessionId, error: String(err) })
        return null
      })
    : Promise.resolve(null)

  // Builder sessions run as master Kopilot with the agents-builder persona
  // addition — the target agent is the subject of editing (passed via the
  // `agent` active reference), not the persona to adopt. Passing its real
  // agentConfig would render two competing "You are X." personas.
  // Draft test-runs (build-plan §4.2): the agent Chat tab may request the
  // unpublished draft view, but only for admins (agent-edit permission) and never
  // for master/builder sessions. Per-request — nothing here is persisted.
  //
  // Resolved BEFORE capabilities (doc 19 §15) so behavior and authorization come
  // from the SAME view: a draft test-run must be authorized by the draft profile,
  // and a production turn by the published version's snapshot. Reading config from
  // one view and permissions from the other would make the Chat tab lie about what
  // the agent will be allowed to do once published.
  let agentConfigSource: 'active' | 'draft' = 'active'
  if (params.useDraft && !isBuilder && agentId) {
    const isAdmin = await isAdminOrOwner(organizationId, userId, db)
    if (isAdmin) agentConfigSource = 'draft'
  }

  // Build domain config with capabilities. `userId` is the logged-in member, so
  // resolve read/write enforcement (v2 §3) once per turn and share it across
  // every tool AND the prompt-side catalogs (§3.4).
  //
  // Plain Kopilot and the builder are the human alone (§0.11) — no agent
  // principal is involved. A turn targeting a defined agent intersects the
  // human with the agent's **published permission policy** (doc 19 §2.3), so an
  // agent restriction clamps the turn even though a human is driving it, and the
  // human's own authority clamps it in the other direction (§0.5). A broken
  // run-as delegation throws `AgentRunAsUnavailableError`, which the caller's
  // catch surfaces as a normal `turn-error`.
  const humanCapabilities = await getCapabilities(userId, organizationId)
  let capabilities: CapabilityView = humanCapabilities
  if (agentId && !isBuilder) {
    const cachedAgent = await getCachedAgentById(organizationId, agentId)
    if (cachedAgent) {
      capabilities =
        (await resolveAgentRunCapabilities({
          agent: cachedAgent,
          organizationId,
          invokerUserId: userId,
          source: agentConfigSource,
        })) ?? humanCapabilities
    }
  }

  const agentConfig = await resolveAgentConfig(organizationId, isBuilder ? null : agentId, db, {
    source: agentConfigSource,
  })

  // Resolve once per turn (§1.1) — shared by the tool deps (read gate) below
  // and the domain config (prompt-side catalog filtering) further down.
  // Builder sessions resolve `agentConfig` off the master sentinel (`[]`
  // knowledge), so this naturally comes back `null` (unrestricted) for the
  // builder Kopilot even though a real `agentId` is in scope for the session.
  const knowledgeScope = await resolveAgentKnowledgeScope({
    db,
    organizationId,
    entries: agentConfig.knowledge,
    capabilities,
  })

  const getToolDeps = createToolDepsFactory({
    organizationId,
    userId,
    sessionId,
    signal: request.signal,
    sessionContext: { ...(context ?? {}), page },
    capabilities,
    knowledgeScope,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getToolDeps))
  registry.register(createKnowledgeCapabilities(getToolDeps))
  registry.register(createMailCapabilities(getToolDeps))
  registry.register(createActorCapabilities(getToolDeps))
  registry.register(createTaskCapabilities(getToolDeps))
  registry.register(createKopilotCapabilities(getToolDeps))
  registry.register(createKbReadCapabilities(getToolDeps))
  registry.register(createKbCapabilities(getToolDeps))
  registry.register(createRecordViewCapabilities(getToolDeps))
  registry.register(createSuggestRepliesGlobalCapability(getToolDeps))
  // Defence in depth: `page` arrives on the request body, so on its own it must
  // never unlock a privileged tool set. Agent authoring is OWNER/ADMIN-only
  // (plan 19 §6, doc 14 §0.9) and every builder tool re-asserts that itself via
  // `resolveAgentAuthoring` — this keeps the meta-tools from even being built or
  // advertised to a plain member who POSTs `page: 'agents.builder'`. The page
  // that hosts this chat (`/app/agents/[slug]`) is already `isAdminOrOwner`-gated
  // client-side, so no legitimate session loses tools here.
  if (page === 'agents.builder' && (await isAdminOrOwner(organizationId, userId, db))) {
    registry.register(await createAgentsBuilderCapabilities(getToolDeps, organizationId))
  }
  // Workflow-builder graph tools (plans/kopilot/workflow/04 §5). Unlike
  // agents-builder there is no admin gate here: workflow authoring is
  // per-workflow instance access, not an org rank, and every tool re-asserts
  // the full ladder itself (`resolveWorkflowAuthoring` — fail-closed on absent
  // capabilities, `workflowsView` area rung, org scope, per-instance
  // view/edit, system-owned lockdown, dirty gate). `page` therefore only
  // decides whether the tools are built and advertised, exactly like the
  // page-gated registration above.
  if (page === WORKFLOW_BUILDER_PAGE) {
    registry.register(createWorkflowBuilderCapabilities(getToolDeps))
  }
  // Explicit "remember this" door into the AI memory (learned KB). The tool is
  // approval-gated in-chat; the flag keeps the whole AI-memory feature per-org.
  if (await new FeaturePermissionService().hasAccess(organizationId, FeatureKey.learnedMemory)) {
    registry.register(createLearnedKbCapabilities(getToolDeps))
  }
  // App-backed AI tools (plans/kopilot/apps/README.md §7).
  // Async — bridge pulls the org-cache `installedApps` row and runs
  // per-tool user-scope presence checks (decision C1 / G2).
  registry.register(
    await createAppCapabilities({
      organizationId,
      userId,
      agentId: isBuilder ? null : agentId,
      triggerId: null,
      sessionId,
      getToolDeps,
    })
  )
  // MCP-backed tools (plans/mcp). Interactive chat → not autonomous.
  registry.register(await createMcpCapabilities({ organizationId, autonomous: false }))

  // Resolve model: for approvals, always reuse the stored modelId — approvals
  // continue an in-flight turn whose pending tool call was generated by that
  // model. For new messages: explicit override → the session's stamped model →
  // system default. The session stamp is what makes a conversation stick to the
  // model it started on: without it, every turn re-derives the org default, so
  // changing that default silently switches models mid-session. An explicit
  // override still wins and re-stamps the session (see the switch check below).
  // Builder sessions pin BUILDER_MODEL and ignore both the request override
  // and the org's system default.
  let defaultModel: string | undefined
  let defaultProvider: string | undefined
  if (isBuilder) {
    const { BUILDER_MODEL } = await import('@auxx/lib/ai/agent-framework')
    defaultProvider = BUILDER_MODEL.provider
    defaultModel = BUILDER_MODEL.model
  } else if (type === 'approval' && storedModelId) {
    const [provider, ...modelParts] = storedModelId.split(':')
    defaultProvider = provider
    defaultModel = modelParts.join(':')
  } else if (modelId) {
    const [provider, ...modelParts] = modelId.split(':')
    defaultProvider = provider
    defaultModel = modelParts.join(':')
  } else if (storedModelId) {
    const [provider, ...modelParts] = storedModelId.split(':')
    defaultProvider = provider
    defaultModel = modelParts.join(':')
  } else {
    const { getCachedDefaultModel } = await import('@auxx/lib/cache')
    const { ModelType } = await import('@auxx/lib/ai/providers/types')
    const systemDefault = await getCachedDefaultModel(organizationId, ModelType.LLM)
    if (systemDefault) {
      defaultProvider = systemDefault.provider
      defaultModel = systemDefault.model
    }
  }

  // Compute resolved model ID for session tracking
  const resolvedModelId =
    defaultProvider && defaultModel ? `${defaultProvider}:${defaultModel}` : null

  // Detect model switch on existing sessions, stamp modelId on new sessions.
  // Skipped for approval requests so we don't tear down the paused turn's
  // pending tool call before resume() can read it.
  if (resolvedModelId && type !== 'approval') {
    if (!isNewSession) {
      if (storedModelId && storedModelId !== resolvedModelId) {
        // Model switch detected — flatten history for the new model
        logger.info('Model switch detected, flattening history', {
          sessionId,
          from: storedModelId,
          to: resolvedModelId,
        })
        savedMessages = flattenMessagesForModelSwitch(savedMessages as any) as any
        savedDomainState = cleanDomainStateForModelSwitch(savedDomainState)

        // Persist flattened state and new modelId
        await Promise.all([
          updateSessionModelId({ sessionId, organizationId, modelId: resolvedModelId }),
          saveSessionMessages({
            sessionId,
            organizationId,
            messages: savedMessages,
          }),
          updateSessionDomainState({ sessionId, organizationId, domainState: savedDomainState }),
        ])
      } else if (!storedModelId) {
        // Backfill: old session had no modelId — stamp it now
        await updateSessionModelId({ sessionId, organizationId, modelId: resolvedModelId })
      }
    } else {
      // New session — stamp with modelId
      await updateSessionModelId({ sessionId, organizationId, modelId: resolvedModelId })
    }
  }

  const resolvedPage = page ?? '__none__'
  // Pre-filter tools by the agent's enabled toolsets before handing them to
  // the domain config. Master sessions pass through untouched. Future filter
  // predicates (invoker-scope, approval-mode) compose at this seam.
  const filteredTools = filterToolsByToolsets(registry.getTools(resolvedPage), agentConfig)

  const domainConfig = createKopilotDomainConfig({
    capabilityRegistry: registry,
    // Surfaces that don't pass an explicit `page` get only `__global__`
    // tools — no page-scoped surface defaults silently. Mail callers
    // always send `page: 'mail'`.
    page: resolvedPage,
    tools: filteredTools,
    defaultModel,
    defaultProvider,
    maxIterations: 30,
    agentConfig,
    // In-app Kopilot/builder renders to the rich in-app surface for a workspace
    // member (incl. DM triggers — a member is still the reader/author).
    surface: 'builder',
    audience: 'member',
    triggerContext,
    // Prompt-side catalog filtering (§3.4) — the same view the tools enforce with.
    capabilities,
    // The agent's retrieval scope (§1.1) — narrows the Knowledge Catalog to
    // what this agent may actually search. `null` for builder sessions (which
    // resolve `agentConfig` off the master sentinel, not the edited agent) and
    // for master Kopilot, matching today's unrestricted behavior.
    knowledgeScope,
  })

  // Create LLM adapter
  const callModel = createCallModel({
    organizationId,
    userId,
    source: isBuilder ? 'builder' : 'kopilot',
    sourceId: sessionId,
    forceSystem: isBuilder,
  })

  const engineConfig: AgentEngineConfig = {
    organizationId,
    userId,
    sessionId,
    db,
    // The engine treats domain state as opaque `Record<string, unknown>`, but
    // `AgentDomainConfig` is contravariant in its state generic (`buildMessages`
    // and friends take `AgentState<T>` as a parameter) — so the concrete
    // `AgentDomainConfig<KopilotDomainState>` is not assignable to the default.
    // Widen at this single boundary, the same conversion `buildChatEngineConfig`
    // and `buildEffectiveAgentRuntime` already perform — this call site was
    // simply the one that never got it.
    //
    // Kept local rather than relaxing `AgentEngineConfig.domainConfig` itself to
    // `AgentDomainConfig<any>`: that would push an `any` into a widely-exported
    // interface to spare three call sites a cast.
    domainConfig: domainConfig as unknown as AgentDomainConfig,
    callModel,
    signal: request.signal,
    ...KOPILOT_TURN_BUDGET,
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

  // Build session context from request.
  //
  // `page` LAST, deliberately: it is the server's `resolvedPage`, which is what
  // the toolset was actually resolved from (see the `registry.getTools` call and
  // the tool-deps `sessionContext` above, which already order it this way). The
  // client also sends its surface page inside `context`, and on the DM path
  // `resolvedPage` is forced to `agents.dm` — so letting `context.page` win here
  // told the model it was on one page while it held another page's tools, and it
  // then reported the missing tools to the user as a broken connection.
  const sessionContext = { ...context, page }

  // Run the engine
  const generator =
    type === 'approval'
      ? engine.resume({
          action: approvalAction ?? 'approve',
          inputAmendment,
          context: sessionContext,
        })
      : engine.submitMessage(
          message,
          sessionContext,
          userMessageMetadata ? { metadata: userMessageMetadata } : undefined
        )

  // No usage drain here: `createCallModel` bills each LLM call as it completes
  // (`ai/agent-framework/llm-adapter.ts`), which also covers the turns this loop
  // abandons on `request.signal.aborted`. Draining `event.iterations` for
  // billing again would double-charge.
  for await (const event of generator) {
    if (request.signal.aborted) break
    send(event)
  }

  // Persist state — stash approval fields inside domainState so they survive reload
  const finalState = engine.getState()
  const domainStateToSave = {
    ...(finalState.domainState as Record<string, unknown>),
    _waitingForApproval: finalState.waitingForApproval ?? false,
    _pendingToolCall: finalState.pendingToolCall ?? null,
    _currentRoute: finalState.currentRoute ?? null,
    // Stash the surface this turn ran with so the next continuation (approval
    // resume / task-notification drain) can restore page + references and
    // rebuild the same toolset. See resolveContinuationSurface.
    [LAST_PAGE_KEY]: page ?? null,
    [LAST_CONTEXT_KEY]: context ?? null,
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

  // Auto-title new sessions after first exchange. The promise was kicked off at
  // the top of this function so its latency overlaps with the engine run.
  if (isNewSession) {
    try {
      const title = await titlePromise
      if (title && !request.signal.aborted) {
        await updateSessionTitle({ sessionId, organizationId, title })
        send({ type: 'session-title-updated', sessionId, title })
      }
    } catch (err) {
      logger.warn('Session auto-title persist failed', { sessionId, error: String(err) })
    }
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
  agentId: string | null
  sessionType: 'kopilot' | 'builder'
  /**
   * Set when the request originated from the agent Chat tab or composer
   * sender picker. The worker re-resolves the trigger context from the
   * session's `agentTriggerId` (set at session-create time for DM); this
   * field is forwarded mainly for downstream analytics / future routing.
   */
  triggerKind?: 'dm'
  send: (event: AgentEvent | { type: string; [key: string]: unknown }) => void
  cleanup: () => void
  request: NextRequest
}) {
  const {
    sessionId,
    organizationId,
    userId,
    message,
    type,
    page,
    context,
    sessionType,
    send,
    request,
  } = params

  // TODO: Add model-switch detection when worker path is enabled
  // TODO(kopilot-worker-title): the worker path does not emit `session-created`
  // with a placeholder title or run `generateSessionTitle` + `session-title-updated`.
  // When USE_AGENT_WORKER is enabled, move title generation into the worker job
  // (post-engine) and publish `session-title-updated` onto the same Redis channel
  // that `subscribeToAgentEvents` consumes, so the SSE bridge forwards it.

  // 1. Subscribe to Redis events BEFORE enqueuing to avoid race conditions.
  // Use a promise to detect terminal events and close the stream.
  let resolveCompletion: () => void
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const { handlerId, router } = await subscribeToAgentEvents(sessionId, (event) => {
    send(event)
    if (event.type === 'done' || event.type === 'turn-error' || event.type === 'turn-completed') {
      resolveCompletion()
    }
  })

  // Handle client disconnect
  request.signal.addEventListener('abort', () => {
    logger.info('Client disconnected during worker dispatch', { sessionId })
    resolveCompletion()
  })

  // 2. Enqueue the job. The worker reads `agentTriggerId` off the session
  // row (set at session-create time for DM), so the job payload doesn't
  // need to carry the trigger id explicitly — `triggerKind` is forwarded
  // for analytics and future routing only.
  await enqueueAgentJob({
    sessionId,
    organizationId,
    userId,
    message,
    type,
    domain: sessionType === 'builder' ? 'builder' : 'kopilot',
    page,
    context: context as Record<string, unknown>,
    approvalAction: params.approvalAction,
    inputAmendment: params.inputAmendment,
    modelId: params.modelId,
    agentId: params.agentId,
    triggerKind: params.triggerKind,
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
