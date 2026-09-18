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

/** Records of one kind with no `FinancialSourceObject` yet, oldest id first. */
export async function findUnbridgedFinancialRecords(
  db: Database,
  input: { organizationId: string; kind: SweepableKind; limit: number; after?: string }
): Promise<string[]> {
  const { specs } = await bridgeFieldSpecs(input.organizationId, input.kind)
  const prefix = ATTRIBUTES[input.kind]
  const fieldId = (suffix: string) =>
    [...specs].find(([, spec]) => spec.attribute === `${prefix}${suffix}`)?.[0]
  const external = fieldId('external_id')
  const provider = fieldId('provider_key')
  const account = fieldId('account_id')
  const environment = fieldId('environment')
  if (!external || !provider || !account || !environment) return []
  const result = await db.execute(sql`
    SELECT ex."entityId" AS id
    FROM "FieldValue" ex
    JOIN "FieldValue" pk ON pk."organizationId" = ex."organizationId"
      AND pk."entityId" = ex."entityId" AND pk."fieldId" = ${provider}
    JOIN "FieldValue" ac ON ac."organizationId" = ex."organizationId"
      AND ac."entityId" = ex."entityId" AND ac."fieldId" = ${account}
    JOIN "FieldValue" en ON en."organizationId" = ex."organizationId"
      AND en."entityId" = ex."entityId" AND en."fieldId" = ${environment}
    WHERE ex."organizationId" = ${input.organizationId}
      AND ex."fieldId" = ${external}
      AND ex."valueText" IS NOT NULL
      ${input.after ? sql`AND ex."entityId" > ${input.after}` : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM "FinancialSourceObject" o
        JOIN "FinancialSourceAccount" a ON a."organizationId" = o."organizationId" AND a.id = o."sourceAccountId"
        WHERE o."organizationId" = ${input.organizationId}
          AND o."objectType" = ${OBJECT_TYPE[input.kind]}
          AND o."externalId" = ex."valueText"
          AND a."providerKey" = pk."valueText"
          AND a."externalAccountId" = ac."valueText"
          AND a."environment" = en."valueText"
      )
    ORDER BY ex."entityId"
    LIMIT ${input.limit}
  `)
  return (result.rows as Array<{ id: string }>).map((row) => row.id)
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
