// packages/lib/src/signals/email-events.ts
// SES → SNS (HTTPS subscription) event ingestion — Phase 1 of
// plans/signals/02-email-engagement.md "Phase 1 — SES event ingestion". SES is the only ESP;
// there is deliberately no Mailgun ingestion here (see the plan doc's 2026-07-17 ESP note).
//
// Two entry points, used together by `apps/api/src/routes/email-events.ts`:
//   1. `verifySnsMessage` — parses + cryptographically verifies the raw POST body against the
//      AWS SNS message-signing spec, with no new npm dependency (plain `node:crypto`).
//   2. `handleSnsEnvelope` — dispatches a verified envelope: confirms subscriptions, and for
//      `Notification`s parses the SES event JSON (Bounce/Complaint/Delivery) and turns it into
//      `EntitySignal` rows via `recordSignals`, plus the side effects a bounce/complaint must
//      have (`Message.sendStatus`, `SequenceSuppression`) — signals without consequences are
//      decorative.

import crypto from 'node:crypto'
import { configService } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { ErrorResult, Result, type TypedResult } from '../result'
import { normalizeEmail, upsertSuppression } from '../sequences/suppression'
import { type RecordSignalInput, recordSignals, toSignalRecordKey } from './record-signal'
import { SIGNAL_KINDS } from './types'

const logger = createScopedLogger('signals-email-events')

// -------------------------------------------------------------------------------------------
// SNS envelope types
// -------------------------------------------------------------------------------------------

interface SnsMessageBase {
  MessageId: string
  TopicArn: string
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  Message: string
}

export interface SnsNotification extends SnsMessageBase {
  Type: 'Notification'
  Subject?: string
  UnsubscribeURL?: string
}

export interface SnsSubscriptionConfirmation extends SnsMessageBase {
  Type: 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  SubscribeURL: string
  Token: string
}

/** A parsed + signature-verified SNS HTTPS-delivery envelope. */
export type SnsMessage = SnsNotification | SnsSubscriptionConfirmation

// -------------------------------------------------------------------------------------------
// Signature verification (AWS SNS message-signing spec — no new npm dependency)
// -------------------------------------------------------------------------------------------

/** In-memory cert cache keyed by `SigningCertURL` — AWS SNS signing certs rotate rarely, and a
 * rotation always mints a new URL, so a stale cache entry can never be served under a live
 * URL. Module-level: shared across every call in this process. */
const certCache = new Map<string, string>()

/** `SigningCertURL` host must be `sns.<region>.amazonaws.com` — rejects anything else outright
 * (including subdomains crafted to fool a naive substring check). */
const SIGNING_CERT_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i

async function fetchSigningCert(url: string): Promise<TypedResult<string, Error>> {
  const cached = certCache.get(url)
  if (cached) return Result.ok(cached)

  try {
    const response = await fetch(url)
    if (!response.ok) {
      return Result.error(new Error(`Failed to fetch SNS signing cert: HTTP ${response.status}`))
    }
    const cert = await response.text()
    certCache.set(url, cert)
    return Result.ok(cert)
  } catch (error) {
    return Result.error(
      error instanceof Error ? error : new Error('Failed to fetch SNS signing cert')
    )
  }
}

/** Fields (in canonical order) that go into the string-to-sign, per SNS message `Type` — each
 * serialized as `${key}\n${value}\n`; a missing optional field (`Subject` on a `Notification`
 * without one) is omitted entirely rather than serialized empty. */
function canonicalFieldsForType(type: SnsMessage['Type']): string[] {
  if (type === 'Notification') {
    return ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
  }
  return ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
}

function buildStringToSign(envelope: Record<string, unknown>): string {
  const fields = canonicalFieldsForType(envelope.Type as SnsMessage['Type'])
  let stringToSign = ''
  for (const field of fields) {
    const value = envelope[field]
    if (value === undefined || value === null) continue
    stringToSign += `${field}\n${String(value)}\n`
  }
  return stringToSign
}

