// packages/lib/src/mail-filters/queries.ts
// Reads for MailFilter + MailFilterRun. Functional Drizzle + neverthrow — no
// service class, no model class (docs/lib-module-guide.md).
//
// ZERO permission checks by design (§5, lib-module-guide §6): the router asserts
// the §5.1 branch (personal inbox = ownership, shared inbox = automationRules.manage
// + inbox write) and hands the allowed inbox ids down as `opts.inboxIds`, which
// this module turns into a WHERE fragment. A post-read `.filter()` would leak
// counts even where it hides content — so list scoping happens in SQL, always.
//
// The hot path does NOT come through here: the gate reads the `mailFilters` org
// cache (`./cache.ts`). These queries back the settings UI and the run history.

import { type Database, schema } from '@auxx/database'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import {
  type MailFilterRow,
  type MailFilterRunRow,
  toMailFilterRow,
  toMailFilterRunRow,
} from './types'

/** Optional list scope. `inboxIds` is applied in SQL — never fetch-then-filter. */
export interface ListMailFiltersOptions {
  /**
   * Restrict to these inboxes. An EMPTY array means "no inbox is visible to this
   * caller" and returns nothing — it is NOT the same as omitting the option,
   * which returns the whole org. The distinction is load-bearing: a caller that
   * computed an empty allow-list must not fall through to an unscoped read.
   */
  inboxIds?: string[]
}

/**
 * List an org's filters in evaluation order — `(inboxId, order)`, the same order
 * the engine applies them in, so the settings list reads as what will happen.
 */
export async function listMailFilters(
  db: Database,
  organizationId: string,
  opts: ListMailFiltersOptions = {}
): Promise<Result<MailFilterRow[], Error>> {
  if (opts.inboxIds && opts.inboxIds.length === 0) return ok([])

  const rows = await db
    .select()
    .from(schema.MailFilter)
    .where(
      and(
        eq(schema.MailFilter.organizationId, organizationId),
        ...(opts.inboxIds ? [inArray(schema.MailFilter.inboxId, opts.inboxIds)] : [])
      )
    )
    .orderBy(asc(schema.MailFilter.inboxId), asc(schema.MailFilter.order))

  return ok(rows.map(toMailFilterRow))
}

/** Load one filter, org-scoped. */
export async function getMailFilterById(
  db: Database,
  organizationId: string,
  filterId: string
): Promise<Result<MailFilterRow, Error>> {
  const [row] = await db
    .select()
    .from(schema.MailFilter)
    .where(
      and(eq(schema.MailFilter.id, filterId), eq(schema.MailFilter.organizationId, organizationId))
    )
    .limit(1)

  if (!row) return err(new NotFoundError('Filter not found'))
  return ok(toMailFilterRow(row))
}

/** Run history for one filter, newest first (the runs dialog). */
export async function listMailFilterRuns(
  db: Database,
  organizationId: string,
  filterId: string,
  limit = 50
): Promise<Result<MailFilterRunRow[], Error>> {
  const rows = await db
    .select()
    .from(schema.MailFilterRun)
    .where(
      and(
        eq(schema.MailFilterRun.organizationId, organizationId),
        eq(schema.MailFilterRun.filterId, filterId)
      )
    )
    .orderBy(desc(schema.MailFilterRun.firedAt))
    .limit(limit)

  return ok(rows.map(toMailFilterRunRow))
}

/**
 * Every firing that touched one thread, newest first — backs the "Filtered by
 * *Newsletters*" thread badge and its Undo (§6.3). Several filters can match one
 * message, so this is a list rather than a lookup.
 */
export async function listMailFilterRunsForThread(
  db: Database,
  organizationId: string,
  threadId: string,
  limit = 20
): Promise<Result<MailFilterRunRow[], Error>> {
  const rows = await db
    .select()
    .from(schema.MailFilterRun)
    .where(
      and(
        eq(schema.MailFilterRun.organizationId, organizationId),
        eq(schema.MailFilterRun.threadId, threadId)
      )
    )
    .orderBy(desc(schema.MailFilterRun.firedAt))
    .limit(limit)

  return ok(rows.map(toMailFilterRunRow))
}

/** Load one run row, org-scoped — the undo path reads its `undo` blob from here. */
export async function getMailFilterRunById(
  db: Database,
  organizationId: string,
  runId: string
): Promise<Result<MailFilterRunRow, Error>> {
  const [row] = await db
    .select()
    .from(schema.MailFilterRun)
    .where(
      and(
        eq(schema.MailFilterRun.id, runId),
        eq(schema.MailFilterRun.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row) return err(new NotFoundError('Filter run not found'))
  return ok(toMailFilterRunRow(row))
}
