// packages/lib/src/money/payments/deposit.ts
// Deposit amount math for money MP2 §B.4 (deposits on quote acceptance, pre-payment model).
// `computeDepositAmount` is pure — no Stripe import, no DB access — same shape as
// `resolveApplicationFee` (fees.ts) and `computeDiscountAmount` (totals.ts), unit-tested the
// same way (deposit.test.ts, sibling to fees.test.ts). `resolveQuoteDeposit` is the I/O
// wrapper that reads the per-quote override (falling back to the org default setting) and
// feeds it through the pure function — used by the public quote payload (§B.5) and the
// deposit checkout route (§B.7).

import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'

/** `quote_deposit_type` / `documents.quote.depositType` values. */
export type QuoteDepositType = 'none' | 'percent' | 'fixed'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned (the
 * SINGLE_SELECT/MULTI_SELECT/RELATIONSHIP read convention — see `ARRAY_RETURN_FIELD_TYPES`). */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Resolve the deposit amount for a quote, in integer cents. Pure — no I/O — clamped to
 * `[0, total]` and rounded to the nearest cent, matching `resolveApplicationFee`'s posture
 * (never let a deposit exceed or negative-out the document it's held against).
 *
 * `depositValue` is human-entered (a plain NUMBER field, no cents-aware editor): a percent
 * (0-100) when depositType is `percent`, a CURRENCY-UNIT amount (`50` = $50.00, decimals ok)
 * when `fixed` — NOT cents; the ×100 here is the only place that converts.
 *
 * `none`/`null` depositType, or a falsy depositValue, always resolves to 0 (no deposit
 * configured — the caller hides the deposit card/blocks checkout on this).
 */
export function computeDepositAmount(
  total: number,
  depositType: QuoteDepositType | null | undefined,
  depositValue: number | null | undefined
): number {
  if (!depositType || depositType === 'none' || !depositValue) return 0
  const raw = depositType === 'percent' ? total * (depositValue / 100) : depositValue * 100
  return Math.round(Math.max(0, Math.min(raw, total)))
}

/** Result of {@link resolveQuoteDeposit}. */
export interface ResolvedQuoteDeposit {
  depositType: QuoteDepositType
  /** Integer cents. 0 = no deposit configured. */
  depositAmount: number
}

/**
 * Read `quote_deposit_type`/`quote_deposit_value` off the quote instance; when both are unset,
 * falls back to the org defaults (`documents.quote.depositType`/`depositValue`). Feeds the
 * resolved type/value through {@link computeDepositAmount} against `total` (the quote's
 * `quote_total`, integer cents). Used by both the public quote payload (§B.5) and the deposit
 * checkout route (§B.6) so they never compute this independently.
 */
export async function resolveQuoteDeposit(
  organizationId: string,
  quoteInstanceId: string,
  total: number
): Promise<ResolvedQuoteDeposit> {
  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  const handler = new UnifiedCrudHandler(organizationId, systemUserId)
  const quoteRecordId = toRecordId('quote', quoteInstanceId)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['quote_deposit_type', 'quote_deposit_value'] as const)

  const fieldIds = [cf.quote_deposit_type, cf.quote_deposit_value].filter(Boolean).map((f) => f!.id)
  const values = fieldIds.length
    ? await handler.getFieldValues(quoteRecordId, fieldIds)
    : new Map<string, TypedFieldValue | TypedFieldValue[]>()

  const depositTypeTyped = cf.quote_deposit_type
    ? firstTyped(values.get(cf.quote_deposit_type.id))
    : undefined
  const depositValueTyped = cf.quote_deposit_value
    ? firstTyped(values.get(cf.quote_deposit_value.id))
    : undefined

  let depositType = depositTypeTyped
    ? (extractValue(depositTypeTyped) as QuoteDepositType)
    : undefined
  let depositValue = depositValueTyped ? Number(extractValue(depositValueTyped)) : undefined

  if (!depositType && depositValue == null) {
    const [orgDepositType, orgDepositValue] = await Promise.all([
      getOrganizationSetting({ organizationId, key: 'documents.quote.depositType' }),
      getOrganizationSetting({ organizationId, key: 'documents.quote.depositValue' }),
    ])
    depositType = (orgDepositType as QuoteDepositType | undefined) ?? 'none'
    depositValue = Number(orgDepositValue ?? 0)
  }

  const resolvedType = depositType ?? 'none'
  return {
    depositType: resolvedType,
    depositAmount: computeDepositAmount(total, resolvedType, depositValue ?? 0),
  }
}
