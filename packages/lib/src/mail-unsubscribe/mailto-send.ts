// packages/lib/src/mail-unsubscribe/mailto-send.ts
// Tier 3: `mailto:` — a REAL outbound send from that mailbox's own channel.
//
// Deliberately no new send path. This composes a `SendMessageInput` and hands it
// to the existing `MessageSenderService`, so the send inherits everything that
// already guards outbound mail: the usage guard, the automated-send breaker, the
// suppression list, provider capability validation, reconciliation and the
// `Message` row. A bespoke SMTP call here would bypass all of it.
//
// `MessageSenderService` is imported DYNAMICALLY: it drags the composer,
// reconciler, thread manager, participant/media/file services and the provider
// registry behind it, and this module is imported by the tRPC router and by the
// sweep job, neither of which should pay for that graph (the precedent is
// `jobs/maintenance/mail-counts-reconcile-job.ts`'s `import('../../realtime')`).

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'

/** An RFC 2368 `mailto:` broken into the parts the sender service wants. */
export interface ParsedUnsubscribeMailto {
  to: string
  subject: string | null
  body: string | null
}

/**
 * Parse a `List-Unsubscribe` mailto target.
 *
 * Accepts both a bare address and a full `mailto:` URI with the RFC 2368
 * `?subject=`/`?body=` query — the subject is frequently the token that
 * identifies the subscription, so dropping it would send a mail the list server
 * cannot act on.
 *
 * Header-injection defense: any address containing CR/LF is refused rather than
 * sanitized. A sanitized value is a value we changed silently.
 */
export function parseUnsubscribeMailto(raw: string): ParsedUnsubscribeMailto {
  const trimmed = raw.trim().replace(/^<|>$/g, '')
  if (!trimmed) throw new BadRequestError('The unsubscribe mailto is empty')
  if (/[\r\n]/.test(trimmed)) {
    throw new BadRequestError('The unsubscribe mailto contains line breaks')
  }

  const withScheme = trimmed.toLowerCase().startsWith('mailto:') ? trimmed : `mailto:${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new BadRequestError('The unsubscribe mailto is not a valid address')
  }

  const to = decodeURIComponent(url.pathname).trim()
  if (!to || !to.includes('@')) {
    throw new BadRequestError('The unsubscribe mailto has no recipient address')
  }

  return {
    to,
    subject: url.searchParams.get('subject'),
    body: url.searchParams.get('body'),
  }
}

/**
 * The channel an inbox sends FROM.
 *
 * `InboxIntegration` is unique on `integrationId`, so one channel links to
 * exactly one inbox (channels guide §1). Disconnect is a SOFT delete, so the
 * `deletedAt IS NULL` clause is mandatory — without it a disconnected channel
 * is a live send target that will fail at the provider.
 */
export async function resolveInboxSendChannel(
  db: Database,
  organizationId: string,
  inboxId: string,
  preferredIntegrationId?: string | null
): Promise<string> {
  const rows = await db
    .select({
      integrationId: schema.InboxIntegration.integrationId,
      isDefault: schema.InboxIntegration.isDefault,
    })
    .from(schema.InboxIntegration)
    .innerJoin(schema.Integration, eq(schema.Integration.id, schema.InboxIntegration.integrationId))
    .where(
      and(
        eq(schema.InboxIntegration.inboxId, inboxId),
        eq(schema.Integration.organizationId, organizationId),
        isNull(schema.Integration.deletedAt)
      )
    )

  if (rows.length === 0) {
    throw new NotFoundError('This inbox has no connected channel to send from')
  }

  // Prefer the channel the mail actually ARRIVED on — replying from the mailbox
  // the list has on file is what makes the unsubscribe recognizable to it.
  const arrival = rows.find((row) => row.integrationId === preferredIntegrationId)
  if (arrival) return arrival.integrationId

  return (rows.find((row) => row.isDefault) ?? rows[0]!).integrationId
}

export interface SendMailtoUnsubscribeInput {
  organizationId: string
  inboxId: string
  userId: string
  /** The raw `unsubscribeMeta.mailto` value. */
  mailto: string
  /** The channel the sample message arrived on; preferred when still connected. */
  preferredIntegrationId?: string | null
}

export interface SendMailtoUnsubscribeResult {
  messageId: string
  /** The address we mailed — the confirm dialog names it (§6.1). */
  to: string
  integrationId: string
}

/**
 * Send the unsubscribe mail from the inbox's own channel.
 *
 * The default subject is `unsubscribe`, which is what list servers that publish
 * a bare address expect; a `?subject=` in the URI always wins over it because
 * that token is how the server identifies the subscription.
 */
export async function sendMailtoUnsubscribe(
  db: Database,
  input: SendMailtoUnsubscribeInput
): Promise<SendMailtoUnsubscribeResult> {
  const parsed = parseUnsubscribeMailto(input.mailto)
  const integrationId = await resolveInboxSendChannel(
    db,
    input.organizationId,
    input.inboxId,
    input.preferredIntegrationId
  )

  const [{ MessageSenderService }, { ProviderRegistryService }] = await Promise.all([
    import('../messages/message-sender.service'),
    import('../providers/provider-registry-service'),
  ])

  const sender = new MessageSenderService(
    input.organizationId,
    new ProviderRegistryService(input.organizationId),
    db
  )

  const sent = await sender.sendMessage({
    userId: input.userId,
    organizationId: input.organizationId,
    integrationId,
    subject: parsed.subject ?? 'unsubscribe',
    textPlain: parsed.body ?? 'Please unsubscribe this address from your list.',
    to: [{ identifier: parsed.to, identifierType: 'EMAIL' }],
  })

  if (!sent?.id) throw new BadRequestError('The unsubscribe mail could not be sent')

  return { messageId: sent.id, to: parsed.to, integrationId }
}
