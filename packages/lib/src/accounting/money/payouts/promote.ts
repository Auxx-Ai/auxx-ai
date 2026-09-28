// packages/lib/src/accounting/money/payouts/promote.ts

/**
 * Promote a connector-written payout in place: stamp the ledger fields from its evidence so the
 * stored-payout sweep can post it (brief 114 P2). Never posts, and never writes `failed` or
 * `reversed` itself: a negative provider status goes through `reverseFailedPayout`.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { toRecordId } from '../../../resources/resource-id'
import { readSystemRecords, type SystemRecord } from '../../../resources/system-records'
import { SystemUserService } from '../../../users/system-user-service'
import { isAccountingActive } from '../../ledger/setup/accounting-enabled'
import { providerPayoutState } from '../../processors/client'
import { listLinkedFeeds, listPaymentGateways } from '../../rails/reads'
import { exactEvidenceMinor } from '../customer-money/evidence-contracts'
import { type PayoutStatus, resolvePayoutStatus } from './client'
import { loadPayoutFieldContext, type PayoutAttribute } from './fields'
import { guard } from './guard'
import { findPayoutByGatewayId, listUnpromotedConnectorPayouts } from './reads'
import { reverseFailedPayout } from './sync'

const logger = createScopedLogger('payouts:promote')

/** The ledger fields a promotion reads before it writes; `null` is unset. */
export interface PromotionCurrent {
  gatewayId: string | null
  railId: string | null
  status: PayoutStatus | null
  paidAt: string | null
  currency: string | null
  depositedMinor: number | null
}

/** The connector's evidence for the same payout. */
export interface PromotionEvidence {
  providerKey: string
  externalId: string
  status: string | null
  issuedOn: string | null
  amount: string | null
  currency: string | null
  currencyExponent: number | null
}

/** What to write, and whether the provider's status says to run the failed-payout reversal. */
export interface PromotionPlan {
  values: Record<string, unknown>
  reverse: boolean
}

/**
 * The promotion for one record, or `null` when it must be left alone (no linked rail, or ledger
 * fields naming another payout or rail). Fills only unset fields; status only moves
 * `in_transit` → `paid`.
 */
export function planPayoutPromotion(input: {
  current: PromotionCurrent
  evidence: PromotionEvidence
  rail: { id: string; recordId: string } | null
}): PromotionPlan | null {
  const { current, evidence, rail } = input
  if (!rail) return null
  if (current.gatewayId && current.gatewayId !== evidence.externalId) return null
  if (current.railId && current.railId !== rail.id) return null

  const values: Record<string, unknown> = {}
  if (!current.gatewayId) values.payout_gateway_id = evidence.externalId
  if (!current.railId) values.payout_payment_gateway = rail.recordId
  if (!current.currency && evidence.currency)
    values.payout_currency = evidence.currency.toLowerCase()
  if (current.depositedMinor === null) {
    const deposited = depositedMinor(evidence)
    if (deposited !== null) values.payout_deposited = deposited
  }

  const state = providerPayoutState(evidence.providerKey, evidence.status)
  if (state === 'negative') {
    const settled = current.status === 'failed' || current.status === 'reversed'
    return { values, reverse: !settled }
  }
  const unset = current.status === null
  if (state === 'paid' && (unset || current.status === 'in_transit')) {
    const paidAt = current.paidAt ?? evidence.issuedOn?.slice(0, 10) ?? null
    // `paid` without a date could never post, so it waits in transit for one.
    if (paidAt) {
      values.payout_status = 'paid'
      if (!current.paidAt) values.payout_paid_at = paidAt
    } else if (unset) values.payout_status = 'in_transit'
  } else if (unset) values.payout_status = 'in_transit'
  return { values, reverse: false }
}

function depositedMinor(evidence: PromotionEvidence): number | null {
  const { amount, currency, currencyExponent } = evidence
  if (!amount || !currency || currencyExponent === null) return null
  try {
    return Number(exactEvidenceMinor(amount, currency.toUpperCase(), currencyExponent))
  } catch {
    return null
  }
}

/** What one promotion pass did. */
export interface PromotionCounts {
  promoted: number
  reversed: number
  skipped: number
}

/**
 * Promote these payout records. Records with no connector evidence, on an unlinked feed, or in an
 * org whose accounting is not active are skipped. One bad record never stops the rest.
 */
