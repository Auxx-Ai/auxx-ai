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

/** One refused shipment, as the Outbox's Blocked tab renders it beside the movements (88 §4.5). */
export interface BlockedFulfillmentRow {
  /** The `fulfillment` instance id. */
  id: string
  entityDefinitionId: string
  /** `fulfillment_name`, the record's display name. */
  name: string | null
  orderId: string | null
  orderDefinitionId: string | null
  orderName: string | null
  /** The instant the goods went out, or `null` for a shipment with no date. */
  shippedAt: string | null
  /** `fulfillment_total`, integer minor units in the order's currency. */
  amountMinor: number
  currency: string
  /** The poster's own words, verbatim. */
  reason: string
  blockedAt: Date | null
  /** `account_unmapped` gets the remedy card; everything else is plain text. */
  reasonKind: 'account_unmapped' | 'other'
}

const BLOCKED_ATTRS = [
  'fulfillment_posting_blocked_reason',
  'fulfillment_posting_blocked_at',
  'fulfillment_shipped_at',
  'fulfillment_total',
  'fulfillment_order',
  'order_currency',
] as const

/** A shipment is parked when it carries a reason and holds no live subject posting. */
function blockedFulfillmentWhere(organizationId: string, defId: string, reasonFieldId: string) {
  return sql`reason."organizationId" = ${organizationId}
    AND reason."entityDefinitionId" = ${defId}
    AND reason."fieldId" = ${reasonFieldId}
    AND reason."valueText" IS NOT NULL
    AND f."archivedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" link
      WHERE link."organizationId" = ${organizationId}
        AND link."sourceKind" = 'fulfillment'
        AND link."sourceId" = reason."entityId"
        AND link."linkRole" = 'subject')`
}

/**
 * Every shipment the poster refused, newest refusal first, paged. Empty, never
 * a refusal, on an org with no `fulfillment` def or no migration 184.
 */
