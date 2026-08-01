// packages/lib/src/ai/kopilot/capabilities/types.ts

import type { Database } from '@auxx/database'
import type { ResolvedKnowledgeScope } from '../../../agents/resolve-knowledge-scope'
import type { CapabilityView } from '../../../permissions/capabilities/capability-view'
import type { AgentDeps, AgentToolDefinition } from '../../agent-framework/types'
import type { SessionContext } from '../types'

/** Dependencies injected into tool execution (superset of AgentDeps) */
export interface ToolDeps extends AgentDeps {
  db: Database
  /**
   * UI session context from the current request. Tools that need
   * "active record" information (active article, thread, etc.) read it
   * from here. Rebuilt fresh per request from the SSE route body.
   */
  sessionContext: SessionContext
  /**
   * Request-scoped read/write enforcement (v2 §3), resolved once per turn.
   *
   * A `CapabilityView` here is either a human's `CapabilitySet`, an agent's
   * published-policy view (`AgentPolicyCapabilities`), or their intersection.
   * Tools gate each def through `canViewEntity`/`canEditEntity` and each shared
   * resource through `canViewInstance`/`canEditInstance`.
   *
   * **REQUIRED KEY, nullable value.** `undefined` still means *unrestricted*
   * inside the tools, so the key is mandatory to keep that choice explicit at
   * every construction site rather than achievable by forgetting a line — see
   * `createToolDepsFactory` for the full rationale. Only the workflow AI node,
   * master-Kopilot job runs, and pre-setup drafts legitimately pass `undefined`.
   */
  capabilities: CapabilityView | undefined
  /**
   * The agent's resolved retrieval scope (plans/permissions/v2/15-agent-knowledge-scope.md
   * §1.1), resolved once per turn. Present ONLY when the running agent has a
   * non-empty `Agent.knowledge` scope; absent/null ⇒ unrestricted, org-wide
   * knowledge — today's behavior. Read by knowledge-retrieval tools to narrow
   * which datasets/articles they search.
   */
  knowledgeScope?: ResolvedKnowledgeScope | null
}

/** Factory function that provides ToolDeps at execution time */
export type GetToolDeps = () => ToolDeps

/**
 * Context passed to functional `systemPromptAddition` values so a capability
 * can emit different prose depending on which of its tools survived runtime
 * filtering (per-agent toolsets, invoker-scope, approval-mode). The set is
 * the same one used to build the LLM tool block — see
 * `kopilot-domain-config: Resolved tools`.
 */
export interface SystemPromptAdditionContext {
  toolNames: Set<string>
}

/**
 * Turn-scoped deps handed to a capability's lifecycle hooks. A capability
 * already reaches `db` / `sessionContext` / `organizationId` / `userId` through
 * its own `GetToolDeps` closure — `turnId` is the one piece of engine-owned,
 * turn-ephemeral identity it can't source itself, so it's the only field here.
 */
export interface CapabilityTurnDeps {
  /** Engine-assigned id for the turn that just ended. Scopes per-turn lookups. */
  turnId: string
}

/**
 * Optional turn-lifecycle hooks a capability can declare to finalize or revert
 * its own turn-scoped resources. The domain config fans its engine-level
 * lifecycle out to every registered capability that declares one, so
 * capability-specific cleanup lives with the capability instead of leaking into
 * the capability-agnostic domain config.
 */
export interface CapabilityLifecycle {
  /**
   * Fired once at the end of a turn. `outcome` mirrors the engine
   * (`'completed'` for a clean finish, `'error'` for a turn-error / abort /
   * disconnect). Sources everything but `turnId` from the capability's own
   * `GetToolDeps` closure. Must not throw — the domain config wraps it.
   */
  onTurnEnd?(outcome: 'completed' | 'error', deps: CapabilityTurnDeps): Promise<void>
}

/** A page capability set — tools available on a specific page */
export interface PageCapability {
  /** Page identifier (e.g. 'mail', 'contacts', 'workflows') */
  page: string
  /** Tools available on this page */
  tools: AgentToolDefinition[]
  /**
   * Optional system prompt addition for this page's context. Pass a function
   * when the prose mentions specific tools that might be filtered out at
   * runtime — the resolved tool name set is passed in so fragments can be
   * gated. Static strings are still fine for prose that's tool-agnostic.
   */
  systemPromptAddition?: string | ((ctx: SystemPromptAdditionContext) => string)
  /**
   * Human-friendly capability descriptions (e.g.
   * "Search & find contacts, companies, and tickets"). Pass a function when
   * the bullets name specific tools that might be filtered out at runtime —
   * the resolved tool name set is passed in so each bullet can be gated.
   */
  capabilities?: string[] | ((ctx: SystemPromptAdditionContext) => string[])
  /**
   * Tool names (or a predicate) to remove from the global pool when this
   * page is active. Page-local tools are never filtered. Use to keep a
   * focused page (e.g. `agents.builder`) from inheriting irrelevant
   * globals like mail/tasks/entity-writes. String entries may end with
   * `*` for prefix match (e.g. `'mail_*'`).
   */
  excludeGlobalTools?: string[] | ((toolName: string) => boolean)
  /**
   * Optional turn-lifecycle hooks. A capability with turn-scoped side-effects
   * (e.g. the KB write transaction's snapshot + lock) declares them here; the
   * domain config fans its own engine lifecycle out to each registered
   * capability that has one. Declarative capabilities omit this.
   */
  lifecycle?: CapabilityLifecycle
}

/** Registry mapping pages to their capabilities */
export interface CapabilityRegistry {
  /** Get tools for a specific page */
  getTools(page: string): AgentToolDefinition[]
  /** Get all registered pages */
  getPages(): string[]
  /** Get system prompt addition for a page, resolving any functional additions against the runtime tool set */
  getSystemPromptAddition(page: string, ctx: SystemPromptAdditionContext): string | undefined
  /**
   * Get a combined human-friendly capabilities summary for a page — the
   * `__global__` bullets plus that page's, matching how `getTools` and
   * `getSystemPromptAddition` resolve. Pass `undefined` (or an unregistered
   * page) for global-only. The resolved tool name set gates functional
   * `capabilities` arrays on tool survival.
   */
  getCapabilitiesSummary(page: string | undefined, ctx: SystemPromptAdditionContext): string[]
  /** Names of global tools the page chose to exclude — for debugging / logging */
  getExcludedGlobalToolNames(page: string): string[]
  /**
   * Turn-lifecycle hooks from every registered capability that declared one,
   * in registration order. The domain config fans its engine `onTurnEnd` out
   * to these so capability-scoped cleanup stays with the capability.
   */
  getLifecycles(): CapabilityLifecycle[]
  /** Register a page's capabilities */
  register(capability: PageCapability): void
}
