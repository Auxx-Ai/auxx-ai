// packages/lib/src/ai/kopilot/capabilities/types.ts

import type { Database } from '@auxx/database'
import type { AgentDeps, AgentToolDefinition } from '../../agent-framework/types'

/** Dependencies injected into tool execution (superset of AgentDeps) */
export interface ToolDeps extends AgentDeps {
  db: Database
}

/** Factory function that provides ToolDeps at execution time */
export type GetToolDeps = () => ToolDeps

/** A page capability set — tools available on a specific page */
export interface PageCapability {
  /** Page identifier (e.g. 'mail', 'contacts', 'workflows') */
  page: string
  /** Tools available on this page */
  tools: AgentToolDefinition[]
  /** Optional system prompt addition for this page's context */
  systemPromptAddition?: string
  /** Human-friendly capability descriptions (e.g. "Search & find contacts, companies, and tickets") */
  capabilities?: string[]
}

/** Registry mapping pages to their capabilities */
export interface CapabilityRegistry {
  /** Get tools for a specific page */
  getTools(page: string): AgentToolDefinition[]
  /** Get all registered pages */
  getPages(): string[]
  /** Get system prompt addition for a page */
  getSystemPromptAddition(page: string): string | undefined
  /** Get a combined human-friendly capabilities summary for the user */
  getCapabilitiesSummary(): string[]
  /** Register a page's capabilities */
  register(capability: PageCapability): void
}
