// packages/lib/src/data-migrations/migrations/073-backfill-bulk-mail-fields.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { type BulkMailFields, deriveBulkMailFields } from '../../ingest/filtering/bulk-mail'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-073')

/**
 * Messages scanned per keyset page.
 *
 * Larger than 071's because this one never leaves the process: the derive is pure
 * string parsing over headers already on the row, so a page is bounded only by how
 * many single-row updates we want in flight.
 */
const BATCH_SIZE = 500

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/** An inbound message whose bulk-sender identity has never been derived. */
export interface BulkMailCandidate {
  id: string
  metadata: unknown
  fromEmail: string | null
}

/** The columns this migration writes — only the ones it could actually derive. */
export type BulkMailPatch = Partial<BulkMailFields>

/**
 * Decide what to write for one candidate row.
 *
 * Returns `null` when nothing could be derived (no bulk headers and an unparseable
 * from-address) — writing four explicit NULLs onto a row that already holds four
 * NULLs is a write that buys nothing, and the row keeps matching the scan predicate
 * either way.
 *
 * A `null` field is dropped rather than written, which is what makes the
 * Outlook/IMAP degrade graceful (suggestions plan §2.3): that history has `list-id`
 * and `list-unsubscribe` allowlisted but never carried `list-unsubscribe-post` or
 * `authentication-results`, so those rows get `listId`, `senderDomain` and the
 * unsubscribe URIs while `oneClick` stays `false` and `senderAuthenticated` stays
 * NULL — the conservative branch, exactly as invariant 3 requires.
 */
export function planBulkMailPatch(row: BulkMailCandidate): BulkMailPatch | null {
  const headers = (row.metadata as { headers?: Record<string, string | string[] | undefined> })
    ?.headers
  const fields = deriveBulkMailFields({ headers, fromEmail: row.fromEmail })

  const patch: BulkMailPatch = {}
  if (fields.listId !== null) patch.listId = fields.listId
  if (fields.senderDomain !== null) patch.senderDomain = fields.senderDomain
  if (fields.unsubscribeMeta !== null) patch.unsubscribeMeta = fields.unsubscribeMeta
  if (fields.senderAuthenticated !== null) patch.senderAuthenticated = fields.senderAuthenticated

  return Object.keys(patch).length > 0 ? patch : null
}

/** What a run touched. */
export interface BulkMailBackfillCounts {
  scanned: number
  updated: number
  skipped: number
}

/**
 * Backfill `Message.listId` / `senderDomain` / `unsubscribeMeta` /
 * `senderAuthenticated` for inbound messages stored before the columns existed.
 *
 * Exported separately from the {@link DataMigrationDef} so the loop can be tested
 * without a live database.
 */
export async function backfillBulkMailFields(db: Database): Promise<BulkMailBackfillCounts> {
  let cursor = ''
  let batches = 0
  const counts: BulkMailBackfillCounts = { scanned: 0, updated: 0, skipped: 0 }

  for (;;) {
    const rows: BulkMailCandidate[] = await db
      .select({
        id: schema.Message.id,
        metadata: schema.Message.metadata,
        fromEmail: schema.Participant.identifier,
      })
      .from(schema.Message)
      .innerJoin(schema.Participant, eq(schema.Message.fromId, schema.Participant.id))
      .where(
        and(
          eq(schema.Message.isInbound, true),
          isNull(schema.Message.senderDomain),
          gt(schema.Message.id, cursor)
        )
      )
      .orderBy(asc(schema.Message.id))
      .limit(BATCH_SIZE)

    if (rows.length === 0) break

    // The cursor advances past skipped rows too, so a page that derives nothing
    // still makes progress instead of re-reading itself.
    cursor = rows[rows.length - 1]!.id
    counts.scanned += rows.length
    batches += 1

    for (const row of rows) {
      const patch = planBulkMailPatch(row)
      if (!patch) {
        counts.skipped += 1
        continue
      }
      await db.update(schema.Message).set(patch).where(eq(schema.Message.id, row.id))
      counts.updated += 1
    }

    if (batches % LOG_EVERY === 0) {
      logger.info('Backfilling Message bulk-sender identity', { ...counts, cursor })
    }

    if (rows.length < BATCH_SIZE) break
  }

  logger.info('Backfilled Message bulk-sender identity', { ...counts, batches })
  return counts
}

/**
 * Derive the four bulk-sender columns for every inbound message that predates them.
 *
 * **Why.** `listId`, `senderDomain`, `unsubscribeMeta` and `senderAuthenticated`
 * (suggestions plan §1.1) are derived at ingest from headers we already persist in
 * `Message.metadata.headers`. Everything stored before the columns existed still
 * carries those headers, so the identity is recoverable — and without it the mining
 * job's 90-day window would see an empty mailbox on day one.
 *
 * **Not raw SQL, unlike 037.** The derive needs `tldts` for the registrable domain
 * and real parsing for `list-unsubscribe` / `authentication-results`; neither is
 * expressible in a statement. The scan is keyset-paginated on `Message.id` and
 * joined to `Participant` for the from-address.
 *
 * **Raw `db.update` on purpose** (project convention for data migrations): the
 * ingest path that normally maintains these columns publishes realtime patches and
 * recomputes thread metadata, which a bulk identity backfill has no business firing.
 * It also leaves `updatedAt` alone — this is a repair of what the row always should
 * have carried, not a modification of the message.
 *
 * **Idempotent and resumable.** The scan predicate is `isInbound AND senderDomain IS
 * NULL`: `senderDomain` is derivable from the from-address alone, so a completed row
 * drops out of the scan on the next run. Rows whose sender has no parseable domain
 * stay in it and are re-derived (and re-skipped) — a small, bounded rescan, and the
 * shape the runner wants since it restarts a failed migration from the top.
 *
 * **Never coerces the unknown.** A row with no `authentication-results` keeps
 * `senderAuthenticated` NULL rather than `false`/`true`; NULL means unknown and
 * every read must treat it as not authenticated (invariant 3).
 */
export const migration073BackfillBulkMailFields: DataMigrationDef = {
  id: '073-backfill-bulk-mail-fields',
  description:
    'Derive Message.listId, senderDomain, unsubscribeMeta and senderAuthenticated from stored headers',
  async run(db: Database): Promise<void> {
    await backfillBulkMailFields(db)
  },
}
