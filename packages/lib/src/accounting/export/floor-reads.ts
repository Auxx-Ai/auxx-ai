// packages/lib/src/accounting/export/floor-reads.ts
// The export floor and what sits either side of it: the Outbox's skipped count and the
// mode-switch confirm (plans/accounting/tasks/101-the-export-under-one-entry-per-event.md E6).

import { type Database, schema } from '@auxx/database'
import { and, count, countDistinct, eq, gte, isNotNull, lt, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { ExportSettings } from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import { readActiveBookConnection } from '../providers/book-connections'
import { reversalMayExport } from './reversal-exportable'

/** `max(Export from, the connection's exportFromDate)` - below it nothing is built, in either mode. */
export function exportFloor(cutover: string | null, exportFromDate: string): string {
  return cutover && cutover > exportFromDate ? cutover : exportFromDate
}

/** The org's export settings and floor; `floor` is null without an active book connection. */
export async function readExportFloor(
  db: Database,
  organizationId: string
): Promise<{ settings: ExportSettings; floor: string | null }> {
  const [settings, connection] = await Promise.all([
    readExportSettings(organizationId),
    readActiveBookConnection(db, organizationId),
  ])
  return {
    settings,
    floor: connection ? exportFloor(settings.cutover, connection.exportFromDate) : null,
  }
}

/** The outer `GlPosting` row is a member of no live batch. */
export function postingHasNoLiveBatch(): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${schema.ExportBatchPosting} live_member
    WHERE live_member."organizationId" = ${schema.GlPosting.organizationId}
      AND live_member."glPostingId" = ${schema.GlPosting.id}
      AND live_member."withdrawnAt" IS NULL)`
}

/** Posted, exportable and in no live batch - what a build would still consider. */
function unbatchedExportable(organizationId: string): SQL | undefined {
  return and(
    eq(schema.GlPosting.organizationId, organizationId),
    eq(schema.GlPosting.status, 'posted'),
    isNotNull(schema.GlPosting.avenue),
    postingHasNoLiveBatch()
  )
}

/** What `buildExportBatches` reports as `skippedBeforeCutover`, org-wide; zero with no connection. */
export async function countSkippedBeforeFloor(
  db: Database,
  organizationId: string
): Promise<Result<{ count: number; floor: string | null }, Error>> {
  try {
    const { floor } = await readExportFloor(db, organizationId)
    if (!floor) return ok({ count: 0, floor: null })
    const [row] = await db
      .select({ count: count() })
      .from(schema.GlPosting)
      .where(and(unbatchedExportable(organizationId), lt(schema.GlPosting.txnDate, floor)))
    return ok({ count: Number(row?.count ?? 0), floor })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

export interface ExportModeSwitchImpact {
  /** The mode in force now - the one held batches keep. */
  mode: ExportSettings['mode']
  floor: string | null
  /** Posted postings at or after the floor with no batch; they leave in whatever mode is set when built. */
  unbatched: number
  /** `ready` batches built in the current mode; a switch does not rebuild them. */
  held: number
  /** Orders with a posted payment and no posted fulfillment: receipt and shipment may leave in different modes (101 §2.8). */
  straddlingOrders: number
}

/** The three counts the Export Mode confirm shows. */
export async function readExportModeSwitchImpact(
  db: Database,
  organizationId: string
): Promise<Result<ExportModeSwitchImpact, Error>> {
  try {
    const { settings, floor } = await readExportFloor(db, organizationId)
    const lowerBound = floor ?? settings.cutover
    const atOrAfterFloor = lowerBound ? gte(schema.GlPosting.txnDate, lowerBound) : undefined

    const shipped = sql`EXISTS (SELECT 1 FROM ${schema.GlPostingSource} shipment_link
      JOIN ${schema.GlPosting} shipment ON shipment.id = shipment_link."glPostingId"
      WHERE shipment_link."organizationId" = ${organizationId}
        AND shipment_link."linkRole" = 'parent'
        AND shipment_link."sourceKind" = 'order'
        AND shipment_link."sourceId" = ${schema.GlPostingSource.sourceId}
        AND shipment."postingType" = 'fulfillment'
        AND shipment.status = 'posted')`

    const [unbatched, held, straddling] = await Promise.all([
      db
        .select({ count: count() })
        .from(schema.GlPosting)
        .where(and(unbatchedExportable(organizationId), reversalMayExport(), atOrAfterFloor)),
      db
        .select({ count: count() })
        .from(schema.ExportBatch)
        .where(
          and(
            eq(schema.ExportBatch.organizationId, organizationId),
            eq(schema.ExportBatch.state, 'ready'),
            eq(schema.ExportBatch.mode, settings.mode)
          )
        ),
      db
        .select({ count: countDistinct(schema.GlPostingSource.sourceId) })
        .from(schema.GlPostingSource)
        .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId))
        .where(
          and(
            eq(schema.GlPostingSource.organizationId, organizationId),
            eq(schema.GlPostingSource.linkRole, 'parent'),
            eq(schema.GlPostingSource.sourceKind, 'order'),
            eq(schema.GlPosting.postingType, 'payment'),
            eq(schema.GlPosting.status, 'posted'),
            atOrAfterFloor,
            sql`NOT ${shipped}`
          )
        ),
    ])
    return ok({
      mode: settings.mode,
      floor,
      unbatched: Number(unbatched[0]?.count ?? 0),
      held: Number(held[0]?.count ?? 0),
      straddlingOrders: Number(straddling[0]?.count ?? 0),
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
