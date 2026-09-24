// packages/lib/src/accounting/money/customer-money/bridge-sweep.ts

/**
 * What the sync and reconciler doors missed (brief 69 §5).
 *
 * One anti-join per kind against the `FinancialSourceObject` identity index,
 * keyset on `entityId`. The account side is joined through the record's own
 * provider/account/environment fields rather than matched on `externalId` alone:
 * two source accounts on one org can report the same provider id.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { assessPayouts } from '../payouts/assess-payouts'
import { type BridgeRecordKind, bridgeFieldSpecs, bridgeFinancialRecords } from './bridge'

const logger = createScopedLogger('evidence-bridge')

/** The three defs that carry their own source identity; orders arrive through their transactions. */
export const SWEEPABLE_KINDS = [
  'payout',
  'processor_balance_entry',
  'customer_transaction',
] as const
export type SweepableKind = (typeof SWEEPABLE_KINDS)[number]

const OBJECT_TYPE: Record<SweepableKind, string> = {
  payout: 'payout',
  processor_balance_entry: 'balance_transaction',
  customer_transaction: 'order_transaction',
}

const ATTRIBUTES: Record<SweepableKind, string> = {
  payout: 'payout_source_',
  processor_balance_entry: 'processor_balance_',
  customer_transaction: 'customer_transaction_',
}

/** A kind's field id by attribute suffix, from the bridge's own spec map. */
async function kindFieldIds(organizationId: string, kind: SweepableKind) {
  const { specs } = await bridgeFieldSpecs(organizationId, kind)
  const prefix = ATTRIBUTES[kind]
  return (suffix: string) =>
    [...specs].find(([, spec]) => spec.attribute === `${prefix}${suffix}`)?.[0]
}

/**
 * The record's identity values joined as `ex`/`pk`/`ac`/`en`, and the `FinancialSourceObject`
 * they name as `o` for an `EXISTS` body. Null when an identity field is missing.
 */
function identityJoin(
  organizationId: string,
  kind: SweepableKind,
  field: (suffix: string) => string | undefined
) {
  const external = field('external_id')
  const provider = field('provider_key')
  const account = field('account_id')
  const environment = field('environment')
  if (!external || !provider || !account || !environment) return null
  return {
    from: sql`"FieldValue" ex
    JOIN "FieldValue" pk ON pk."organizationId" = ex."organizationId"
      AND pk."entityId" = ex."entityId" AND pk."fieldId" = ${provider}
    JOIN "FieldValue" ac ON ac."organizationId" = ex."organizationId"
      AND ac."entityId" = ex."entityId" AND ac."fieldId" = ${account}
    JOIN "FieldValue" en ON en."organizationId" = ex."organizationId"
      AND en."entityId" = ex."entityId" AND en."fieldId" = ${environment}`,
    where: sql`ex."organizationId" = ${organizationId}
      AND ex."fieldId" = ${external}
      AND ex."valueText" IS NOT NULL`,
    object: sql`"FinancialSourceObject" o
        JOIN "FinancialSourceAccount" a ON a."organizationId" = o."organizationId" AND a.id = o."sourceAccountId"
        WHERE o."organizationId" = ${organizationId}
          AND o."objectType" = ${OBJECT_TYPE[kind]}
          AND o."externalId" = ex."valueText"
          AND a."providerKey" = pk."valueText"
          AND a."externalAccountId" = ac."valueText"
          AND a."environment" = en."valueText"`,
  }
}

/** Records of one kind with no `FinancialSourceObject` yet, oldest id first. */
export async function findUnbridgedFinancialRecords(
  db: Database,
  input: { organizationId: string; kind: SweepableKind; limit: number; after?: string }
): Promise<string[]> {
  const field = await kindFieldIds(input.organizationId, input.kind)
  const identity = identityJoin(input.organizationId, input.kind, field)
  if (!identity) return []
  const result = await db.execute(sql`
    SELECT ex."entityId" AS id
    FROM ${identity.from}
    WHERE ${identity.where}
      ${input.after ? sql`AND ex."entityId" > ${input.after}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM ${identity.object})
    ORDER BY ex."entityId"
    LIMIT ${input.limit}
  `)
  return (result.rows as Array<{ id: string }>).map((row) => row.id)
}

/** {@link findUnbridgedFinancialRecords} as a count: what the bridge sweep has left to do. */
export async function countUnbridgedFinancialRecords(
  db: Database,
  input: { organizationId: string; kind: SweepableKind }
): Promise<number> {
  const field = await kindFieldIds(input.organizationId, input.kind)
  const identity = identityJoin(input.organizationId, input.kind, field)
  if (!identity) return 0
  const result = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM ${identity.from}
    WHERE ${identity.where}
      AND NOT EXISTS (SELECT 1 FROM ${identity.object})
  `)
  return Number((result.rows as Array<{ count: number }>)[0]?.count ?? 0)
}

