// packages/lib/src/ai/kopilot/capabilities/types.ts

import type { Database } from '@auxx/database'
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
   * Get a combined human-friendly capabilities summary for the user.
   * Pass the resolved tool name set so functional `capabilities` arrays can
   * gate bullets on tool survival.
   */
  getCapabilitiesSummary(ctx?: SystemPromptAdditionContext): string[]
  /** Names of global tools the page chose to exclude — for debugging / logging */
  getExcludedGlobalToolNames(page: string): string[]
  /** Register a page's capabilities */
  register(capability: PageCapability): void
}
