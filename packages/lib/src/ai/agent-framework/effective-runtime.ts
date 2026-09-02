// packages/lib/src/ai/agent-framework/effective-runtime.ts
//
// Shared effective-agent runtime builder. The model precedence, capability
// registry, tool filtering, binding projection, and binding clamp that used to
// live inline in `process-agent-job.ts` are extracted here so BOTH production
// and the eval Simulation engine construct the agent from one source — never a
// divergent second copy (plans/evals/phase-1-agent-simulation.md §1.4,
// conventions.md §5).

import { database } from '@auxx/database'
import { filterToolsByToolsets, type ResolvedAgentConfig, resolveAgentConfig } from '../../agents'
import {
  buildApplyBindings,
  computeEffectiveBindings,
  projectBindingSchemas,
} from '../../agents/bindings'
import type { AgentSurface } from '../../agents/client'
import { PROCEDURE_CONTROL_TOOLS } from '../../agents/procedures'
import {
  type ResolvedKnowledgeScope,
  resolveAgentKnowledgeScope,
} from '../../agents/resolve-knowledge-scope'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import {
  type CapabilityRegistry,
  createAppCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKopilotCapabilities,
  createKopilotDomainConfig,
  createMailCapabilities,
  createPurchasingIntakeCapabilities,
  createToolDepsFactory,
} from '../kopilot'
import type { TriggerContext } from '../kopilot/prompts/trigger-context'
import { createMcpCapabilities } from '../mcp'
import { BUILDER_MODEL } from './builder-model'
import type { AgentDomainConfig, AgentEngineConfig, AgentToolDefinition } from './types'

/** The two agent surfaces that build a Kopilot-shaped runtime. */
export type AgentRuntimeDomain = 'kopilot' | 'builder'

export interface EffectiveAgentRuntime {
  domainConfig: AgentDomainConfig
  /** The resolved, binding-projected effective toolset (post toolset filtering). */
  tools: AgentToolDefinition[]
  /** Clamp tool args per effective bindings (override ?? author-default). */
  applyToolRestrictions: NonNullable<AgentEngineConfig['applyToolRestrictions']>
  agentConfig: ResolvedAgentConfig
  model: { provider: string; model: string }
  utilityModel: { provider: string; model: string }
}

export interface BuildEffectiveAgentRuntimeArgs {
  organizationId: string
  /** Real acting user (threaded into tool deps). App capabilities are still scoped autonomously. */
  userId: string
  sessionId: string
  agentId: string | null
  domain: AgentRuntimeDomain
  signal?: AbortSignal
  /** Per-turn/per-session model pin (`provider:model`). Highest precedence for kopilot. */
  modelId?: string
  /** Mount the v9 procedure-control tools (inert without an active step). */
  hasProcedures: boolean
  /** Page for page-scoped tool resolution; defaults to `__none__`. */
  page?: string
  /** Present iff kicked off by an AgentTrigger — renders the autonomous-run prompt section. */
  triggerContext?: TriggerContext
  /**
   * Rendering medium → prompt formatting. When unset, derived: `builder` domain
   * → `'builder'`; a `customer_message` trigger on the `chat` channel → `'chat'`;
   * otherwise → `'email'`. The Simulation sets it from the eval channel so
   * sim↔prod formatting matches (a chat eval renders the chat plain-text rule).
   */
  surface?: AgentSurface
  /**
   * Who reads the output → prompt semantics. When unset, derived: a
   * `customer_message` trigger → `'customer'`; otherwise → `'member'`.
   */
  audience?: 'member' | 'customer'
  /**
   * Which agent behavior view to run (build-plan §4.2). `'active'` (default) is
   * the published version production runs; `'draft'` resolves the live Agent row
   * (builder Chat tab, draft eval runs). Master Kopilot (`agentId === null`)
   * ignores this.
   */
  agentConfigSource?: 'active' | 'draft'
  /**
   * Eval-only seam: transform the resolved effective toolset before it is baked
   * into the domain config — the Simulation engine wraps each tool with its mock
   * resolver here so the domain agents execute mocks, not real backends. Omitted
   * on production (the tools pass through unchanged). Name/parameters/outputSchema
   * are preserved by the wrapper, so binding clamps and schema digests are invariant.
   */
  wrapTools?: (tools: AgentToolDefinition[]) => AgentToolDefinition[]
  /**
   * The capability view this run executes under, resolved once by
   * `resolveAgentRunCapabilities` (capability layer v2 §3.1, doc 19 §2.3).
   * Threaded into BOTH the tool deps (read/write gates) and the domain config
   * (prompt-side catalog filtering, §3.4).
   *
   * **REQUIRED KEY, nullable value** — `undefined` still means unrestricted, so
   * the key is mandatory to keep that an explicit statement rather than an
   * omission (see `createToolDepsFactory`). Only master-Kopilot job runs (no
   * agent) and pre-setup drafts legitimately have no principal to resolve.
   */
  capabilities: CapabilityView | undefined
}

