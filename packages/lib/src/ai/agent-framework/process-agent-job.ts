// packages/lib/src/ai/agent-framework/process-agent-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getSessionById, saveSessionMessages, updateSessionDomainState } from '@auxx/services'
import { and, eq } from 'drizzle-orm'
import { getOrgToolCatalog, getOrgToolsetCatalog } from '../../agents'
import {
  type ConversationMessage,
  runProcedureTurn,
  sessionMessagesToConversation,
} from '../../agents/procedures'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../../jobs/types'
import { docToText } from '../../tiptap'
import { buildInstructionReferenceResolver } from '../kopilot/prompts/resolve-instruction-references'
import type { TriggerContext, TriggerKind } from '../kopilot/prompts/trigger-context'
import type { UsageTrackingRequest } from '../orchestrator/types'
import { UsageTrackingService } from '../usage/usage-tracking-service'
import { resolveAgentRunCapabilities } from './agent-run-capabilities'
import { KopilotContextStore, readContextSlice } from './context'
import { type AgentRuntimeDomain, buildEffectiveAgentRuntime } from './effective-runtime'
import { AgentEngine } from './engine'
import type { AgentJobPayload } from './enqueue-agent-job'
import { createAgentEventPublisher } from './event-publisher'
import { createCallModel } from './llm-adapter'
import { withAgentRunLog } from './run-log'
import type { Subject, ToolContext } from './tool-context'
import type { AgentEngineConfig, AgentEvent, SessionMessage } from './types'

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

  // The `messages` column is untyped `Record<string, unknown>[]` jsonb. The engine is
  // its only writer, so the stored rows ARE `SessionMessage`s — but the two shapes do
  // not overlap enough for a direct assertion, hence the hop through `unknown`.
  const sessionMessages = (session.messages ?? []) as unknown as SessionMessage[]

  // Prefer the agentId persisted on the session row; the job payload's
  // `agentId` is only authoritative on the very first turn before the row
  // is read back.
  const agentId = session.agentId ?? data.agentId ?? null

  // v9 procedures: load the agent's projected procedures (org-cache). Only
  // agent-bound runs can carry procedures; master/builder runs (no agentId)
  // project to none. `[]` for an agent with no published procedures.
  const agent = agentId ? await getCachedAgentById(organizationId, agentId) : null
  const procedures = agent?.procedures ?? []
  const hasProcedures = procedures.length > 0

  // Capability layer v2 §3.1: the run's read/write enforcement — the agent's own
  // profile (or its run-as delegate), intersected with the invoking human on
  // mention/assignment/DM runs. Master Kopilot job runs (`agentId === null`) have
  // no agent principal, so they stay `undefined` (unrestricted, as today).
  // A broken run-as delegation throws here and fails the run loudly (§0.6).
  const capabilities = agent
    ? await resolveAgentRunCapabilities({
        agent,
        organizationId,
        invokerUserId: data.invokerUserId,
      })
    : undefined

  // 1b. Resolve trigger context for autonomous runs. The trigger row is
  // re-fetched (not passed via the job payload) so operator edits to
  // `instructions` between enqueue and execution are picked up.
  const triggerContext = await resolveTriggerContext({
    organizationId,
    agentTriggerId: session.agentTriggerId ?? data.agentTriggerId ?? null,
    sessionTriggerContext: session.triggerContext as Record<string, unknown> | null,
  })

  // 2. Build the effective agent runtime (model precedence, capability registry,
  // toolset-filtered + binding-projected tools, domain config, and binding
  // clamp) — the shared builder used by both this job and the eval Simulation
  // engine, so there is no divergent second copy.
  if (domain !== 'kopilot' && domain !== 'builder') {
    throw new Error(`Unknown agent domain: ${domain}`)
  }
  const runtime = await buildEffectiveAgentRuntime({
    organizationId,
    userId,
    sessionId,
    agentId,
    domain: domain as AgentRuntimeDomain,
    signal,
    modelId,
    // Mount the procedure control tools when this agent has procedures (inert
    // without an active step in the prompt — same gating as the chat path).
    hasProcedures,
    page,
    triggerContext,
    capabilities,
  })
  const { domainConfig, agentConfig } = runtime

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
    // Clamp tool args per the effective bindings (override ?? author-default).
    // Internal turns carry no subject, so `var` bindings resolve to nothing and
    // the input falls through to the model; a `const` override still applies.
    // No-op for master Kopilot (no tools declare bindings + empty overrides).
    // See plans/chat/v8 phase-4.
    applyToolRestrictions: runtime.applyToolRestrictions,
    // Kopilot domain: long-running plans routinely chain >5 approvals
    // (one per ticket reply, etc.) and need iteration headroom for plan
    // step churn. Other domains stay on framework defaults.
    ...(domain === 'kopilot' ? { maxTotalIterations: 100, maxApprovalsPerTurn: 50 } : {}),
    ...(data.approvalMode ? { approvalMode: data.approvalMode } : {}),
  }

  const engine = new AgentEngine(engineConfig, {
    messages: sessionMessages,
    domainState: (session.domainState ?? {}) as Record<string, unknown>,
  })

  // 5. Create event publisher
  const publisher = createAgentEventPublisher(sessionId)

  // 6. Run engine and publish events.
  // `page` last — it is the page the toolset was resolved from, and it must win
  // over any stale `context.page` the caller carried in. See the matching order
  // in `apps/web/src/app/api/kopilot/stream/route.ts`.
  const sessionContext = { ...(context ?? {}), page }
  const usageEntries: UsageTrackingRequest[] = []

  // Drain one engine pass: publish every event, accumulate per-call usage, and
  // return the final assistant text. Called once for a plain turn, or once per
  // stepper phase by `runProcedureTurn` (each re-drain bills its own iterations).
  const drain = async (gen: AsyncGenerator<AgentEvent>): Promise<string> => {
    let text = ''
    for await (const event of gen) {
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
        (event.type === 'assistant-message-finished' ||
          event.type === 'assistant-message-paused') &&
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
            // creditsUsed omitted: metered from USD COGS per call (0 for BYO).
          })
        }
      }

      if (event.type === 'assistant-message-finished') {
        const t = event.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (t.trim()) text = t
      }

      await publisher.publish(event)
    }
    return text
  }

  // v9 procedures: an agent with published procedures sandwiches the engine drain
  // between selection + the stepper (`runProcedureTurn`), exactly like the chat
  // path. Internal runs carry an empty-anchors subject, so every procedure field
  // resolves to `undefined` (gate-by-absence) and there's no human queue to flip
  // (the `handedOff` return is ignored). Approval-resume turns skip the sandwich — they continue a
  // paused tool, not a fresh customer message (job-path resume verify is §2.2).
  if (hasProcedures && type !== 'approval') {
    const subject: Subject = { anchors: {}, identityVerified: false }
    const conversation: ConversationMessage[] = [
      ...sessionMessagesToConversation(sessionMessages),
      { role: 'user', content: message },
    ]
    const buildCtx = (): ToolContext => {
      const base = {
        db: database,
        organizationId,
        userId,
        sessionId,
        signal,
        subject,
        appAccounts: agentConfig.appAccounts,
      }
      return {
        ...base,
        context: new KopilotContextStore({
          ctx: base as ToolContext,
          initial: readContextSlice(engine.getState().domainState as Record<string, unknown>),
        }),
      }
    }
    await runProcedureTurn({
      engine,
      inboundText: message,
      procedures,
      subject,
      conversation,
      classifyDeps: {
        db: database,
        organizationId,
        userId,
        // Low-stakes routing/classification runs on the cheap utility tier, not
        // the customer-facing reply model. See `ai/providers/utility-model.ts`.
        model: domainConfig.utilityModel ?? domainConfig.defaultModel ?? 'claude-haiku-4-5',
        provider: domainConfig.utilityProvider ?? domainConfig.defaultProvider ?? 'anthropic',
      },
      buildCtx,
      drain,
    })
  } else {
    const generator =
      type === 'approval'
        ? engine.resume({
            action: data.approvalAction ?? 'approve',
            inputAmendment: data.inputAmendment,
            context: sessionContext,
          })
        : engine.submitMessage(message, sessionContext)
    await drain(generator)
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
  if (value === 'mention' || value === 'assignment' || value === 'dm') return value
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
