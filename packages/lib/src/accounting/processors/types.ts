// packages/lib/src/accounting/processors/types.ts

import type {
  PaymentGatewayFeeTreatmentValue,
  PaymentGatewaySettlementSourceValue,
} from '../rails/client'

/** A processor auxx can read: every settlement source except `manual`. */
export type ProcessorId = Exclude<PaymentGatewaySettlementSourceValue, 'manual'>

/** How one provider payout status reads in the ledger; `negative` goes through the failed-payout reversal. */
export type ProviderPayoutState = 'paid' | 'in_transit' | 'negative'

/** Whether a feed's `externalAccountId` reads as a name (`external_id`) or needs the provider label. */
export type ProcessorAccountLabel = 'external_id' | 'label'

/**
 * What auxx knows about one processor, in one place (brief 113 D1).
 *
 * `id` is both the rail's `settlementSource` and the `providerKey` its feed carries.
 */
export interface ProcessorDescriptor {
  id: ProcessorId
  /** Matches `PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[id]`. */
  label: string
  /** The rail name `suggestRail` proposes for these handles. */
  railName: string
  /** Normalised gateway handles (`normaliseGatewayHandle`) this processor settles. */
  handles: readonly string[]
  feeTreatment: PaymentGatewayFeeTreatmentValue
  /** The installed app whose connector reads this feed; null when no app does. */
  feedApp: string | null
  accountLabel: ProcessorAccountLabel
  /** The feed's `payout_source_status` values, as ledger states (brief 114 P2). */
  payoutStatuses: Readonly<Record<string, ProviderPayoutState>>
  /** What a status missing from {@link payoutStatuses} reads as. */
  otherPayoutStatus: ProviderPayoutState
}