/**
 * Split a stored `provider:model` id. Returns null for unset/malformed values so
 * callers fall through to the next precedence tier (system default).
 */
export function parseProviderModel(
  pinned: string | null | undefined
): { provider: string; model: string } | null {
  if (!pinned) return null
  const idx = pinned.indexOf(':')
  if (idx <= 0 || idx === pinned.length - 1) return null
  return { provider: pinned.slice(0, idx), model: pinned.slice(idx + 1) }
}

/**
 * Resolve the default model:
 *   builder → pinned `BUILDER_MODEL`.
 *   kopilot → per-turn `modelId` → agent/master pin → org system default.
 * Returns possibly-undefined parts; `createKopilotDomainConfig` supplies the
 * final framework defaults so a malformed pin degrades gracefully (matching the
 * pre-extraction behavior exactly).
 */
async function resolveModelDefaults(
  domain: AgentRuntimeDomain,
  args: {
    organizationId: string
    agentId: string | null
    modelId?: string
    source?: 'active' | 'draft'
  }
): Promise<{ provider?: string; model?: string }> {
  if (domain === 'builder') {
    return { provider: BUILDER_MODEL.provider, model: BUILDER_MODEL.model }
  }

  const pinned = args.modelId ?? null
  if (pinned) {
    const parsed = parseProviderModel(pinned)
    // Malformed pin: leave both undefined (no fallthrough), as production did.
    return parsed ? { provider: parsed.provider, model: parsed.model } : {}
  }

  const agentConfigForModel = await resolveAgentConfig(
    args.organizationId,
    args.agentId,
    undefined,
    {
      source: args.source ?? 'active',
    }
  )
  const fromConfig = parseProviderModel(agentConfigForModel.modelId)
  if (fromConfig) return { provider: fromConfig.provider, model: fromConfig.model }

  const { getCachedDefaultModel } = await import('../../cache/org-cache-helpers')
  const { ModelType } = await import('../providers/types')
  const systemDefault = await getCachedDefaultModel(args.organizationId, ModelType.LLM)
  return systemDefault ? { provider: systemDefault.provider, model: systemDefault.model } : {}
}

/**
 * Construct the capability registry every agent runtime resolves tools from:
 * native (entity/mail/kopilot) + app-backed + MCP capabilities. Exported for
 * consumers that need the UNFILTERED installed-tool universe — the eval mock
 * validator looks tools up here so a mock authored for a tool the agent doesn't
 * have *yet* still validates against its real `outputSchema` — without paying
 * for config resolution, binding projection, or domain-config assembly.
 * `buildEffectiveAgentRuntime` builds from this too, so the two views can
 * never drift.
 */
export async function buildAgentCapabilityRegistry(args: {
  organizationId: string
  userId: string
  sessionId: string
  agentId: string | null
  signal?: AbortSignal
  /**
   * Read/write enforcement for this run (§3.1). Required key, nullable value —
   * `undefined` = unrestricted, and must be a deliberate choice at the call site.
   */
  capabilities: CapabilityView | undefined
  /**
   * The running agent's resolved retrieval scope (§1.1). Optional — the eval
   * mock validator calls this builder without one, and callers with no scope
   * to thread keep today's unrestricted behavior.
   */
  knowledgeScope?: ResolvedKnowledgeScope | null
}): Promise<CapabilityRegistry> {
  const { organizationId, userId, sessionId, agentId, signal, capabilities, knowledgeScope } = args
  const getToolDeps = createToolDepsFactory({
    organizationId,
    userId,
    sessionId,
    signal,
    capabilities,
    knowledgeScope,
  })

  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getToolDeps))
  registry.register(createMailCapabilities(getToolDeps))
  registry.register(createKopilotCapabilities(getToolDeps))
  // Purchase-order intake (plans/money/tasks/38 §4). Page-scoped, so registering
  // it unconditionally costs every other page nothing — `getTools` only hands a
  // capability's tools to its own page key. Registered HERE rather than only in
  // the chat route because the intake run is a worker job (§3.3), and this is the
  // builder every autonomous run resolves its tools from.
  registry.register(createPurchasingIntakeCapabilities(getToolDeps))
  registry.register(
    await createAppCapabilities({
      organizationId,
      // Background/eval agent runs are autonomous — no human in the loop.
      // User-scope tools are hidden by the bridge (decision A2).
      userId: null,
      agentId,
      triggerId: null,
      sessionId,
      getToolDeps,
    })
  )
  // MCP-backed tools — autonomous (background/eval runs, userId: null here): untrusted
  // write tools are filtered out by the adapter.
  registry.register(await createMcpCapabilities({ organizationId, autonomous: true }))
  return registry
}

