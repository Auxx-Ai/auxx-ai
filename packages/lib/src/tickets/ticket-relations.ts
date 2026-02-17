// packages/lib/src/tickets/ticket-relations.ts
//
// TicketRelation table has been dropped. Ticket relations are no longer supported
// as a standalone concept. Relations between entities are now managed via
// RELATIONSHIP fields on EntityDefinition through UnifiedCrudHandler.
//
// This file is gutted. The exported interfaces and function signatures are
// preserved to avoid breaking downstream imports, but all functions throw
// a not-implemented error.

import type { Database } from '@auxx/database'

/**
 * Input for adding a relation between tickets
 * @deprecated TicketRelation table dropped. Use RELATIONSHIP fields via UnifiedCrudHandler.
 */
export interface AddRelationInput {
  ticketId: string
  relatedTicketId: string
  relation: string
  organizationId: string
  userId: string
}

/**
 * Input for removing a relation between tickets
 * @deprecated TicketRelation table dropped. Use RELATIONSHIP fields via UnifiedCrudHandler.
 */
export interface RemoveRelationInput {
  relationId: string
  organizationId: string
  userId: string
}

/**
 * @deprecated TicketRelation table dropped. Use RELATIONSHIP fields via UnifiedCrudHandler.
 */
export async function addRelation(
  _db: Database,
  _input: AddRelationInput
): Promise<{ id: string; ticketId: string; relatedTicketId: string; relation: string }> {
  // TODO: Reimplement using RELATIONSHIP fields on the ticket entity via UnifiedCrudHandler
  throw new Error('addRelation is not implemented. TicketRelation table has been dropped.')
}

/**
 * @deprecated TicketRelation table dropped. Use RELATIONSHIP fields via UnifiedCrudHandler.
 */
export async function removeRelation(
  _db: Database,
  _input: RemoveRelationInput
): Promise<{ success: true }> {
  // TODO: Reimplement using RELATIONSHIP fields on the ticket entity via UnifiedCrudHandler
  throw new Error('removeRelation is not implemented. TicketRelation table has been dropped.')
}
