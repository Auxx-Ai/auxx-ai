// packages/lib/src/accounting/money/payouts/sweep-stored-entries.ts

/**
 * Posts payouts the sync imported while accounting was in draft (110 G7): the nightly sync
 * re-offers only its 30-day lookback, so an older stored payout would otherwise never post.
 */

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { readSystemRecords } from '../../../resources/system-records'
import { readOrganizationSettings } from '../../../settings/read'
import { listPaymentGateways } from '../../rails/reads'
import { noWorkItem, runWorkItemSweep, type SweepCounts } from '../../work-items/sweep'
import { upsertWorkItem } from '../../work-items/write'
import { loadPayoutFieldContext } from './fields'
import { getPayoutSource } from './source-registry'
import { repostStoredPayout } from './sync'

/** The lane `ingestOne` parks a refused payout on. */
const LANE = { stage: 'post', sourceKind: 'payout' } as const

/**
 * Paid payout records dated after the cutover month with no subject claim, no `post` work item
 * and no reversed entry (a person's reversal stands), oldest first.
 */
export async function listStoredPayoutCandidates(
  db: Database,
  organizationId: string,
  input: { cutoffPeriod: string | null; limit: number }
): Promise<string[]> {
  const ctx = await loadPayoutFieldContext(db, organizationId)
  if (!ctx) return []
  const {
    payout_status,
    payout_paid_at,
    payout_gateway_id,
    payout_payment_gateway,
    payout_number,
  } = ctx.fields
  if (!payout_status || !payout_paid_at || !payout_gateway_id || !payout_payment_gateway) return []
  const numberField = payout_number?.id ?? '__unmaterialised__'
  const result = await db.execute(sql`
    SELECT e.id
    FROM "EntityInstance" e
    JOIN "FieldValue" st ON st."organizationId" = e."organizationId" AND st."entityId" = e.id
      AND st."fieldId" = ${payout_status.id} AND st."optionId" = 'paid'
    JOIN "FieldValue" pa ON pa."organizationId" = e."organizationId" AND pa."entityId" = e.id
      AND pa."fieldId" = ${payout_paid_at.id} AND pa."valueDate" IS NOT NULL
    JOIN "FieldValue" gw ON gw."organizationId" = e."organizationId" AND gw."entityId" = e.id
      AND gw."fieldId" = ${payout_gateway_id.id} AND gw."valueText" IS NOT NULL
    JOIN "FieldValue" rl ON rl."organizationId" = e."organizationId" AND rl."entityId" = e.id
      AND rl."fieldId" = ${payout_payment_gateway.id} AND rl."relatedEntityId" IS NOT NULL
    LEFT JOIN "FieldValue" nb ON nb."organizationId" = e."organizationId" AND nb."entityId" = e.id
      AND nb."fieldId" = ${numberField}
    WHERE e."organizationId" = ${organizationId}
      AND e."entityDefinitionId" = ${ctx.defId}
      AND e."archivedAt" IS NULL
      ${
        input.cutoffPeriod
          ? sql`AND to_char(pa."valueDate" AT TIME ZONE 'UTC', 'YYYY-MM') > ${input.cutoffPeriod}`
          : sql``
      }
      AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" link
        WHERE link."organizationId" = ${organizationId} AND link."sourceKind" = 'payout'
          AND link."sourceId" = e.id AND link."linkRole" = 'subject')
      AND NOT EXISTS (SELECT 1 FROM "GlPosting" p
        WHERE p."organizationId" = ${organizationId} AND p."postingType" = 'payout'
          AND p."status" = 'reversed' AND nb."valueText" IS NOT NULL
          AND (p."periodKey" = nb."valueText" OR p."periodKey" LIKE nb."valueText" || '-R%'))
      AND ${noWorkItem(organizationId, { ...LANE, sourceId: sql`e.id` })}
    ORDER BY pa."valueDate" ASC, e.id ASC
    LIMIT ${input.limit}
  `)
  return (result.rows as Array<{ id: string }>).map((row) => row.id)
}

/** Bounded catch-up for stored payouts with no entry: never-tried first, then due work items. */
export async function sweepStoredPayoutEntries(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<SweepCounts> {
  const { organizationId } = input
  const [settings, fieldCtx, gateways] = await Promise.all([
    readOrganizationSettings(organizationId, ['accounting.cutoffPeriod'] as const),
    loadPayoutFieldContext(db, organizationId),
    listPaymentGateways(db, organizationId),
  ])
  if (gateways.isErr()) throw gateways.error
  return runWorkItemSweep(db, {
    organizationId,
    ...LANE,
    limit: input.limit ?? 100,
    timeBudgetMs: input.timeBudgetMs,
    listFresh: (limit) =>
      listStoredPayoutCandidates(db, organizationId, {
        cutoffPeriod: settings['accounting.cutoffPeriod'] ?? null,
        limit,
      }),
    handle: async (payoutId) => {
      if (!fieldCtx) return { status: 'skipped' }
      const [record] = await readSystemRecords(db, organizationId, fieldCtx, { ids: [payoutId] })
      const providerPayoutId = record?.text('payout_gateway_id')
      if (!record || !providerPayoutId) return { status: 'skipped' }
      const rail = gateways.value.find((row) => row.id === record.related('payout_payment_gateway'))
      const source = rail ? getPayoutSource(rail.settlementSource) : null
      if (!rail || !source || source.isErr()) {
        await upsertWorkItem(db, organizationId, {
          ...LANE,
          sourceId: payoutId,
          reasonCode: 'GATEWAY_UNMAPPED',
          railId: rail?.id,
        })
        return { status: 'blocked' }
      }
      const outcome = await repostStoredPayout(db, {
        ctx: { organizationId, sourceId: source.value.id, rail, handle: null },
        providerPayoutId,
      })
      if (outcome.isErr()) throw outcome.error
      const { status } = outcome.value
      if (status === 'posted') return { status: 'accepted' }
      if (status === 'refused') return { status: 'blocked' }
      return { status: 'skipped' }
    },
  })
}
