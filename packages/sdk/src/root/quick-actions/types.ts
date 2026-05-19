// packages/sdk/src/root/quick-actions/types.ts

/**
 * Context types for tools surfaced as quick actions (via `ToolDefinition.action`).
 * The tool-definition itself lives in `../tools/types.ts`; this file only carries
 * the platform-built context passed to `action.shouldShow` / `action.getDefaults`.
 */

/**
 * An entity instance resolved from the thread context.
 * Generic shape — works for any entity definition (ticket, contact, order, company, custom).
 */
export interface QuickActionEntity {
  id: string
  entityDefinitionId: string
  /** Entity definition slug (e.g., "shopify-order", "company") */
  entityDefinitionSlug: string
  displayName: string
  /** Custom field values, keyed by field slug */
  fields: Record<string, unknown>
}

/**
 * A thread participant with optional linked contact entity.
 */
export interface QuickActionParticipant {
  email: string
  name?: string
  isInternal: boolean
  /** Linked contact entity (if resolved) */
  contact?: QuickActionEntity
}

/**
 * Context provided to a tool's `action` surface callbacks.
 * Built by the platform — never constructed by the author.
 */
export interface QuickActionContext {
  /** The thread being replied to */
  threadId: string

  /** Ticket entity instance linked to this thread (if any) */
  ticket?: QuickActionEntity

  /** Thread participants */
  participants: QuickActionParticipant[]

  /**
   * All entity instances associated with the thread context.
   * Includes ticket, contacts, and any entities linked via relationship fields
   * (e.g., a Shopify order linked on the ticket, a company linked on the contact).
   */
  entities: QuickActionEntity[]
}