function verifySignature(
  stringToSign: string,
  signature: string,
  signatureVersion: string,
  certPem: string
): boolean {
  // SignatureVersion '1' = SHA1withRSA, '2' = SHA256withRSA (AWS SNS spec).
  const algorithm = signatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1'
  const verifier = crypto.createVerify(algorithm)
  verifier.update(stringToSign, 'utf8')
  verifier.end()
  try {
    // Node's Verify#verify accepts a PEM-encoded X.509 certificate directly — no need to
    // extract the public key first.
    return verifier.verify(certPem, signature, 'base64')
  } catch {
    return false
  }
}

/**
 * Parse + cryptographically verify a raw SNS HTTPS-delivery POST body (AWS's message-signing
 * spec) using only `node:crypto` — no new npm dependency. Validates `SigningCertURL` is an
 * `https://sns.<region>.amazonaws.com/...` URL, fetches (and caches) that cert, rebuilds the
 * canonical string-to-sign for the envelope's `Type`, and verifies `Signature` against it.
 * Optionally pins `TopicArn` to `configService.get('SES_SNS_TOPIC_ARN')` when that's set.
 */
export async function verifySnsMessage(rawBody: string): Promise<TypedResult<SnsMessage, Error>> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return Result.error(new Error('Invalid SNS envelope: not JSON'))
  }

  const type = parsed.Type
  if (
    type !== 'Notification' &&
    type !== 'SubscriptionConfirmation' &&
    type !== 'UnsubscribeConfirmation'
  ) {
    return Result.error(new Error(`Invalid SNS envelope: unknown Type "${String(type)}"`))
  }

  const requiredBase = [
    'MessageId',
    'TopicArn',
    'Timestamp',
    'SignatureVersion',
    'Signature',
    'SigningCertURL',
    'Message',
  ]
  const requiredForType = type === 'Notification' ? [] : ['SubscribeURL', 'Token']
  for (const key of [...requiredBase, ...requiredForType]) {
    if (typeof parsed[key] !== 'string') {
      return Result.error(new Error(`Invalid SNS envelope: missing "${key}"`))
    }
  }

  const signingCertUrl = parsed.SigningCertURL as string
  let parsedCertUrl: URL
  try {
    parsedCertUrl = new URL(signingCertUrl)
  } catch {
    return Result.error(new Error('Invalid SigningCertURL'))
  }
  if (parsedCertUrl.protocol !== 'https:' || !SIGNING_CERT_HOST_RE.test(parsedCertUrl.hostname)) {
    return Result.error(new Error(`Untrusted SigningCertURL host: ${parsedCertUrl.hostname}`))
  }

  const pinnedTopicArn = configService.get<string>('SES_SNS_TOPIC_ARN')
  if (pinnedTopicArn && parsed.TopicArn !== pinnedTopicArn) {
    return Result.error(new Error(`Unexpected TopicArn: ${String(parsed.TopicArn)}`))
  }

  const certResult = await fetchSigningCert(signingCertUrl)
  if (certResult instanceof ErrorResult) return Result.error(certResult.error)

  const stringToSign = buildStringToSign(parsed)
  const signatureValid = verifySignature(
    stringToSign,
    parsed.Signature as string,
    parsed.SignatureVersion as string,
    certResult.value
  )
  if (!signatureValid) {
    return Result.error(new Error('SNS signature verification failed'))
  }

  return Result.ok(parsed as unknown as SnsMessage)
}

// -------------------------------------------------------------------------------------------
// SES event payload (SESv2 event-publishing format — the JSON inside `envelope.Message`)
// -------------------------------------------------------------------------------------------

interface SesMail {
  messageId: string
  timestamp: string
}

interface SesBouncedRecipient {
  emailAddress: string
  diagnosticCode?: string
}