export async function promoteConnectorPayouts(
  db: Database,
  input: { organizationId: string; payoutIds: readonly string[]; actorUserId?: string }
): Promise<Result<PromotionCounts, Error>> {
  const { organizationId } = input
  return guard(
    async () => {
      const counts: PromotionCounts = { promoted: 0, reversed: 0, skipped: 0 }
      const ids = [...new Set(input.payoutIds)]
      if (!ids.length || !(await isAccountingActive(organizationId))) return counts
      const fieldCtx = await loadPayoutFieldContext(db, organizationId)
      if (!fieldCtx) return counts
      const records = (await readSystemRecords(db, organizationId, fieldCtx, { ids })).filter(
        (record) =>
          record.text('payout_source_provider_key') && record.text('payout_source_external_id')
      )
      if (!records.length) return counts

      const [feeds, gateways] = await Promise.all([
        listLinkedFeeds(db, organizationId),
        listPaymentGateways(db, organizationId),
      ])
      if (gateways.isErr()) throw gateways.error
      const actorUserId =
        input.actorUserId ?? (await SystemUserService.getSystemUserForActions(organizationId))
      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)

      for (const record of records) {
        const evidence = readEvidence(record)
        const feed = feeds.find(
          (row) =>
            row.providerKey === evidence.providerKey &&
            row.externalAccountId === record.text('payout_source_account_id') &&
            row.environment === record.text('payout_source_environment')
        )
        const rail = feed ? gateways.value.find((row) => row.id === feed.paymentGatewayId) : null
        const plan = planPayoutPromotion({
          current: readCurrent(record),
          evidence,
          rail: rail ?? null,
        })
        if (!plan || !rail) {
          counts.skipped++
          continue
        }
        try {
          // The legacy sync's record for the same payout wins until the twins are folded (P4).
          const holder = await findPayoutByGatewayId(
            db,
            organizationId,
            evidence.externalId,
            rail.id
          )
          if (holder && holder.payoutId !== record.id) {
            logger.warn('Another record already holds this payout, not promoting its twin', {
              organizationId,
              payoutId: record.id,
              heldBy: holder.payoutId,
            })
            counts.skipped++
            continue
          }
          if (Object.keys(plan.values).length) {
            await crud.update(toRecordId(fieldCtx.defId, record.id), plan.values)
            counts.promoted++
          }
          if (plan.reverse) {
            const reversal = await reverseFailedPayout(db, {
              organizationId,
              gatewayPayoutId: evidence.externalId,
              paymentGatewayId: rail.id,
              actorUserId,
            })
            if (reversal.isErr()) throw reversal.error
            counts.reversed++
          }
        } catch (error) {
          logger.error('Could not promote a connector payout', {
            organizationId,
            payoutId: record.id,
            error: error instanceof Error ? error.message : String(error),
          })
          counts.skipped++
        }
      }
      return counts
    },
    'Failed to promote connector payouts',
    { organizationId }
  )
}

/**
 * Promote one page of connector payouts that carry no ledger id yet, optionally for one feed:
 * the catch-up for records written before the feed was linked or accounting went active.
 */
export async function promotePendingPayouts(
  db: Database,
  input: { organizationId: string; limit: number; sourceAccountId?: string; actorUserId?: string }
): Promise<Result<PromotionCounts, Error>> {
  const { organizationId, limit, sourceAccountId, actorUserId } = input
  return guard(
    async () => {
      const payoutIds = await listUnpromotedConnectorPayouts(db, organizationId, {
        limit,
        sourceAccountId,
      })
      const counts = await promoteConnectorPayouts(db, { organizationId, payoutIds, actorUserId })
      if (counts.isErr()) throw counts.error
      return counts.value
    },
    'Failed to promote pending payouts',
    { organizationId, sourceAccountId }
  )
}

function readCurrent(record: SystemRecord<PayoutAttribute>): PromotionCurrent {
  const status = record.option('payout_status')
  return {
    gatewayId: record.text('payout_gateway_id'),
    railId: record.related('payout_payment_gateway'),
    status: status ? resolvePayoutStatus(status) : null,
    paidAt: record.date('payout_paid_at')?.slice(0, 10) ?? null,
    currency: record.text('payout_currency'),
    depositedMinor: record.number('payout_deposited'),
  }
}

function readEvidence(record: SystemRecord<PayoutAttribute>): PromotionEvidence {
  return {
    providerKey: record.text('payout_source_provider_key') ?? '',
    externalId: record.text('payout_source_external_id') ?? '',
    status: record.text('payout_source_status'),
    issuedOn: record.text('payout_source_issued_on'),
    amount: record.text('payout_source_amount'),
    currency: record.text('payout_source_currency'),
    currencyExponent: record.number('payout_source_currency_exponent'),
  }
}
