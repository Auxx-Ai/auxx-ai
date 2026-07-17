// packages/lib/src/events/handlers/derive-message-signals.ts
// In-app derived signals (plans/signals/01-signal-store.md "In-app derived signals — ship
// with Phase 0"): small bus handlers that turn existing events into `EntitySignal` rows, no
// new tracking infra. Both handlers below resolve their contact from the DB rather than
// trusting event-payload fields — those are populated inconsistently by their producers (a
// pre-existing condition, not introduced here) — so a direct, indexed read is the only
// reliable path.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../../cache'
import { recordSignal, toSignalRecordKey } from '../../signals/record-signal'
import { getTerminalStages } from '../../work-items/stale-defaults'
import type { AuxxEvent, MessageReceivedEvent } from '../types'

const logger = createScopedLogger('handler:derive-message-signals')

/**
 * `message:received` → `message:replied` signal, when the inbound message's sender resolves
 * to a known contact. This is also the trigger for task auto-complete (04) — the dedupeKey is
 * stable (`derived:replied:<messageId>`) so re-delivery of the same event never double-writes.
 */
export const deriveMessageReplySignal = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'message:received') return

  const { messageId, organizationId } = (event as MessageReceivedEvent).data

  const message = await db.query.Message.findFirst({
    where: and(eq(schema.Message.id, messageId), eq(schema.Message.organizationId, organizationId)),
    with: { from: true },
  })

  if (!message) {
    logger.debug('Message not found, skipping message:replied signal', {
      messageId,
      organizationId,
    })
    return
  }

  if (!message.isInbound) return

  const sender = message.from
  if (!sender || sender.isInternal) return

  if (!sender.entityInstanceId) {
    logger.debug('Sender participant has no linked contact, skipping message:replied signal', {
      messageId,
      organizationId,
      participantId: sender?.id,
    })
    return
  }

  const contactEntityInstanceId = sender.entityInstanceId
  const occurredAt = message.receivedAt ?? message.createdAt

  const result = await recordSignal({
    organizationId,
    kind: 'message:replied',
    subtype: 'default',
    occurredAt,
    dedupeKey: `derived:replied:${messageId}`,
    contactEntityInstanceId,
    messageId,
    threadId: message.threadId,
    title: message.subject ?? 'Replied',
    links: [toSignalRecordKey('contact', contactEntityInstanceId)],
  })

  if (result.error) {
    logger.error('Failed to record message:replied signal', {
      messageId,
      organizationId,
      error: result.error.message,
    })
    throw result.error
  }
}

/** The declared `TicketStatusChangedEvent['data']` shape (`recordId`/`eventData`) doesn't
 * match what its producers actually publish — `ticket-service.ts` sends `{ ticketId, status }`,
 * `ticket-hooks.ts` sends `{ ticketId, ticket_status, old_ticket_status, ... }` (pre-existing,
 * not introduced here — both already fail `tsc` against the declared type). Read the real
 * shape defensively instead of trusting `TicketStatusChangedEvent`. */
interface TicketStatusChangedPayload {
  organizationId: string
  ticketId?: string
  status?: string
  ticket_status?: string
}

/**
 * `ticket:status:changed` → `thread:resolved` signal, when the new status is in the ticket
 * terminal-stage set (`resolved` | `closed`, mirroring `getTerminalStages('tickets')` from the
 * stale-scanner defaults). dedupeKey is scoped to the calendar day of the change so
 * same-day status flapping (resolved → reopened → resolved) dedupes, but re-resolution on a
 * later day is a new signal.
 */
export const deriveThreadResolvedSignal = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'ticket:status:changed') return

  const data = event.data as unknown as TicketStatusChangedPayload
  const { organizationId } = data
  const ticketId = data.ticketId
  const newStatus = data.ticket_status ?? data.status

  if (!ticketId || !newStatus) {
    logger.debug('ticket:status:changed missing ticketId/status, skipping thread:resolved signal', {
      organizationId,
    })
    return
  }

  if (!getTerminalStages('tickets').has(newStatus.toLowerCase())) return

  const contactEntityInstanceId = await resolveTicketContactId(organizationId, ticketId)
  if (!contactEntityInstanceId) {
    logger.debug('Ticket has no linked contact, skipping thread:resolved signal', {
      ticketId,
      organizationId,
    })
    return
  }

  const occurredAt = new Date()
  const dayLabel = occurredAt.toISOString().slice(0, 10)

  const result = await recordSignal({
    organizationId,
    kind: 'thread:resolved',
    subtype: 'default',
    occurredAt,
    dedupeKey: `derived:resolved:${ticketId}:${newStatus.toLowerCase()}:${dayLabel}`,
    contactEntityInstanceId,
    title: 'Thread resolved',
    links: [toSignalRecordKey('contact', contactEntityInstanceId)],
  })

  if (result.error) {
    logger.error('Failed to record thread:resolved signal', {
      ticketId,
      organizationId,
      error: result.error.message,
    })
    throw result.error
  }
}

/**
 * Resolve a ticket's linked contact `EntityInstance.id` via the `ticket_contact` RELATION
 * field — a single indexed `FieldValue` read (`entityId` + `fieldId`), not the event payload
 * (unreliable — see the note on `TicketStatusChangedPayload` above).
 */
async function resolveTicketContactId(
  organizationId: string,
  ticketEntityInstanceId: string
): Promise<string | null> {
  const entityDefId = await getCachedEntityDefId(organizationId, 'ticket')
  if (!entityDefId) return null

  const fields = await getCachedCustomFields(organizationId, entityDefId)
  const contactField = fields.find((field) => field.systemAttribute === 'ticket_contact')
  if (!contactField) return null

  const fieldValue = await db.query.FieldValue.findFirst({
    where: and(
      eq(schema.FieldValue.entityId, ticketEntityInstanceId),
      eq(schema.FieldValue.fieldId, contactField.id)
    ),
    columns: { relatedEntityId: true },
  })

  return fieldValue?.relatedEntityId ?? null
}