interface SesBounce {
  bounceType: 'Permanent' | 'Transient' | 'Undetermined'
  timestamp: string
  bouncedRecipients: SesBouncedRecipient[]
}

interface SesComplainedRecipient {
  emailAddress: string
}

interface SesComplaint {
  timestamp: string
  complaintFeedbackType?: string
  complainedRecipients: SesComplainedRecipient[]
}

interface SesDelivery {
  timestamp: string
  recipients: string[]
}

interface SesEvent {
  /** `'Bounce' | 'Complaint' | 'Delivery'` handled here; `'Send' | 'Open' | 'Click' | ...`
   * (our own pixel/link instrumentation is Phase 2) logged and skipped. */
  eventType: string
  mail: SesMail
  bounce?: SesBounce
  complaint?: SesComplaint
  delivery?: SesDelivery
}

// -------------------------------------------------------------------------------------------
// Envelope dispatch
// -------------------------------------------------------------------------------------------

/**
 * Dispatch an already-verified SNS envelope: confirms subscription/unsubscribe handshakes, and
 * for `Notification`s parses the SES event JSON and routes Bounce/Complaint/Delivery to their
 * handlers below (other event types are logged and skipped — the plan's own pixel/link
 * instrumentation, Phase 2, covers Open/Click). Never throws for "we don't recognize this" —
 * only for genuinely unexpected errors — so the caller can always ack the SNS delivery with a
 * 2xx and avoid pointless retries.
 */
export async function handleSnsEnvelope(
  envelope: SnsMessage
): Promise<TypedResult<{ handled: string }, Error>> {
  if (envelope.Type === 'SubscriptionConfirmation') {
    try {
      await fetch(envelope.SubscribeURL)
      logger.info('Confirmed SNS subscription', { topicArn: envelope.TopicArn })
      return Result.ok({ handled: 'subscription_confirmed' })
    } catch (error) {
      return Result.error(
        error instanceof Error ? error : new Error('Failed to confirm SNS subscription')
      )
    }
  }

  if (envelope.Type === 'UnsubscribeConfirmation') {
    logger.info('SNS unsubscribe confirmation received', { topicArn: envelope.TopicArn })
    return Result.ok({ handled: 'unsubscribe_confirmed' })
  }

  let sesEvent: SesEvent
  try {
    sesEvent = JSON.parse(envelope.Message)
  } catch {
    return Result.error(new Error('Invalid SES event JSON in SNS Message'))
  }

  switch (sesEvent.eventType) {
    case 'Bounce':
      return processBounce(envelope, sesEvent)
    case 'Complaint':
      return processComplaint(envelope, sesEvent)
    case 'Delivery':
      return processDelivery(envelope, sesEvent)
    default:
      logger.info('Skipping SES event type', { eventType: sesEvent.eventType })
      return Result.ok({ handled: `skipped:${sesEvent.eventType}` })
  }
}

// -------------------------------------------------------------------------------------------
// Message + recipient resolution
// -------------------------------------------------------------------------------------------

interface ResolvedMessage {
  id: string
  organizationId: string
  threadId: string
  subject: string | null
  /** Lowercased recipient email → resolved contact `EntityInstance.id` (or `null` when the
   * participant has no linked contact — the signal still gets recorded, just contact-less). */
  participantsByEmail: Map<string, string | null>
}

/** Resolve `mail.messageId` (the SES message id) → the `Message` row it came from, via
 * `Message.externalId` (message-reconciler.service.ts writes it there on send), plus every
 * `TO`/`CC`/`BCC` participant's email → contact mapping. `MessageReceipt` rows are never
 * created for email sends (chat-only table), so recipients are resolved through
 * `Message` → `MessageParticipant` → `Participant` instead. */
