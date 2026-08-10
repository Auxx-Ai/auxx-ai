// packages/lib/src/mail-unsubscribe/unsubscribe-queries.ts
// Reads for MailUnsubscribe + the "what can we do about this list?" resolution.
// Functional Drizzle + neverthrow — no service class (docs/lib-module-guide.md).
//
// ZERO permission checks by design (lib-module-guide §6): the router asserts the
// §7.1 branch (own personal inbox ⇒ ownership alone; shared inbox ⇒ inbox READ
// authority, and NOT `automationRules.manage`) and hands the allowed inbox ids
// down as `opts.inboxIds`, which this module turns into a WHERE fragment. A
// post-read `.filter()` would leak counts even where it hides content.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { parseUnsubscribeMeta, selectUnsubscribeMethod } from './client'
import { buildSubjectKeyPredicate } from './subject-key'
import { type MailUnsubscribeRow, toMailUnsubscribeRow, type UnsubscribeTarget } from './types'

/** Optional list scope. `inboxIds` is applied in SQL — never fetch-then-filter. */
export interface ListMailUnsubscribesOptions {
  /**
   * Restrict to these inboxes. An EMPTY array means "no inbox is visible to
   * this caller" and returns nothing — NOT the same as omitting the option,
   * which returns the whole org. A caller that computed an empty allow-list
   * must not fall through to an unscoped read.
   */
  inboxIds?: string[]
}

/**
 * Every unsubscribe request in the org, newest first — backs the settings list
 * and the "N senders ignored you" surface.
 */
export async function listMailUnsubscribes(
  db: Database,
  organizationId: string,
  opts: ListMailUnsubscribesOptions = {}
): Promise<Result<MailUnsubscribeRow[], Error>> {
  if (opts.inboxIds && opts.inboxIds.length === 0) return ok([])

  const rows = await db
    .select()
    .from(schema.MailUnsubscribe)
    .where(
      and(
        eq(schema.MailUnsubscribe.organizationId, organizationId),
        ...(opts.inboxIds ? [inArray(schema.MailUnsubscribe.inboxId, opts.inboxIds)] : [])
      )
    )
    .orderBy(desc(schema.MailUnsubscribe.requestedAt))

  return ok(rows.map(toMailUnsubscribeRow))
}

/**
 * The one row for `(org, inbox, subjectKey)`, or null.
 *
 * Null rather than a `NotFoundError`: "we have never unsubscribed from this
 * list" is the ordinary case on every card render, not an exception.
 */
export async function getMailUnsubscribe(
  db: Database,
  organizationId: string,
  inboxId: string,
  subjectKey: string
): Promise<Result<MailUnsubscribeRow | null, Error>> {
  const [row] = await db
    .select()
    .from(schema.MailUnsubscribe)
    .where(
      and(
        eq(schema.MailUnsubscribe.organizationId, organizationId),
        eq(schema.MailUnsubscribe.inboxId, inboxId),
        eq(schema.MailUnsubscribe.subjectKey, subjectKey)
      )
    )
    .limit(1)

  return ok(row ? toMailUnsubscribeRow(row) : null)
}

