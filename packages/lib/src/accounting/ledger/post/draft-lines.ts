// packages/lib/src/accounting/ledger/post/draft-lines.ts
//
// Editing and discarding a DRAFT `GlPosting` - what a record needs beyond
// `postEntry`/`postDraft`/`reverseEntry` (TARGET §1). A draft holds no claim;
// its `pending` link is how a source finds the drafts standing on it.

import { type Database, schema, withAccountingCommitLock } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, ConflictError, NotFoundError } from '../../../errors'
import type { PeriodLock } from '../periods/periods'
import type { BuiltEntry, GlPostingSourceInput } from '../types'
import { buildPostingDraft } from './draft'
import { toLineRows } from './insert-posting'
import { prepareEntry } from './post-entry'

export interface UpdateDraftLinesInput {
  organizationId: string
  glPostingId: string
  /** The rebuilt entry - `buildManualEntry`'s output, already balanced. */
  entry: BuiltEntry
  lock: PeriodLock
  memo?: string
}

/**
 * Replace a draft's lines and its `built` envelope in place: DELETE + re-INSERT
 * `GlPostingLine`, through the same role/account resolution and balance check a
 * post runs (`prepareEntry`), so a draft that could no longer be posted as typed
 * refuses here rather than saving silently.
 *
 * Refuses anything but a `draft` row - a posted entry is corrected by reversal,
 * never by edit (TARGET §1).
 */
export async function updateDraftLines(
  db: Database,
  input: UpdateDraftLinesInput
): Promise<Result<void, AuxxError>> {
  const { organizationId, glPostingId, entry, lock, memo } = input

  try {
    await db.transaction(async (tx) => {
      // The same lock `postEntry` and `postDraft` take, and re-entrant on a
      // caller that already holds it: `postDraftInTx` reads the header without
      // `FOR UPDATE`, so an edit racing a promotion must serialize here.
      await withAccountingCommitLock(tx, organizationId)
      const [row] = await tx
        .select({
          status: schema.GlPosting.status,
          revision: schema.GlPosting.revision,
          built: schema.GlPosting.built,
        })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.id, glPostingId),
            eq(schema.GlPosting.organizationId, organizationId)
          )
        )
        .for('update')

      if (!row) throw new NotFoundError(`No posting ${glPostingId} in this organization.`)
      if (row.status !== 'draft') {
        throw new ConflictError(
          `Posting ${glPostingId} is ${row.status}, not draft. A draft's lines are edited; a ` +
            'posted entry is corrected by reversing it and posting a new one.'
        )
      }

      const sources = extractSources(row.built)

      const prepared = await prepareEntry(tx, {
        organizationId,
        entry,
        lock,
        revision: row.revision,
      })
      if (prepared.refusal) throw new AuxxError(prepared.refusal.error)

      await tx
        .delete(schema.GlPostingLine)
        .where(
          and(
            eq(schema.GlPostingLine.glPostingId, glPostingId),
            eq(schema.GlPostingLine.organizationId, organizationId)
          )
        )

      if (prepared.lines.length > 0) {
        await tx
          .insert(schema.GlPostingLine)
          .values(toLineRows(organizationId, glPostingId, prepared.lines))
      }

      await tx
        .update(schema.GlPosting)
        .set({
          txnDate: entry.txnDate,
          totalMinor: prepared.totalMinor,
          built: buildPostingDraft({
            docNumber: '',
            revision: row.revision,
            memo,
            entry,
            resolvedLines: prepared.lines.map((line) => ({
              accountRole: line.accountRole,
              ...line.resolved,
            })),
            sources,
          }),
        })
        .where(
          and(
            eq(schema.GlPosting.id, glPostingId),
            eq(schema.GlPosting.organizationId, organizationId)
          )
        )
    })
    return ok(undefined)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(new AuxxError(error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Throw a draft posting away: its lines, then the header. Refuses anything but
 * `draft`, for the same reason {@link updateDraftLines} does.
 */
export async function discardDraftPosting(
  db: Database,
  input: { organizationId: string; glPostingId: string }
): Promise<Result<void, AuxxError>> {
  const { organizationId, glPostingId } = input

  try {
    await db.transaction(async (tx) => {
      // See {@link updateDraftLines}: the discard must serialize with a
      // promotion of the same draft.
      await withAccountingCommitLock(tx, organizationId)
      const [row] = await tx
        .select({ status: schema.GlPosting.status })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.id, glPostingId),
            eq(schema.GlPosting.organizationId, organizationId)
          )
        )
        .for('update')

      if (!row) throw new NotFoundError(`No posting ${glPostingId} in this organization.`)
      if (row.status !== 'draft') {
        throw new ConflictError(
          `Posting ${glPostingId} is ${row.status}, not draft. Reverse a posted entry instead of discarding it.`
        )
      }

      await tx
        .delete(schema.GlPostingLine)
        .where(
          and(
            eq(schema.GlPostingLine.glPostingId, glPostingId),
            eq(schema.GlPostingLine.organizationId, organizationId)
          )
        )
      await tx
        .delete(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.id, glPostingId),
            eq(schema.GlPosting.organizationId, organizationId)
          )
        )
    })
    return ok(undefined)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(new AuxxError(error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Throw away every draft standing on one source - what a void or a cancel calls
 * so the outbox cannot approve an entry for a document that no longer stands.
 * Returns the ids discarded; `[]` when nothing was waiting.
 */
export async function discardDraftsForSource(
  db: Database,
  input: { organizationId: string; sourceKind: string; sourceId: string; occurrence?: string }
): Promise<Result<string[], AuxxError>> {
  const { organizationId, sourceKind, sourceId, occurrence } = input
  const rows = await db
    .select({ glPostingId: schema.GlPostingSource.glPostingId })
    .from(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, sourceKind),
        eq(schema.GlPostingSource.sourceId, sourceId),
        eq(schema.GlPostingSource.linkRole, 'pending'),
        ...(occurrence ? [eq(schema.GlPostingSource.occurrence, occurrence)] : [])
      )
    )
  const discarded: string[] = []
  for (const row of rows) {
    const result = await discardDraftPosting(db, { organizationId, glPostingId: row.glPostingId })
    if (result.isErr()) return err(result.error)
    discarded.push(row.glPostingId)
  }
  return ok(discarded)
}

/** The subject `postDraft` would claim, read back off the stored envelope. */
function extractSources(built: unknown): GlPostingSourceInput[] | undefined {
  if (typeof built !== 'object' || built === null) return undefined
  const sources = (built as { sources?: unknown }).sources
  return Array.isArray(sources) ? (sources as GlPostingSourceInput[]) : undefined
}