/** Channel money records still to materialize, and how many book days and months they span. */
export interface RecordMoneyBacklog {
  count: number
  days: number
  months: number
}

/**
 * Live, confirmed receipt and refund `customer_transaction` records processed after the cutover
 * (book zone) whose source object holds no `MoneySourceLink`, bridged or not.
 */
export async function countUnmaterializedCustomerTransactions(
  db: Database,
  input: { organizationId: string; cutoffPeriod: string; bookTimeZone: string }
): Promise<RecordMoneyBacklog> {
  const { organizationId, cutoffPeriod, bookTimeZone } = input
  const field = await kindFieldIds(organizationId, 'customer_transaction')
  const identity = identityJoin(organizationId, 'customer_transaction', field)
  const kind = field('kind')
  const status = field('status')
  const processedAt = field('processed_at')
  const test = field('test')
  if (!identity || !kind || !status || !processedAt) return { count: 0, days: 0, months: 0 }
  // Provider text: only an ISO date prefix is cast, so one malformed value cannot fail the count.
  const day = sql`(CASE WHEN pa."valueText" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    THEN (pa."valueText"::timestamptz AT TIME ZONE ${bookTimeZone})::date END)`
  const notTest = test
    ? sql`AND NOT EXISTS (SELECT 1 FROM "FieldValue" te
        WHERE te."organizationId" = ex."organizationId" AND te."entityId" = ex."entityId"
          AND te."fieldId" = ${test} AND te."valueBoolean" = TRUE)`
    : sql``
  const result = await db.execute(sql`
    SELECT count(*)::int AS count,
      count(DISTINCT docs.day)::int AS days,
      count(DISTINCT to_char(docs.day, 'YYYY-MM'))::int AS months
    FROM (
      SELECT ${day} AS day
      FROM ${identity.from}
      JOIN "FieldValue" ki ON ki."organizationId" = ex."organizationId"
        AND ki."entityId" = ex."entityId" AND ki."fieldId" = ${kind}
        AND ki."valueText" IN ('receipt', 'refund')
      JOIN "FieldValue" st ON st."organizationId" = ex."organizationId"
        AND st."entityId" = ex."entityId" AND st."fieldId" = ${status}
        AND st."valueText" = 'confirmed'
      JOIN "FieldValue" pa ON pa."organizationId" = ex."organizationId"
        AND pa."entityId" = ex."entityId" AND pa."fieldId" = ${processedAt}
      WHERE ${identity.where}
        AND en."valueText" = 'live'
        ${notTest}
        AND NOT EXISTS (
          SELECT 1 FROM ${identity.object}
            AND EXISTS (SELECT 1 FROM "MoneySourceLink" l
              WHERE l."organizationId" = o."organizationId" AND l."sourceObjectId" = o.id)
        )
    ) docs
    WHERE to_char(docs.day, 'YYYY-MM') > ${cutoffPeriod}
  `)
  const row = (result.rows as Array<{ count: number; days: number; months: number }>)[0]
  return {
    count: Number(row?.count ?? 0),
    days: Number(row?.days ?? 0),
    months: Number(row?.months ?? 0),
  }
}

/** Bridge up to `limit` records an org has left unbridged, then assess what moved. */
export async function sweepFinancialRecordBridge(
  db: Database,
  input: { organizationId: string; actorUserId?: string; limit?: number }
): Promise<{ found: number; bridged: number; skipped: number }> {
  const budget = input.limit ?? 500
  const records: Array<{ id: string; kind: BridgeRecordKind }> = []
  for (const kind of SWEEPABLE_KINDS) {
    if (records.length >= budget) break
    const ids = await findUnbridgedFinancialRecords(db, {
      organizationId: input.organizationId,
      kind,
      limit: budget - records.length,
    })
    for (const id of ids) records.push({ id, kind })
  }
  if (!records.length) return { found: 0, bridged: 0, skipped: 0 }
  const result = await bridgeFinancialRecords(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? '',
    records,
  })
  if (result.payoutInstanceIds.length)
    await assessPayouts(db, input.organizationId, result.payoutInstanceIds)
  const kinds = [result.payout, result.processor_balance_entry, result.customer_transaction]
  const summary = {
    found: records.length,
    bridged: kinds.reduce((total, counts) => total + counts.bridged, 0),
    skipped: kinds.reduce((total, counts) => total + counts.skipped, 0),
  }
  logger.info('Bridged financial records the sync path missed', {
    organizationId: input.organizationId,
    ...summary,
  })
  return summary
}