export async function listBlockedFulfillments(
  db: Database,
  organizationId: string,
  options: {
    limit?: number
    offset?: number
    search?: string
    /** `YYYY-MM-DD`, on the shipped day cut in `bookTimeZone`. */
    from?: string
    to?: string
    bookTimeZone?: string
    /** Narrow to these fulfillment ids - the drawer's one-row read. */
    ids?: readonly string[]
  } = {}
): Promise<BlockedFulfillmentRow[]> {
  const defId = await getCachedEntityDefId(organizationId, 'fulfillment')
  if (!defId) return []
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...BLOCKED_ATTRS])
  const reason = fields.fulfillment_posting_blocked_reason?.id
  const blockedAt = fields.fulfillment_posting_blocked_at?.id
  if (!reason || !blockedAt) return []
  const shippedAt = fields.fulfillment_shipped_at?.id ?? ''
  const total = fields.fulfillment_total?.id ?? ''
  const orderRel = fields.fulfillment_order?.id ?? ''
  const currency = fields.order_currency?.id ?? ''
  const zone = options.bookTimeZone ?? 'UTC'
  const day = sql`(ship."valueDate" AT TIME ZONE ${zone})::date`

  const result = await db.execute(sql`
    SELECT f."id", f."entityDefinitionId", f."displayName" AS "name",
      reason."valueText" AS "reason", mark."valueDate" AS "blockedAt",
      ship."valueDate" AS "shippedAt", tot."valueNumber" AS "total",
      ord."id" AS "orderId", ord."entityDefinitionId" AS "orderDefinitionId",
      ord."displayName" AS "orderName", cur."valueText" AS "currency"
    FROM "FieldValue" reason
    JOIN "EntityInstance" f ON f."id" = reason."entityId"
      AND f."organizationId" = reason."organizationId"
    LEFT JOIN "FieldValue" mark ON mark."organizationId" = reason."organizationId"
      AND mark."entityId" = reason."entityId" AND mark."fieldId" = ${blockedAt}
    LEFT JOIN "FieldValue" ship ON ship."organizationId" = reason."organizationId"
      AND ship."entityId" = reason."entityId" AND ship."fieldId" = ${shippedAt}
    LEFT JOIN "FieldValue" tot ON tot."organizationId" = reason."organizationId"
      AND tot."entityId" = reason."entityId" AND tot."fieldId" = ${total}
    LEFT JOIN "FieldValue" rel ON rel."organizationId" = reason."organizationId"
      AND rel."entityId" = reason."entityId" AND rel."fieldId" = ${orderRel}
    LEFT JOIN "EntityInstance" ord ON ord."id" = rel."relatedEntityId"
      AND ord."organizationId" = reason."organizationId"
    LEFT JOIN "FieldValue" cur ON cur."organizationId" = reason."organizationId"
      AND cur."entityId" = ord."id" AND cur."fieldId" = ${currency}
    WHERE ${blockedFulfillmentWhere(organizationId, defId, reason)}
      ${
        options.ids?.length
          ? sql`AND f."id" IN (${sql.join(
              options.ids.map((id) => sql`${id}`),
              sql`, `
            )})`
          : sql``
      }
      ${options.from ? sql`AND ${day} >= ${options.from}::date` : sql``}
      ${options.to ? sql`AND ${day} <= ${options.to}::date` : sql``}
      ${
        options.search
          ? sql`AND strpos(lower(concat_ws(' ', f."displayName", ord."displayName", reason."valueText")), lower(${options.search})) > 0`
          : sql``
      }
    ORDER BY mark."valueDate" DESC NULLS LAST, f."id" ASC
    LIMIT ${options.limit ?? 50} OFFSET ${options.offset ?? 0}
  `)
  return (
    result.rows as Array<{
      id: string
      entityDefinitionId: string
      name: string | null
      reason: string
      blockedAt: string | Date | null
      shippedAt: string | null
      total: number | string | null
      orderId: string | null
      orderDefinitionId: string | null
      orderName: string | null
      currency: string | null
    }>
  ).map((row) => ({
    id: row.id,
    entityDefinitionId: row.entityDefinitionId,
    name: row.name,
    orderId: row.orderId,
    orderDefinitionId: row.orderDefinitionId,
    orderName: row.orderName,
    shippedAt: row.shippedAt ? new Date(row.shippedAt).toISOString() : null,
    amountMinor: Number(row.total ?? 0),
    currency: row.currency ?? 'USD',
    reason: row.reason,
    blockedAt: row.blockedAt ? new Date(row.blockedAt) : null,
    // `resolve-roles.ts` opens every unmapped-role refusal with "Cannot post:".
    reasonKind: row.reason.startsWith('Cannot post:') ? 'account_unmapped' : 'other',
  }))
}

/** One parked shipment for the drawer, or `null` once it has posted or was never refused. */
export async function readBlockedFulfillment(
  db: Database,
  organizationId: string,
  fulfillmentId: string
): Promise<BlockedFulfillmentRow | null> {
  const [row] = await listBlockedFulfillments(db, organizationId, {
    ids: [fulfillmentId],
    limit: 1,
  })
  return row ?? null
}

/** The Blocked tab's badge share for shipments, counted in SQL. */
export async function countBlockedFulfillments(
  db: Database,
  organizationId: string
): Promise<number> {
  const defId = await getCachedEntityDefId(organizationId, 'fulfillment')
  if (!defId) return 0
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [
    'fulfillment_posting_blocked_reason',
  ])
  const reason = fields.fulfillment_posting_blocked_reason?.id
  if (!reason) return 0
  const result = await db.execute(sql`
    SELECT count(*)::int AS "total"
    FROM "FieldValue" reason
    JOIN "EntityInstance" f ON f."id" = reason."entityId"
      AND f."organizationId" = reason."organizationId"
    WHERE ${blockedFulfillmentWhere(organizationId, defId, reason)}
  `)
  return Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0)
}