async function resolveMessageBySesId(sesMessageId: string): Promise<ResolvedMessage | null> {
  const message = await database.query.Message.findFirst({
    where: eq(schema.Message.externalId, sesMessageId),
    with: {
      participants: { with: { participant: true } },
    },
  })
  if (!message) return null

  const participantsByEmail = new Map<string, string | null>()
  for (const messageParticipant of message.participants) {
    const participant = messageParticipant.participant
    if (!participant || participant.identifierType !== 'EMAIL') continue
    participantsByEmail.set(normalizeEmail(participant.identifier), participant.entityInstanceId)
  }

  return {
    id: message.id,
    organizationId: message.organizationId,
    threadId: message.threadId,
    subject: message.subject,
    participantsByEmail,
  }
}

// -------------------------------------------------------------------------------------------
// Bounce / Complaint / Delivery processing
// -------------------------------------------------------------------------------------------

async function processBounce(
  envelope: SnsNotification | SnsSubscriptionConfirmation,
  event: SesEvent
): Promise<TypedResult<{ handled: string }, Error>> {
  const bounce = event.bounce
  if (!bounce || bounce.bouncedRecipients.length === 0) {
    return Result.ok({ handled: 'bounce_missing_recipients' })
  }

  const message = await resolveMessageBySesId(event.mail.messageId)
  if (!message) {
    logger.info('SES bounce for untracked message — no matching Message.externalId', {
      sesMessageId: event.mail.messageId,
    })
    return Result.ok({ handled: 'message_not_found' })
  }

  const isHard = bounce.bounceType === 'Permanent'
  const occurredAt = new Date(bounce.timestamp)
  const title = message.subject || SIGNAL_KINDS['email:bounced'].label

  // Side effects — each idempotent on its own (a repeat SNS delivery just re-applies the same
  // update/upsert), applied before recordSignals so a crash between the two still leaves
  // consistent state for the retry that follows.
  if (isHard) {
    await database
      .update(schema.Message)
      .set({ sendStatus: SendStatus.BOUNCED })
      .where(eq(schema.Message.id, message.id))

    for (const recipient of bounce.bouncedRecipients) {
      await upsertSuppression(database, {
        organizationId: message.organizationId,
        email: recipient.emailAddress,
        contactEntityInstanceId:
          message.participantsByEmail.get(normalizeEmail(recipient.emailAddress)) ?? null,
        // `SequenceSuppression.reason` (packages/lib/src/sequences/suppression.ts) has no
        // dedicated 'bounce' value — its enum is only 'unsubscribe' | 'manual'. 'unsubscribe'
        // is the closest existing value: both mean "stop sending to this address
        // automatically," which is exactly what a hard bounce implies.
        reason: 'unsubscribe',
      })
    }
  }

  const inputs: RecordSignalInput[] = bounce.bouncedRecipients.map((recipient) => {
    const emailLower = normalizeEmail(recipient.emailAddress)
    const contactEntityInstanceId = message.participantsByEmail.get(emailLower) ?? undefined
    return {
      organizationId: message.organizationId,
      kind: 'email:bounced',
      subtype: isHard ? 'hard' : 'soft',
      occurredAt,
      dedupeKey: `ses:${envelope.MessageId}:${emailLower}`,
      contactEntityInstanceId,
      messageId: message.id,
      threadId: message.threadId,
      title,
      metadata: {
        bounceType: isHard ? 'hard' : 'soft',
        diagnosticCode: recipient.diagnosticCode,
        snsMessageId: envelope.MessageId,
      },
      links: contactEntityInstanceId ? [toSignalRecordKey('contact', contactEntityInstanceId)] : [],
    }
  })

  const result = await recordSignals(inputs)
  if (result instanceof ErrorResult) return Result.error(result.error)
  return Result.ok({ handled: 'bounce' })
}

