// packages/lib/src/mail-suggestions/queries.ts
// Reads for MailSuggestion. Functional Drizzle + neverthrow — no service class,
// no model class (docs/lib-module-guide.md).
//
// ZERO permission checks by design (lib-module-guide §6). §7.2 of the plan —
// "personal-inbox suggestions are visible to their owner only; `isMailAdmin`
// confers no override" — is enforced by the router computing the caller's
// visible inbox ids and handing them down as `opts.inboxIds`, which this module
// turns into a WHERE fragment. A post-read `.filter()` would leak counts even
// where it hides content, so list scoping happens in SQL, always.

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { type MailSuggestionRow, type MailSuggestionStatus, toMailSuggestionRow } from './types'

/** Optional list scope. Everything here is applied in SQL — never fetch-then-filter. */
export interface ListMailSuggestionsOptions {
  /**
   * Restrict to these inboxes. An EMPTY array means "no inbox is visible to this
   * caller" and returns nothing — it is NOT the same as omitting the option,
   * which returns the whole org. The distinction is load-bearing: a caller that
   * computed an empty allow-list must not fall through to an unscoped read.
   */
  inboxIds?: string[]
  /**
   * Restrict to one member's cards: rows addressed to them (`userId = X`) plus
   * the org-level shared-inbox rows (`userId IS NULL`). Read state is per user,
   * so a personal-inbox card belongs to exactly one person.
   */
  userId?: string
  /** Defaults to `['new']` — the surface only ever shows undecided cards. */
  statuses?: MailSuggestionStatus[]
  limit?: number
}

/**
 * List an org's suggestions, newest first.
 *
 * Ordered by `createdAt desc` rather than by score: the miner already applied
 * the 5-per-inbox cap and its `messageCount × unreadRate` ranking before
 * writing (invariant 12), so everything that reaches this read is meant to be
 * shown.
 */
export async function listMailSuggestions(
  db: Database,
  organizationId: string,
  opts: ListMailSuggestionsOptions = {}
): Promise<Result<MailSuggestionRow[], Error>> {
  if (opts.inboxIds && opts.inboxIds.length === 0) return ok([])

  const statuses = opts.statuses ?? (['new'] as MailSuggestionStatus[])
  if (statuses.length === 0) return ok([])

  const rows = await db
    .select()
    .from(schema.MailSuggestion)
    .where(
      and(
        eq(schema.MailSuggestion.organizationId, organizationId),
        inArray(schema.MailSuggestion.status, statuses),
        ...(opts.inboxIds ? [inArray(schema.MailSuggestion.inboxId, opts.inboxIds)] : []),
        opts.userId
          ? or(eq(schema.MailSuggestion.userId, opts.userId), isNull(schema.MailSuggestion.userId))
          : undefined
      )
    )
    .orderBy(desc(schema.MailSuggestion.createdAt))
    .limit(opts.limit ?? 200)

  return ok(rows.map(toMailSuggestionRow))
}

/** Load one suggestion, org-scoped — the accept/dismiss router paths read it first. */
export async function getMailSuggestionById(
  db: Database,
  organizationId: string,
  suggestionId: string
): Promise<Result<MailSuggestionRow, Error>> {
  const [row] = await db
    .select()
    .from(schema.MailSuggestion)
    .where(
      and(
        eq(schema.MailSuggestion.id, suggestionId),
        eq(schema.MailSuggestion.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row) return err(new NotFoundError('Suggestion not found'))
  return ok(toMailSuggestionRow(row))
}

/**
 * The subjectKeys the miner must never propose again for one inbox.
 *
 * Both decided statuses count, for different reasons:
 * - `dismissed` — the user said no, and dismissal is permanent for that
 *   subjectKey (invariant 7). The row IS the suppression list; deleting it
 *   would resurrect the card on the next weekly sweep.
 * - `accepted` — a filter already exists for it, so re-proposing would ask the
 *   user to build the thing they already built.
 *
 * Returns keys across ALL users of the inbox on purpose: a shared inbox's cards
 * are org-level (`userId IS NULL`) and a personal one has exactly one user, so
 * the distinction never widens the set beyond the mailbox in question.
 */
export async function listSuppressedSubjectKeys(
  db: Database,
  organizationId: string,
  inboxId: string
): Promise<Result<Set<string>, Error>> {
  const rows = await db
    .select({
      subjectKey: schema.MailSuggestion.subjectKey,
    })
    .from(schema.MailSuggestion)
    .where(
      and(
        eq(schema.MailSuggestion.organizationId, organizationId),
        eq(schema.MailSuggestion.inboxId, inboxId),
        inArray(schema.MailSuggestion.status, ['dismissed', 'accepted'])
      )
    )

  return ok(new Set(rows.map((row) => row.subjectKey)))
}
