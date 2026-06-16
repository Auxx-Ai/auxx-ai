// packages/lib/src/chat/agent/build-chat-engine-config.ts

import { type Database, database } from '@auxx/database'
import { filterToolsByToolsets, resolveAgentConfig } from '../../agents'
import {
  buildApplyBindings,
  computeEffectiveBindings,
  projectBindingSchemas,
} from '../../agents/bindings'
import { ALL_SURFACES } from '../../agents/client'
import { PROCEDURE_CONTROL_TOOLS } from '../../agents/procedures/control-tools'
import { type AgentEngineConfig, createCallModel, type Subject } from '../../ai/agent-framework'
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
import { createHandoffTool } from './tools/handoff'

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
  /** The turn's subject (anchors + identityVerified) threaded onto every tool's `ToolContext`. */
  subject: Subject
  signal?: AbortSignal
  /**
   * Mount the v9 procedure control tools (`advance_procedure` / `await_customer` /
   * `digress` / `end_procedure`) when this agent has published procedures. They're
   * inert without an active procedure step in the prompt, so gating keeps
   * zero-procedure agents on the unchanged tool list. (Handoff is no longer a
   * control tool — the always-mounted `handoff` tool covers it; see v10 handoff-unify.)
   */
  hasProcedures?: boolean
}

/**
 * Build the `AgentEngineConfig` for a visitor chat turn. Mirrors the worker's
 * kopilot-shaped config (`process-agent-job.ts`) with three chat-specific
 * differences (plans/chat/v5 phase-3b §3):
 *
 *   1. **Surface gate** — the agent's enabled toolsets are further filtered to
 *      tools offered on the `chat` surface (`surfaces` absent ⇒ all surfaces,
 *      so this only drops tools explicitly narrowed away from chat). The real
 *      "is it available" gate is the admin enabling the toolset; tools that
 *      aren't `externalSafe` run but are flagged in the UI. See
 *      plans/chat/v6/chat-tool-availability.md.
 *   2. **`approvalMode: 'auto'`** — no admin is watching a visitor turn to
 *      approve tool calls; the binding clamp + row-level scope gate *is* the
 *      approval. Never `'pause'` (that would hang the turn forever).
 *   3. **`subject`** — the turn's subject (anchors + identityVerified) tool
 *      bindings resolve identity/scope inputs against. See plans/chat/v8.
 *
 * App capabilities run with `userId: null` (like autonomous triggers) — there
 * is no human in the loop, so user-scope tools are hidden by the bridge.
 */
export async function buildChatEngineConfig(
  input: BuildChatEngineConfigInput,
  db: Database = database
): Promise<AgentEngineConfig> {
  const { organizationId, agentId, agentUserId, sessionId, subject, signal, hasProcedures } = input

  // Invariant: a chat-kind agent is visitor-facing by definition, so it always
  // runs with a subject carrying the thread + participant anchors (contact is
  // optional — absent on an anonymous turn, by design). "No subject" must never
  // silently mean "no scoping" — hard-fail the turn. See plans/chat/v8 phase-1.
  if (!subject || !subject.anchors.thread || !subject.anchors.participant) {
    throw new Error('chat engine requires a subject with thread + participant anchors')
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

  // Agent's enabled toolsets ∩ tools offered on the `chat` surface. With the
  // default-all `surfaces`, this only drops tools explicitly narrowed off chat
  // (e.g. builder meta-tools — which aren't registered here anyway). `surfaces`
  // is not the security boundary; the admin enabling the toolset is.
  const enabledTools = filterToolsByToolsets(registry.getTools('__none__'), agentConfig)
  const chatTools = enabledTools.filter((t) => (t.surfaces ?? ALL_SURFACES).includes('chat'))

  // Escalation (`handoff`) is always available to a chat agent — you never want
  // one unable to hand off to a human — so it's appended unconditionally rather
  // than gated behind a toolset toggle. It's the single handoff tool (the old
  // `handoff_to_human` control tool is gone); the "when" is authored in the
  // persona. See plans/chat/v10 handoff-unify.md.
  const allTools = [
    ...chatTools,
    createHandoffTool(),
    ...(hasProcedures ? PROCEDURE_CONTROL_TOOLS : []),
  ]

  // Effective bindings = admin override ?? tool-author default (plans/chat/v8
  // phase-4). `agentConfig.toolRestrictions` is the thin per-agent override map
  // (usually empty), so the common result is just the author defaults each tool
  // ships via `inputBindings`.
  const effectiveBindings = computeEffectiveBindings(allTools, agentConfig.toolRestrictions)

  // Project tool schemas per the effective bindings — bound inputs stay
  // visible, `const` inputs drop from `required`, and bound inputs get an
  // annotated description. Pure comprehension hint; the runtime clamp below is
  // the actual guarantee. See plans/chat/v8 phase-4.
  const tools = projectBindingSchemas(allTools, effectiveBindings)

  const domainConfig = createKopilotDomainConfig({
    capabilityRegistry: registry,
    page: '__none__',
    tools,
    defaultModel: model,
    defaultProvider: provider,
    agentConfig,
    // A chat turn renders to the plain-text widget (surface) for an external
    // visitor (audience). These drive the prompt's formatting + opacity rules;
    // chat ALWAYS serves a customer, so we never consult `agent.kind` here.
    surface: 'chat',
    audience: 'customer',
    // No `triggerContext` — chat is not an AgentTrigger run; it stays
    // `runMode: 'interactive'` (the visitor is in the loop). The surface/audience
    // gates do the customer-facing work the trigger envelope used to.
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
    subject,
    // The agent's bound app accounts, so the binding resolver can scope an
    // `@app:<slug>:<key>` var segment to the agent's connection at turn time.
    appAccounts: agentConfig.appAccounts,
    // Clamp tool args per the effective bindings before each call — the
    // resolver derives each value off a subject anchor (built per call from
    // ctx, which carries appAccounts for `@app:` segments). See plans/chat/v8
    // phase-4.
    applyToolRestrictions: buildApplyBindings(effectiveBindings),
  }
}