/**
 * Build the effective agent runtime: registry + capabilities, toolset-filtered
 * and binding-projected tools, the domain config, and the binding clamp. Used by
 * the production job and the eval Simulation executor alike.
 *
 * Note: the binding clamp (`applyToolRestrictions`) is built from the resolved
 * effective `tools`. The pre-extraction job read a non-existent
 * `domainConfig.tools` (always `undefined`), which threw at engine construction;
 * threading the real tool list through here is the intended behavior and fixes
 * that latent crash on the autonomous-agent path.
 */
export async function buildEffectiveAgentRuntime(
  args: BuildEffectiveAgentRuntimeArgs
): Promise<EffectiveAgentRuntime> {
  const { organizationId, userId, sessionId, agentId, domain, signal, hasProcedures } = args

  const source = args.agentConfigSource ?? 'active'

  const defaults = await resolveModelDefaults(domain, {
    organizationId,
    agentId,
    modelId: args.modelId,
    source,
  })

  const agentConfig = await resolveAgentConfig(organizationId, agentId, undefined, { source })

  // Resolve once per turn (§1.1) — shared by both the tool deps (read gate)
  // and the domain config (prompt-side catalog filtering). `null` entries
  // (master Kopilot) resolve to `null` = unrestricted, matching today.
  const knowledgeScope = await resolveAgentKnowledgeScope({
    db: database,
    organizationId,
    entries: agentConfig.knowledge,
    capabilities: args.capabilities,
  })

  const registry = await buildAgentCapabilityRegistry({
    organizationId,
    userId,
    sessionId,
    agentId,
    signal,
    capabilities: args.capabilities,
    knowledgeScope,
  })

  const resolvedPage = args.page ?? '__none__'
  const filteredTools = filterToolsByToolsets(registry.getTools(resolvedPage), agentConfig)
  // Mount procedure-control tools when this agent has procedures — inert without
  // an active step, so zero-procedure runs keep the unchanged tool list.
  const allTools = hasProcedures ? [...filteredTools, ...PROCEDURE_CONTROL_TOOLS] : filteredTools

  // Project tool schemas per the effective bindings (author defaults ⊕ admin
  // overrides). `computeEffectiveBindings` reads only name + inputBindings, so it
  // is invariant under schema projection — one computation serves both the
  // projected schemas and the runtime clamp.
  const effectiveBindings = computeEffectiveBindings(allTools, agentConfig.toolRestrictions)
  const projected = projectBindingSchemas(allTools, effectiveBindings)
  // Eval-only: wrap the projected toolset with mock execution before it's baked into
  // the domain config. Identity (name/parameters/outputSchema) is preserved, so the
  // binding clamp below and snapshot digests are unaffected. No-op in production.
  const tools = args.wrapTools ? args.wrapTools(projected) : projected

  // Surface/audience: explicit override wins; otherwise derive from the run's
  // domain + trigger envelope. A `customer_message` trigger is the customer
  // envelope (live-chat eval or a customer email); its `payload.channel`
  // distinguishes the plain-text chat surface from the email surface, so a chat
  // eval renders the same formatting rule production chat does.
  const isCustomerTrigger = args.triggerContext?.kind === 'customer_message'
  const triggerChannel = (args.triggerContext?.payload as { channel?: unknown } | undefined)
    ?.channel
  const audience = args.audience ?? (isCustomerTrigger ? 'customer' : 'member')
  const surface: AgentSurface =
    args.surface ??
    (domain === 'builder'
      ? 'builder'
      : isCustomerTrigger && triggerChannel === 'chat'
        ? 'chat'
        : 'email')

  const domainConfig = createKopilotDomainConfig({
    capabilityRegistry: registry,
    page: resolvedPage,
    tools,
    defaultModel: defaults.model,
    defaultProvider: defaults.provider,
    agentConfig,
    surface,
    audience,
    triggerContext: args.triggerContext,
    // Prompt-side catalog filtering (§3.4) — the entity/KB catalogs the model is
    // handed are narrowed to what this run may actually read.
    capabilities: args.capabilities,
    // The agent's retrieval scope (§1.1) — narrows the Knowledge Catalog the
    // prompt renders to what this agent may actually search.
    knowledgeScope,
    // Long-running plans (≥30 steps × ~1–2 LLM rounds each) need headroom past
    // the framework's small-loop default.
    maxIterations: 30,
  })

  return {
    // The engine treats domain state as opaque `Record<string, unknown>`, but
    // `AgentDomainConfig` is invariant in its state generic — widen the concrete
    // `KopilotDomainState` config at this single boundary (the pre-extraction job
    // carried this same conversion as an unchecked error).
    domainConfig: domainConfig as unknown as AgentDomainConfig,
    tools,
    applyToolRestrictions: buildApplyBindings(effectiveBindings),
    agentConfig,
    model: {
      provider: domainConfig.defaultProvider,
      model: domainConfig.defaultModel,
    },
    utilityModel: {
      provider: domainConfig.utilityProvider ?? domainConfig.defaultProvider,
      model: domainConfig.utilityModel ?? domainConfig.defaultModel,
    },
  }
}