async function processComplaint(
  envelope: SnsNotification | SnsSubscriptionConfirmation,
  event: SesEvent
): Promise<TypedResult<{ handled: string }, Error>> {
  const complaint = event.complaint
  if (!complaint || complaint.complainedRecipients.length === 0) {
    return Result.ok({ handled: 'complaint_missing_recipients' })
  }

  const message = await resolveMessageBySesId(event.mail.messageId)
  if (!message) {
    logger.info('SES complaint for untracked message — no matching Message.externalId', {
      sesMessageId: event.mail.messageId,
    })
    return Result.ok({ handled: 'message_not_found' })
  }

  const occurredAt = new Date(complaint.timestamp)
  const title = message.subject || SIGNAL_KINDS['email:complained'].label

  for (const recipient of complaint.complainedRecipients) {
    await upsertSuppression(database, {
      organizationId: message.organizationId,
      email: recipient.emailAddress,
      contactEntityInstanceId:
        message.participantsByEmail.get(normalizeEmail(recipient.emailAddress)) ?? null,
      // Same reasoning as the bounce path above — no dedicated 'complaint' reason exists;
      // 'unsubscribe' is the closest existing value (a spam complaint IS an unsubscribe
      // signal, arguably a stronger one).
      reason: 'unsubscribe',
    })
  }

  const inputs: RecordSignalInput[] = complaint.complainedRecipients.map((recipient) => {
    const emailLower = normalizeEmail(recipient.emailAddress)
    const contactEntityInstanceId = message.participantsByEmail.get(emailLower) ?? undefined
    return {
      organizationId: message.organizationId,
      kind: 'email:complained',
      subtype: 'default',
      occurredAt,
      dedupeKey: `ses:${envelope.MessageId}:${emailLower}`,
      contactEntityInstanceId,
      messageId: message.id,
      threadId: message.threadId,
      title,
      metadata: {
        complaintFeedbackType: complaint.complaintFeedbackType,
        snsMessageId: envelope.MessageId,
      },
      links: contactEntityInstanceId ? [toSignalRecordKey('contact', contactEntityInstanceId)] : [],
    }
  })

  const result = await recordSignals(inputs)
  if (result instanceof ErrorResult) return Result.error(result.error)
  return Result.ok({ handled: 'complaint' })
}

async function processDelivery(
  envelope: SnsNotification | SnsSubscriptionConfirmation,
  event: SesEvent
): Promise<TypedResult<{ handled: string }, Error>> {
  const delivery = event.delivery
  if (!delivery || delivery.recipients.length === 0) {
    return Result.ok({ handled: 'delivery_missing_recipients' })
  }

  const message = await resolveMessageBySesId(event.mail.messageId)
  if (!message) {
    logger.info('SES delivery for untracked message — no matching Message.externalId', {
      sesMessageId: event.mail.messageId,
    })
    return Result.ok({ handled: 'message_not_found' })
  }

  const occurredAt = new Date(delivery.timestamp)
  const title = message.subject || SIGNAL_KINDS['email:delivered'].label

  // Signal only — deliberate deviation from the plan doc's "MessageReceipt.deliveredAt" line:
  // `MessageReceipt` rows are never created for email sends (chat-only table per the audit
  // this phase is built on), so there's no receipt row to stamp a `deliveredAt` on.
  const inputs: RecordSignalInput[] = delivery.recipients.map((email) => {
    const emailLower = normalizeEmail(email)
    const contactEntityInstanceId = message.participantsByEmail.get(emailLower) ?? undefined
    return {
      organizationId: message.organizationId,
      kind: 'email:delivered',
      subtype: 'default',
      occurredAt,
      dedupeKey: `ses:${envelope.MessageId}:${emailLower}`,
      contactEntityInstanceId,
      messageId: message.id,
      threadId: message.threadId,
      title,
      metadata: { snsMessageId: envelope.MessageId },
      links: contactEntityInstanceId ? [toSignalRecordKey('contact', contactEntityInstanceId)] : [],
    }
  })

  const result = await recordSignals(inputs)
  if (result instanceof ErrorResult) return Result.error(result.error)
  return Result.ok({ handled: 'delivery' })
}
