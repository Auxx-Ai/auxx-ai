// packages/lib/src/resources/hooks/ticket-hooks.ts

import { ticketNumbering } from '../../tickets/ticket-numbering'
import { publisher } from '../../events/publisher'
import type { SystemHook, SystemHookRegistry } from './types'

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get field by system attribute from the allFields array
 */
function getFieldBySystemAttribute(
  allFields: { systemAttribute: string | null; id: string }[],
  systemAttribute: string
) {
  return allFields.find((f) => f.systemAttribute === systemAttribute)
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKET NUMBER HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-generate ticket number on create operation.
 * Uses TicketSequence model for organization-specific formatting.
 *
 * Format configured per-organization via TicketSequence:
 * - prefix, useDateInPrefix, dateFormat, paddingLength, separator
 * - Example output: "2501-0042" (date prefix + padded number)
 *
 * Note: ticket_number field has isCreatable: false, isUpdatable: false
 * so this hook is the ONLY way to set it.
 */
const autoGenerateTicketNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  // Only generate on create
  if (operation !== 'create') {
    return values
  }

  // Generate ticket number using existing numbering service
  const { ticketNumber } = await ticketNumbering.create(organizationId)

  return {
    ...values,
    [field.id]: ticketNumber,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS TRANSITION HOOKS
// ═══════════════════════════════════════════════════════════════════════════

const ACTIVE_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_THIRD_PARTY']

/**
 * Get previous status from existing instance field values
 */
async function getPreviousStatus(
  existingInstance: { id: string } | undefined,
  allFields: { systemAttribute: string | null; id: string }[]
): Promise<string | undefined> {
  if (!existingInstance) return undefined

  // The existingInstance has the field values stored elsewhere
  // For status transition, we look at metadata.currentStatus if available
  // or we need to fetch from FieldValue table
  // For now, we'll rely on the existingInstance metadata pattern
  const metadata = (existingInstance as any).metadata
  return metadata?.currentStatus as string | undefined
}

/**
 * Update resolvedAt timestamp when status changes to RESOLVED.
 * Clear resolvedAt when reopening from RESOLVED.
 */
const updateResolvedTimestamp: SystemHook = async ({
  field,
  values,
  allFields,
  existingInstance,
  operation,
}) => {
  const newStatus = values[field.id]
  if (!newStatus || typeof newStatus !== 'string') return values

  const resolvedAtField = getFieldBySystemAttribute(allFields, 'ticket_resolved_at')
  if (!resolvedAtField) return values

  const previousStatus = await getPreviousStatus(existingInstance, allFields)
  const normalizedNewStatus = newStatus.toUpperCase()

  // Set resolvedAt when moving TO RESOLVED
  if (normalizedNewStatus === 'RESOLVED' && previousStatus !== 'RESOLVED') {
    return { ...values, [resolvedAtField.id]: new Date().toISOString() }
  }

  // Clear resolvedAt when reopening FROM RESOLVED
  if (previousStatus === 'RESOLVED' && ACTIVE_STATUSES.includes(normalizedNewStatus)) {
    return { ...values, [resolvedAtField.id]: null }
  }

  return values
}

/**
 * Update closedAt timestamp when status changes to CLOSED.
 * Clear closedAt when reopening from CLOSED.
 */
const updateClosedTimestamp: SystemHook = async ({
  field,
  values,
  allFields,
  existingInstance,
}) => {
  const newStatus = values[field.id]
  if (!newStatus || typeof newStatus !== 'string') return values

  const closedAtField = getFieldBySystemAttribute(allFields, 'ticket_closed_at')
  if (!closedAtField) return values

  const previousStatus = await getPreviousStatus(existingInstance, allFields)
  const normalizedNewStatus = newStatus.toUpperCase()

  // Set closedAt when moving TO CLOSED
  if (normalizedNewStatus === 'CLOSED' && previousStatus !== 'CLOSED') {
    return { ...values, [closedAtField.id]: new Date().toISOString() }
  }

  // Clear closedAt when reopening FROM CLOSED
  if (previousStatus === 'CLOSED' && ACTIVE_STATUSES.includes(normalizedNewStatus)) {
    return { ...values, [closedAtField.id]: null }
  }

  return values
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS CHANGE EVENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish status change event for timeline tracking.
 */
const publishStatusChangeEvent: SystemHook = async ({
  field,
  values,
  entityDef,
  existingInstance,
  organizationId,
  userId,
  allFields,
  operation,
}) => {
  const newStatus = values[field.id]
  if (!newStatus || operation !== 'update' || !existingInstance) return values

  const previousStatus = await getPreviousStatus(existingInstance, allFields)
  if (previousStatus && previousStatus !== newStatus) {
    // Get ticket_contact field value for timeline
    const contactField = getFieldBySystemAttribute(allFields, 'ticket_contact')
    const ticketContact = contactField ? values[contactField.id] : undefined

    // Get ticket_number field value
    const numberField = getFieldBySystemAttribute(allFields, 'ticket_number')
    const ticketNumber = numberField ? values[numberField.id] : undefined

    publisher.publishLater({
      type: 'ticket:status:changed',
      data: {
        organizationId,
        userId,
        ticketId: existingInstance.id,
        ticket_status: newStatus as string,
        old_ticket_status: previousStatus,
        ...(ticketContact && { ticket_contact: ticketContact }),
        ...(ticketNumber && { ticket_number: ticketNumber }),
      },
    })
  }

  return values
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSIGNEE CHANGE EVENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish assignee change event for timeline tracking.
 */
const publishAssigneeChangeEvent: SystemHook = async ({
  field,
  values,
  existingInstance,
  organizationId,
  userId,
  allFields,
  operation,
}) => {
  const newAssignees = values[field.id]
  if (!newAssignees || operation !== 'update' || !existingInstance) return values

  // Get previous assignees from metadata
  const metadata = (existingInstance as any).metadata
  const previousAssignees = (metadata?.currentAssignees as string[]) || []
  const newAssigneeArray = Array.isArray(newAssignees) ? newAssignees : [newAssignees]

  const addedAssignees = newAssigneeArray.filter((a: string) => !previousAssignees.includes(a))
  const removedAssignees = previousAssignees.filter((a: string) => !newAssigneeArray.includes(a))

  // Get ticket_contact for timeline
  const contactField = getFieldBySystemAttribute(allFields, 'ticket_contact')
  const ticketContact = contactField ? values[contactField.id] : undefined

  // Get ticket_number for timeline
  const numberField = getFieldBySystemAttribute(allFields, 'ticket_number')
  const ticketNumber = numberField ? values[numberField.id] : undefined

  if (addedAssignees.length > 0) {
    publisher.publishLater({
      type: 'ticket:assignee:added',
      data: {
        organizationId,
        userId,
        ticketId: existingInstance.id,
        assigneeIds: addedAssignees,
        ...(ticketContact && { ticket_contact: ticketContact }),
        ...(ticketNumber && { ticket_number: ticketNumber }),
      },
    })
  }

  if (removedAssignees.length > 0) {
    publisher.publishLater({
      type: 'ticket:assignee:removed',
      data: {
        organizationId,
        userId,
        ticketId: existingInstance.id,
        assigneeIds: removedAssignees,
        ...(ticketContact && { ticket_contact: ticketContact }),
        ...(ticketNumber && { ticket_number: ticketNumber }),
      },
    })
  }

  return values
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKET HOOKS REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ticket hooks registry.
 *
 * Note: No validation hooks - handled by field options in entity-seeder.
 * Note: No prevent-update hooks - handled by field capabilities (isUpdatable: false).
 */
export const TICKET_HOOKS: SystemHookRegistry = {
  // Auto-generate ticket number on create
  ticket_number: [autoGenerateTicketNumber],

  // Status changes -> update timestamps, publish events
  ticket_status: [updateResolvedTimestamp, updateClosedTimestamp, publishStatusChangeEvent],

  // Assignee changes -> publish events for timeline
  ticket_assignees: [publishAssigneeChangeEvent],
}
