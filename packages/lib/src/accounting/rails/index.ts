// packages/lib/src/accounting/rails/index.ts

/**
 * Payment gateways: a record carrying its own clearing account, never a role
 * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §5.3).
 *
 * 🛑 Server-only. Client code imports `@auxx/lib/accounting/rails/client`,
 * which carries the vocabularies, the read model and the pure handle/route
 * arithmetic.
 */

export type {
  GatewayHandleCensusRow,
  ObservedGatewayHandle,
  PaymentGatewayFeeTreatmentValue,
  PaymentGatewayRow,
  PaymentGatewaySettlementSourceValue,
  PaymentGatewayStatusValue,
} from './client'
export {
  type GatewayRoute,
  matchGatewayRoute,
  normaliseGatewayHandle,
  PAYMENT_GATEWAY_FEE_TREATMENT_LABELS,
  PAYMENT_GATEWAY_FEE_TREATMENTS,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCES,
  PAYMENT_GATEWAY_STATUS_LABELS,
  PAYMENT_GATEWAY_STATUSES,
  RESERVED_GATEWAY_HANDLES,
  resolvePaymentGatewayFeeTreatment,
  resolvePaymentGatewaySettlementSource,
  resolvePaymentGatewayStatus,
  toGatewayRoutes,
} from './client'
export type { GatewayReadiness } from './feeds'
export { linkFeed, readiness, unlinkFeed } from './feeds'
// ── plans/accounting/tasks/26 §7: a clearing account per rail ───────────────
export {
  type MintedRailAccounts,
  type MintRailAccountsInput,
  mintRailAccounts,
} from './mint-rail-accounts'
// ── plans/accounting/tasks/26 §6: billed fees, shown and never accrued ───────
export {
  type RailFeeAccount,
  type RailFeeStatus,
  type ReadRailFeeStatusOptions,
  readRailFeeStatus,
} from './rail-fee-status'
export {
  getPaymentGateway,
  type LinkedFeed,
  listGatewayHandleCensus,
  listLinkedFeeds,
  listObservedGatewayHandles,
  listPaymentGateways,
  requirePaymentGatewayDefId,
} from './reads'
export type { ClearingAccountBalance } from './repoint'
export { readClearingAccountBalance } from './repoint'
export type { UnlinkedFeed } from './settlement-discovery'
export { listUnlinkedFeeds } from './settlement-discovery'
export type {
  ArchivePaymentGatewayInput,
  CreatePaymentGatewayInput,
  UpdatePaymentGatewayInput,
} from './writes'
export { archivePaymentGateway, createPaymentGateway, updatePaymentGateway } from './writes'
