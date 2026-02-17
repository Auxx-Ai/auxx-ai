// packages/lib/src/tickets/ticket-mutations.ts

import type { Database } from '@auxx/database'
import type { TicketPriority, TicketStatus } from '@auxx/database/types'
import { publisher } from '@auxx/lib/events'
import { TRPCError } from '@trpc/server'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../resources/resource-id'

/**
 * Input for updating multiple tickets' status
 */
export interface UpdateMultipleStatusInput {
  ticketIds: string[]
  status: TicketStatus
  organizationId: string
  userId: string
}

/**
 * Input for updating multiple tickets' priority
 */
export interface UpdateMultiplePriorityInput {
  ticketIds: string[]
  priority: TicketPriority
  organizationId: string
  userId: string
}

/**
 * Input for updating multiple tickets' assignments
 */
export interface UpdateMultipleAssignmentsInput {
  ticketIds: string[]
  agentIds: string[]
  organizationId: string
  userId: string
}

/**
 * Input for deleting multiple tickets
 */
export interface DeleteMultipleTicketsInput {
  ticketIds: string[]
  organizationId: string
  userId: string
}

/**
 * Update multiple tickets' status via UnifiedCrudHandler
 */
export async function updateMultipleStatus(
  db: Database,
  input: UpdateMultipleStatusInput
): Promise<void> {
  const { ticketIds, status, organizationId, userId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const updates = ticketIds.map((id) => ({
    recordId: toRecordId('ticket', id) as RecordId,
    values: { status } as Record<string, unknown>,
  }))

  const result = await handler.bulkUpdate(updates)

  if (result.errors.length > 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }

  await Promise.all(
    ticketIds.map(async (ticketId) => {
      await publisher.publishLater({
        type: 'ticket:updated',
        data: { organizationId, ticketId, userId },
      })
    })
  )
}

/**
 * Update multiple tickets' priority via UnifiedCrudHandler
 */
export async function updateMultiplePriority(
  db: Database,
  input: UpdateMultiplePriorityInput
): Promise<void> {
  const { ticketIds, priority, organizationId, userId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const updates = ticketIds.map((id) => ({
    recordId: toRecordId('ticket', id) as RecordId,
    values: { priority } as Record<string, unknown>,
  }))

  const result = await handler.bulkUpdate(updates)

  if (result.errors.length > 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }

  await Promise.all(
    ticketIds.map(async (ticketId) => {
      await publisher.publishLater({
        type: 'ticket:updated',
        data: { organizationId, ticketId, userId },
      })
    })
  )
}

/**
 * Update multiple tickets' assignments via UnifiedCrudHandler.
 * Assignments are now an ACTOR field `assigned_to_id` on the ticket entity.
 * Only the first agentId is used (single assignee).
 */
export async function updateMultipleAssignments(
  db: Database,
  input: UpdateMultipleAssignmentsInput
): Promise<void> {
  const { ticketIds, agentIds, organizationId, userId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  // Assignments are now a single ACTOR field; use the first agent or null
  const assignedToId = agentIds.length > 0 ? agentIds[0] : null

  const updates = ticketIds.map((id) => ({
    recordId: toRecordId('ticket', id) as RecordId,
    values: { assigned_to_id: assignedToId } as Record<string, unknown>,
  }))

  const result = await handler.bulkUpdate(updates)

  if (result.errors.length > 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }
}

/**
 * Delete multiple tickets via UnifiedCrudHandler
 */
export async function deleteMultipleTickets(
  db: Database,
  input: DeleteMultipleTicketsInput
): Promise<{ success: boolean; count: number }> {
  const { ticketIds, organizationId, userId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const recordIds = ticketIds.map((id) => toRecordId('ticket', id) as RecordId)
  const result = await handler.bulkDelete(recordIds)

  await Promise.all(
    ticketIds.map(async (ticketId) => {
      await publisher.publishLater({
        type: 'ticket:deleted',
        data: { organizationId, ticketId, userId },
      })
    })
  )

  return { success: true, count: result.count }
}
