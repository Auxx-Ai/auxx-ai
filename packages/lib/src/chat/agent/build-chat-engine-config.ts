// packages/lib/src/chat/agent/build-chat-engine-config.ts

import { type Database, database } from '@auxx/database'
import { filterToolsByToolsets, resolveAgentConfig } from '../../agents'
import { buildApplyToolRestrictions } from '../../agents/restrictions/apply'
import { projectToolsSchemas } from '../../agents/restrictions/project-schema'
import { buildResolveVar } from '../../agents/restrictions/var-registry'
import {
  type AgentEngineConfig,
  type ChatInvocationContext,
  createCallModel,
} from '../../ai/agent-framework'
import {
  createAppCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKopilotCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  createToolDepsFactory,
} from '../../ai/kopilot'
import { ModelType } from '../../ai/providers/types'
import { getCachedDefaultModel } from '../../cache/org-cache-helpers'
import { createChatHandoffTool } from './tools/handoff'

/** Split a `provider:model` string; null when unset / malformed. */
function parseProviderModel(
  pinned: string | null | undefined
): { provider: string; model: string } | null {
  if (!pinned) return null
  const idx = pinned.indexOf(':')
  if (idx <= 0 || idx === pinned.length - 1) return null
  return { provider: pinned.slice(0, idx), model: pinned.slice(idx + 1) }
}

export interface BuildChatEngineConfigInput {
  organizationId: string
  /** The chat-kind agent answering the thread. */
  agentId: string
  /** The agent's backing User row (owns the session + reply). */
  agentUserId: string
  /** The thread's long-lived `AiAgentSession` id. */
  sessionId: string
  /** Visitor scope threaded onto every tool's `ToolContext`. */
  invocation: ChatInvocationContext
  signal?: AbortSignal
}

/**
 * Build the `AgentEngineConfig` for a visitor chat turn. Mirrors the worker's
 * kopilot-shaped config (`process-agent-job.ts`) with three chat-specific
 * differences (plans/chat/v5 phase-3b §3):
 *
 *   1. **Chat-safe tool gate** — the agent's enabled toolsets are further
 *      filtered to `chatSafe` tools only. Until phase 4 ships the first
 *      chat-safe tool this yields an empty toolset (a persona-only responder),
 *      which is the intended phase-3b behavior.
 *   2. **`approvalMode: 'auto'`** — no admin is watching a visitor turn to
 *      approve tool calls; the chat-safe + row-level scope gate *is* the
 *      approval. Never `'pause'` (that would hang the turn forever).
 *   3. **`invocation`** — the `ChatInvocationContext` chat-safe tools clamp on.
 *
 * App capabilities run with `userId: null` (like autonomous triggers) — there
 * is no human in the loop, so user-scope tools are hidden by the bridge.
 */
export async function buildChatEngineConfig(
  input: BuildChatEngineConfigInput,
  db: Database = database
): Promise<AgentEngineConfig> {
  const { organizationId, agentId, agentUserId, sessionId, invocation, signal } = input

  // Invariant: a chat-kind agent is visitor-facing by definition, so the
  // author-floor fail-closed check keys on `ctx.invocation`. "No invocation"
  // must never silently mean "no enforcement" — hard-fail the turn. See
  // plans/chat/v6 phase-3 (chat-kind requires invocation).
  if (!invocation || !invocation.threadId) {
    throw new Error('chat engine requires an invocation context')
  }

  // Resolve default provider/model: the agent's pinned model, else the org's
  // system default LLM.
  const agentConfig = await resolveAgentConfig(organizationId, agentId)
  let provider: string | undefined
  let model: string | undefined
  const fromConfig = parseProviderModel(agentConfig.modelId)
  if (fromConfig) {
    provider = fromConfig.provider
    model = fromConfig.model
  } else {
    const systemDefault = await getCachedDefaultModel(organizationId, ModelType.LLM)
    if (systemDefault) {
      provider = systemDefault.provider
      model = systemDefault.model
    }
  }

  const getToolDeps = createToolDepsFactory({
    organizationId,
    userId: agentUserId,
    sessionId,
    signal,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getToolDeps))
  registry.register(createMailCapabilities(getToolDeps))
  registry.register(createKopilotCapabilities(getToolDeps))
  registry.register(
    await createAppCapabilities({
      organizationId,
      // Visitor chat is autonomous — no human in the loop. User-scope tools
      // are hidden by the bridge, same as background agent triggers.
      userId: null,
      agentId,
      triggerId: null,
      sessionId,
      getToolDeps,
    })
  )

  // Agent's enabled toolsets ∩ chat-safe tools. The chat-safe gate happens
  // before the engine ever sees a non-safe tool.
  const enabledTools = filterToolsByToolsets(registry.getTools('__none__'), agentConfig)
  const chatSafeTools = enabledTools.filter((t) => t.chatSafe === true)

  // Escalation (`chat_handoff`) is always available to a chat agent — you never
  // want one unable to hand off to a human — so it's appended unconditionally
  // rather than gated behind a toolset toggle. The "when" is authored in the
  // persona. See plans/chat/v5 escalation.md §1.
  // Project tool schemas per the agent's restriction map — bound args stay
  // visible, drop from `required`, and get an annotated description. Pure
  // comprehension hint; the runtime clamp below is the actual guarantee.
  const tools = projectToolsSchemas(
    [...chatSafeTools, createChatHandoffTool()],
    agentConfig.toolRestrictions
  )

  // Author-floor map: tool registered-name → identity-scoped args. On a visitor
  // turn the engine fail-closes on any unbound entry. See plans/chat/v6 phase-3.
  const identityScopedInputsByTool = Object.fromEntries(
    tools
      .filter((t) => t.identityScopedInputs?.length)
      .map((t) => [t.name, t.identityScopedInputs] as const)
  )

  const domainConfig = createKopilotDomainConfig({
    capabilityRegistry: registry,
    page: '__none__',
    tools,
    defaultModel: model,
    defaultProvider: provider,
    agentConfig,
    // No `triggerContext` — chat is not an AgentTrigger run; the autonomous-run
    // prompt section stays off (escalation guidance lives in the persona).
    db,
    organizationId,
    userId: agentUserId,
  })

  const callModel = createCallModel({
    organizationId,
    userId: agentUserId,
    source: 'kopilot',
    sourceId: sessionId,
  })

  return {
    organizationId,
    userId: agentUserId,
    sessionId,
    db,
    domainConfig,
    callModel,
    signal,
    approvalMode: 'auto',
    invocation,
    // Clamp tool args per the agent's restriction map before each call. The
    // `var` resolver projects values off the chat invocation (visitor / thread
    // anchors) — built once per turn, called per restricted arg. See phase 2.
    applyToolRestrictions: buildApplyToolRestrictions(
      agentConfig.toolRestrictions,
      buildResolveVar(organizationId, { appAccounts: agentConfig.appAccounts }),
      identityScopedInputsByTool
    ),
  }
}
