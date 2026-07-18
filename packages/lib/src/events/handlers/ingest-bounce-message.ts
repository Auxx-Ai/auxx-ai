// packages/lib/src/events/handlers/ingest-bounce-message.ts
// Gmail/Outlook-channel bounce ingestion (plans/signals/05-machine-mail-bounce.md §4): the
// mirror of the SES Phase-1 bounce path (packages/lib/src/signals/email-events.ts) for the
// bounces SES/SNS never sees — Google/Microsoft deliver `mailer-daemon` NDRs into the user's
// own inbox as ordinary inbound mail.
//
// New `message:received` subscriber. Fires only on hard-tier machine mail that is a
// delivery-status notification; resolves the ORIGINAL send it bounced, and — only on a
// permanent (5.x.x) failure — marks that send `BOUNCED`, records an `email:bounced` signal for
// the linked contact, and suppresses the failed recipient so the next automated send fails
// loudly. Everything is a no-op (log + return) when anything can't be resolved — never guess.

import { database as db, schema } from '@auxx/database'
import { SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { normalizeEmail, upsertSuppression } from '../../sequences/suppression'
import { parseBounceDsn } from '../../signals/bounce-dsn'
import { recordSignal, toSignalRecordKey } from '../../signals/record-signal'
import { SIGNAL_KINDS } from '../../signals/types'
import type { AuxxEvent, MessageReceivedEvent } from '../types'

const logger = createScopedLogger('handler:ingest-bounce-message')

type MessageWithParticipants = NonNullable<Awaited<ReturnType<typeof loadMessage>>>

async function loadMessage(messageId: string, organizationId: string) {
  return db.query.Message.findFirst({
    where: and(eq(schema.Message.id, messageId), eq(schema.Message.organizationId, organizationId)),
    with: {
      from: true,
      participants: { with: { participant: true } },
    },
  })
}

/** Lowercased recipient email → linked contact `EntityInstance.id` (or null) for a message's
 * participants, plus the ordered `TO` emails for the recipient fallback. */
function indexParticipants(message: MessageWithParticipants): {
  contactByEmail: Map<string, string | null>
  toEmails: string[]
} {
  const contactByEmail = new Map<string, string | null>()
  const toEmails: string[] = []
  for (const mp of message.participants) {
    const participant = mp.participant
    if (!participant || participant.identifierType !== 'EMAIL') continue
    const email = normalizeEmail(participant.identifier)
    contactByEmail.set(email, participant.entityInstanceId ?? mp.entityInstanceId ?? null)
    if (mp.role === 'TO') toEmails.push(email)
  }
  return { contactByEmail, toEmails }
}

/**
 * Resolve the original send the NDR bounced. Primary (verified against the incident data —
 * Gmail threads the NDR into the same thread as our failed send): the latest OUTBOUND message
 * in the NDR's thread created before the NDR. Fallback: match the DSN's In-Reply-To /
 * References / embedded original `Message-ID` against `Message.internetMessageId`.
 */
async function resolveOriginalMessage(
  ndr: MessageWithParticipants,
  originalMessageIds: string[]
): Promise<MessageWithParticipants | null> {
  const ndrCreatedAt = ndr.createdAt

  const latestOutbound = await db.query.Message.findFirst({
    where: and(
      eq(schema.Message.threadId, ndr.threadId),
      eq(schema.Message.organizationId, ndr.organizationId),
      eq(schema.Message.isInbound, false),
      lt(schema.Message.createdAt, ndrCreatedAt)
    ),
    orderBy: [desc(schema.Message.createdAt)],
    with: {
      from: true,
      participants: { with: { participant: true } },
    },
  })
  if (latestOutbound) return latestOutbound

  if (originalMessageIds.length > 0) {
    const byMessageId = await db.query.Message.findFirst({
      where: and(
        eq(schema.Message.organizationId, ndr.organizationId),
        eq(schema.Message.isInbound, false),
        inArray(schema.Message.internetMessageId, originalMessageIds)
      ),
      with: {
        from: true,
        participants: { with: { participant: true } },
      },
    })
    if (byMessageId) return byMessageId
  }

  return null
}

/**
 * `message:received` → on a hard-tier delivery-status NDR: mark the bounced original send
 * `BOUNCED`, record `email:bounced`, and suppress the failed recipient (permanent 5.x.x only).
 */
export const ingestBounceMessage = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'message:received') return
  const data = (event as MessageReceivedEvent).data

  // Only hard-tier machine mail (bounces/NDRs/daemon senders) can be a bounce.
  if (data.machineMail?.tier !== 'hard') return

  const { messageId, organizationId } = data

  const message = await loadMessage(messageId, organizationId)
  if (!message) {
    logger.debug('NDR message not found, skipping bounce ingestion', { messageId, organizationId })
    return
  }

  const headers = (message.metadata as { headers?: Record<string, unknown> } | null)?.headers as
    | Record<string, string | string[] | undefined>
    | undefined

  const parsed = parseBounceDsn({
    headers,
    fromEmail: message.from?.identifier ?? null,
    textPlain: message.textPlain,
    textHtml: message.textHtml,
    snippet: message.snippet,
  })

  // Confirm this hard machine mail is actually a DSN — the detector's `delivery-status` reason
  // or the parser's own header/body cues. Plain auto-generated hard mail is a no-op.
  const isDsn = data.machineMail.reason === 'delivery-status' || parsed.isDsn
  if (!isDsn) {
    logger.debug('Hard machine mail is not a delivery-status NDR, skipping', {
      messageId,
      organizationId,
      reason: data.machineMail.reason,
    })
    return
  }

  const original = await resolveOriginalMessage(message, parsed.originalMessageIds)
  if (!original) {
    logger.info('Could not resolve the bounced original send, skipping', {
      messageId,
      organizationId,
      threadId: message.threadId,
    })
    return
  }

  // Permanent (5.x.x / 5xx) failures only. Transient (4.x.x delays, "mailbox full") and
  // no-code-at-all neither suppress nor mark BOUNCED — a temporary condition must not
  // permanently blacklist an address.
  if (!parsed.permanent) {
    logger.info('Non-permanent NDR, no BOUNCED/suppression/signal', {
      messageId,
      organizationId,
      statusCode: parsed.statusCode,
    })
    return
  }

  const { contactByEmail, toEmails } = indexParticipants(original)

  // Failed recipient: parsed from the DSN, else the original send's first TO participant.
  const failedEmail = parsed.failedRecipient ?? toEmails[0] ?? null
  if (!failedEmail) {
    logger.info('Permanent NDR but no failed recipient could be resolved, skipping', {
      messageId,
      organizationId,
      originalMessageId: original.id,
    })
    return
  }

  // Mark the original send BOUNCED (idempotent).
  await db
    .update(schema.Message)
    .set({ sendStatus: SendStatus.BOUNCED })
    .where(eq(schema.Message.id, original.id))

  const contactEntityInstanceId = contactByEmail.get(failedEmail) ?? null

  // Suppress the failed recipient — a failed recipient with no linked contact still gets
  // suppression + BOUNCED, just no signal (recordSignal needs a contact linkage).
  await upsertSuppression(db, {
    organizationId,
    email: failedEmail,
    contactEntityInstanceId,
    reason: 'bounce',
  })

  if (!contactEntityInstanceId) {
    logger.info('Recorded bounce suppression for a recipient with no linked contact', {
      messageId,
      organizationId,
      originalMessageId: original.id,
    })
    return
  }

  const occurredAt = message.receivedAt ?? message.createdAt
  const result = await recordSignal({
    organizationId,
    kind: 'email:bounced',
    subtype: 'hard',
    occurredAt,
    // Derived from the NDR message id so reprocessing the same event is idempotent.
    dedupeKey: `ndr:${message.id}:${failedEmail}`,
    contactEntityInstanceId,
    messageId: original.id,
    threadId: original.threadId,
    title: original.subject ?? SIGNAL_KINDS['email:bounced'].label,
    metadata: {
      bounceType: 'hard',
      source: 'ndr',
      ndrMessageId: message.id,
      failedRecipient: failedEmail,
      statusCode: parsed.statusCode,
    },
    links: [toSignalRecordKey('contact', contactEntityInstanceId)],
  })

  if (result.error) {
    logger.error('Failed to record email:bounced signal from NDR', {
      messageId,
      organizationId,
      error: result.error.message,
    })
    throw result.error
  }
}
