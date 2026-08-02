// packages/database/src/db/schema/mail-suggestion.ts
// Drizzle tables: MailSuggestion + MailUnsubscribe — "we looked at your mail and
// noticed something": mined, evidence-carrying proposals (unsubscribe from a
// newsletter nobody reads, auto-archive a sender you archive by hand every time)
// plus the record of unsubscribe requests we actually sent.
// See plans/mail-filter/03-suggestions-plan.md.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

/**
 * A mined proposal about one bulk-mail group in one inbox.
 *
 * Two producers, one surface (S1): `templateKey` seeded starter filters stay static
 * and org-agnostic on `MailFilter`; these carry evidence. Accepting one opens the
 * ordinary filter dialog prefilled — the suggestion is a PREFILL, NEVER an
 * authorization path (invariant 10).
 */
export const MailSuggestion = pgTable(
  'MailSuggestion',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    // The inbox this is about — an `EntityInstance` on `inbox` or `personal_inbox`.
    // Cascades: a deleted inbox takes its suggestions with it, exactly like MailFilter.
    inboxId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // The member this is FOR. Non-null for personal-inbox suggestions and for any
    // suggestion whose evidence is per-user (read rate lives in ThreadReadStatus, which
    // is unique on (threadId, userId) — a shared inbox with five members has five
    // answers to "did anyone read it"). Null = an org-level shared-inbox suggestion.
    userId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    kind: text()
      .$type<'unsubscribe' | 'auto-archive' | 'auto-tag' | 'auto-assign' | 'route-inbox'>()
      .notNull(),
    // The group this is about: `list:<listId>` or `domain:<senderDomain>`.
    // Keyed off Message.listId / Message.senderDomain, which stay two columns (S7).
    subjectKey: text().notNull(),
    // Everything the card renders, so display never re-queries:
    // `{ windowDays, messageCount, threadCount, unreadRate, manualArchiveRate,
    //    everReplied, sampleThreadIds, unsubscribeMethod }`.
    evidence: jsonb().$type<unknown>().notNull(),
    // ConditionGroup[] prefilled into the filter dialog. MUST COMPILE: a condition the
    // query builder can't dispatch is dropped silently, and an all-dropped filter
    // reduces to the bare org scope — i.e. it matches EVERY thread in the inbox
    // (mail-filters invariant 19). Validated with `assertFilterConditionsCompile` when
    // the JOB WRITES THE ROW, not when the user clicks accept.
    proposedConditions: jsonb().$type<unknown[]>().default([]).notNull(),
    // MailFilterAction[] — typed in @auxx/lib/mail-filters.
    proposedActions: jsonb().$type<unknown[]>().default([]).notNull(),
    status: text().$type<'new' | 'accepted' | 'dismissed'>().default('new').notNull(),
    // Dismissal is a ROW, not a delete (invariant 7): deleting would resurrect the
    // suggestion on the next weekly sweep. The dismissed rows ARE the suppression list.
    dismissedAt: timestamp({ precision: 3 }),
    acceptedAt: timestamp({ precision: 3 }),
    // The MailFilter created by accepting this. Plain text, no FK — deleting the filter
    // must not erase the record that we proposed it.
    acceptedFilterId: text(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // A rerun UPDATES evidence rather than duplicating the card. NULLS NOT DISTINCT so
    // the org-level (userId IS NULL) rows collapse too — with default NULL semantics
    // every weekly sweep would insert a fresh row for every shared-inbox suggestion.
    unique('MailSuggestion_org_inbox_user_kind_subject_key')
      .on(table.organizationId, table.inboxId, table.userId, table.kind, table.subjectKey)
      .nullsNotDistinct(),
    // The list read.
    index('MailSuggestion_organizationId_inboxId_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.inboxId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    // Retention sweep of stale `new` rows.
    index('MailSuggestion_createdAt_idx').using('btree', table.createdAt.asc().nullsLast()),
  ]
)

/**
 * One unsubscribe request we sent, per (org, inbox, list).
 *
 * Unsubscribe is a ONE-SHOT COMMAND, never a `MailFilterAction` (S2/invariant 1) — an
 * action in that union would fire an outbound POST to a third party on every future
 * match. It is a user-initiated operation against a *list*.
 */
export const MailUnsubscribe = pgTable(
  'MailUnsubscribe',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    inboxId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // `list:<listId>` or `domain:<senderDomain>` — same keyspace as MailSuggestion.
    subjectKey: text().notNull(),
    // Which tier ran, chosen BY HEADER, never by provider (§6.1):
    // `one-click` = RFC 8058 server-side POST; `http` = we opened the URL for the user
    // (never POST a URL without the one-click header); `mailto` = a real outbound send
    // from that mailbox's own channel.
    method: text().$type<'one-click' | 'http' | 'mailto'>().notNull(),
    requestedByUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    requestedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    status: text()
      .$type<'requested' | 'confirmed' | 'failed' | 'ignored'>()
      .default('requested')
      .notNull(),
    // Mail from this subjectKey that arrived AFTER the request. Earns its place: when a
    // sender keeps mailing 14+ days later we can say "Stripe ignored your unsubscribe —
    // 6 more since. Filter it?" — a real answer to a real annoyance, free from these
    // two columns.
    lastSeenAfterAt: timestamp({ precision: 3 }),
    messagesSeenAfter: integer().default(0).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Never unsubscribe twice from the same list.
    uniqueIndex('MailUnsubscribe_org_inbox_subject_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.inboxId.asc().nullsLast(),
      table.subjectKey.asc().nullsLast()
    ),
  ]
)

/** Selected MailSuggestion entity type */
export type MailSuggestionEntity = typeof MailSuggestion.$inferSelect
/** Selected MailUnsubscribe entity type */
export type MailUnsubscribeEntity = typeof MailUnsubscribe.$inferSelect
