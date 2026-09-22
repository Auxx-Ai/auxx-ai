// packages/lib/src/accounting/sales/fulfillments/posting-reads.ts

/**
 * What the shipment poster and its sweep ASK, as opposed to what they write:
 * the draft a shipment is waiting on, and the shipments nothing has posted.
 *
 * Reads only; the poster lives in `accounting.ts` and the sweep's loop in
 * `accounting-sweep.ts` (`docs/lib-module-guide.md` §5). No permission checks
 * anywhere in this file (§6).
 */

import { type Database, schema } from '@auxx/database'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, sql } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../../cache'
import { systemFieldMap } from '../../../resources/system-records'

/** The draft a shipment waits on: its `pending` link onto a row still in `draft`. */
export async function findLiveFulfillmentDraft(
  db: Database,
  organizationId: string,
  fulfillmentId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.GlPosting.id })
    .from(schema.GlPostingSource)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.organizationId, schema.GlPostingSource.organizationId),
        eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId)
      )
    )
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, 'fulfillment'),
        eq(schema.GlPostingSource.sourceId, fulfillmentId),
        eq(schema.GlPostingSource.linkRole, 'pending'),
        eq(schema.GlPosting.status, 'draft')
      )
    )
    .limit(1)
  return row?.id ?? null
}

/** The window the sweep's candidate query cuts on, read once per pass. */
export interface FulfillmentCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Shipments on or before it are refused forever. */
  cutoffPeriod: string | null
  /** `accounting.bookTimeZone`, the zone a shipment's book month is cut in. */
  bookTimeZone: string
  /** Shipments refused more recently than this are held back. */
  retryBefore: Date
}

const MARKER_ATTRS = [
  'fulfillment_status',
  'fulfillment_shipped_at',
  'fulfillment_subtotal',
  'fulfillment_total',
  'fulfillment_posting_blocked_at',
] as const

/**
 * Live, stamped, non-zero shipments after the cutoff that hold no claim and no
 * draft - oldest shipment first, because the recognition timeline wants the
 * earlier shipment posted before the later one (88 §4.5, Trigger 2).
 *
 * `fulfillment_subtotal` present is the "78's stamp has run" test and
 * `fulfillment_total <> 0` the "worth something" one: a $0 shipment recognises
 * nothing and is not a timeline event at all (§7.3). Empty, never a refusal, on
 * an org with no `fulfillment` def or no migration 184.
 */
export async function listFulfillmentAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100,
  window?: FulfillmentCandidateWindow
): Promise<string[]> {
  const defId = await getCachedEntityDefId(organizationId, 'fulfillment')
  if (!defId) return []
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...MARKER_ATTRS])
  const shippedAt = fields.fulfillment_shipped_at?.id
  const subtotal = fields.fulfillment_subtotal?.id
  const total = fields.fulfillment_total?.id
  const status = fields.fulfillment_status?.id
  const blockedAt = fields.fulfillment_posting_blocked_at?.id
  if (!shippedAt || !subtotal || !total || !status) return []

  const zone = window?.bookTimeZone ?? 'UTC'
  const result = await db.execute(sql`
    SELECT ship."entityId" AS id
    FROM "FieldValue" ship
    JOIN "FieldValue" tot ON tot."organizationId" = ship."organizationId"
      AND tot."entityId" = ship."entityId" AND tot."fieldId" = ${total}
    WHERE ship."organizationId" = ${organizationId}
      AND ship."entityDefinitionId" = ${defId}
      AND ship."fieldId" = ${shippedAt}
      AND ship."valueDate" IS NOT NULL
      AND tot."valueNumber" IS NOT NULL AND tot."valueNumber" <> 0
      AND EXISTS (SELECT 1 FROM "FieldValue" sub
        WHERE sub."organizationId" = ${organizationId}
          AND sub."entityId" = ship."entityId" AND sub."fieldId" = ${subtotal}
          AND sub."valueNumber" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "FieldValue" st
        WHERE st."organizationId" = ${organizationId}
          AND st."entityId" = ship."entityId" AND st."fieldId" = ${status}
          AND st."optionId" = 'cancelled')
      ${
        window?.cutoffPeriod
          ? sql`AND to_char((ship."valueDate" AT TIME ZONE ${zone}), 'YYYY-MM') > ${window.cutoffPeriod}`
          : sql``
      }
      ${
        window && blockedAt
          ? sql`AND NOT EXISTS (SELECT 1 FROM "FieldValue" mark
        WHERE mark."organizationId" = ${organizationId}
          AND mark."entityId" = ship."entityId" AND mark."fieldId" = ${blockedAt}
          AND mark."valueDate" > ${window.retryBefore.toISOString()}::timestamptz)`
          : sql``
      }
      AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" link
        WHERE link."organizationId" = ${organizationId}
          AND link."sourceKind" = 'fulfillment'
          AND link."sourceId" = ship."entityId"
          AND link."linkRole" = 'subject')
      AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" pending
        JOIN "GlPosting" draft ON draft."id" = pending."glPostingId"
        WHERE pending."organizationId" = ${organizationId}
          AND pending."sourceKind" = 'fulfillment'
          AND pending."sourceId" = ship."entityId"
          AND pending."linkRole" = 'pending'
          AND draft."status" = 'draft')
    ORDER BY ship."valueDate" ASC, ship."entityId" ASC
    LIMIT ${limit}
  `)
  return (result.rows as Array<{ id: string }>).map((row) => row.id)
}