/** Load one row by id, org-scoped. */
export async function getMailUnsubscribeById(
  db: Database,
  organizationId: string,
  id: string
): Promise<Result<MailUnsubscribeRow, Error>> {
  const [row] = await db
    .select()
    .from(schema.MailUnsubscribe)
    .where(
      and(
        eq(schema.MailUnsubscribe.id, id),
        eq(schema.MailUnsubscribe.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row) return err(new NotFoundError('Unsubscribe record not found'))
  return ok(toMailUnsubscribeRow(row))
}

/**
 * The newest inbound message in a group that actually CARRIES a
 * `List-Unsubscribe` header.
 *
 * ⚠️ Load-bearing, and the reason {@link resolveUnsubscribeTarget} is two reads.
 * A bulk sender does not put the header on every message: on real data,
 * `list:auxx-ai.auxx-ai.github.com` had 14 of 249 messages with
 * `unsubscribeMeta` and none of them was the newest. The miner's grouped query
 * takes the newest NON-NULL meta (`array_agg(...) FILTER (WHERE ... IS NOT
 * NULL)`), so it wrote an `unsubscribe` card advertising `one-click` — while
 * this resolver, reading the newest message unconditionally, answered
 * `refused: no-unsubscribe-method`. A card that offers an unsubscribe the
 * executor then refuses is the worst of both: the user clicks and is told the
 * sender publishes no unsubscribe address, which is false.
 *
 * The two sides now agree: the card's method and the executed method both come
 * from the freshest message that has a header. This is also what
 * {@link resolveUnsubscribeTarget}'s contract always said it did.
 */
async function findFreshestUnsubscribeMeta(
  db: Database,
  organizationId: string,
  inboxId: string,
  subjectKey: string
): Promise<unknown> {
  const [row] = await db
    .select({ unsubscribeMeta: schema.Message.unsubscribeMeta })
    .from(schema.Message)
    .innerJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
    .where(
      and(
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Thread.inboxId, inboxId),
        eq(schema.Message.isInbound, true),
        isNotNull(schema.Message.unsubscribeMeta),
        buildSubjectKeyPredicate(subjectKey)
      )
    )
    .orderBy(desc(schema.Message.receivedAt), desc(schema.Message.createdAt))
    .limit(1)

  return row?.unsubscribeMeta ?? null
}

/**
 * Resolve what we can actually do about one bulk-mail group in one inbox.
 *
 * Reads the NEWEST inbound message in the group for the GATE inputs — `listId`
 * and `senderAuthenticated` are per-message verdicts and the newest one is the
 * current state of the sender — then, when that message carries no
 * `List-Unsubscribe`, falls back to {@link findFreshestUnsubscribeMeta} for the
 * header itself. Headers change over a campaign's life and are not on every
 * message; the freshest one that EXISTS is the one most likely to still resolve.
 * The result runs through {@link selectUnsubscribeMethod}, which applies the
 * §6.2 safety gate before choosing a tier.
 *
 * The gate inputs deliberately do NOT move to the fallback row: reading
 * `senderAuthenticated` off an older message could turn an unauthenticated
 * sender into an offered unsubscribe, which is exactly what invariant 3 forbids.
 * Only the header travels.
 *
 * The join to `Thread` is how the inbox scope is applied: `Message` carries no
 * `inboxId`, `Thread` does. The `fromId → Participant` join supplies the CRM
 * contact when the sender maps to one, so the `mail:unsubscribed_from` signal
 * can land on a timeline without a second lookup.
 *
 * Returns `NotFoundError` when the inbox holds no mail from that group at all —
 * an unsubscribe request against a group we have never received is meaningless.
 */
export async function resolveUnsubscribeTarget(
  db: Database,
  organizationId: string,
  inboxId: string,
  subjectKey: string
): Promise<Result<UnsubscribeTarget, Error>> {
  const [row] = await db
    .select({
      messageId: schema.Message.id,
      threadId: schema.Message.threadId,
      integrationId: schema.Message.integrationId,
      subject: schema.Message.subject,
      listId: schema.Message.listId,
      senderAuthenticated: schema.Message.senderAuthenticated,
      unsubscribeMeta: schema.Message.unsubscribeMeta,
      senderIdentifier: schema.Participant.identifier,
      contactEntityInstanceId: schema.Participant.entityInstanceId,
    })
    .from(schema.Message)
    .innerJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
    .leftJoin(schema.Participant, eq(schema.Participant.id, schema.Message.fromId))
    .where(
      and(
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Thread.inboxId, inboxId),
        eq(schema.Message.isInbound, true),
        buildSubjectKeyPredicate(subjectKey)
      )
    )
    .orderBy(desc(schema.Message.receivedAt), desc(schema.Message.createdAt))
    .limit(1)

  if (!row) return err(new NotFoundError('No mail from this sender in this inbox'))

  const unsubscribeMeta =
    parseUnsubscribeMeta(row.unsubscribeMeta) ??
    parseUnsubscribeMeta(await findFreshestUnsubscribeMeta(db, organizationId, inboxId, subjectKey))

  return ok({
    messageId: row.messageId,
    threadId: row.threadId,
    integrationId: row.integrationId,
    subject: row.subject,
    senderIdentifier: row.senderIdentifier ?? null,
    contactEntityInstanceId: row.contactEntityInstanceId ?? null,
    offer: selectUnsubscribeMethod({
      listId: row.listId,
      senderAuthenticated: row.senderAuthenticated,
      unsubscribeMeta,
    }),
  })
}
