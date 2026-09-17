// packages/lib/src/payment-gateways/index.ts

/**
 * Payment gateways: a record carrying its own clearing account, never a role
 * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §5.3).
 *
 * 🛑 Server-only. Client code imports `@auxx/lib/payment-gateways/client`,
 * which carries the vocabularies, the read model and the pure handle/route
 * arithmetic.
 */

export type {
  GatewayHandleCensusRow,
  GatewayRoute,
  ObservedGatewayHandle,
  PaymentGatewayFeeTreatmentValue,
  PaymentGatewayRow,
  PaymentGatewaySettlementSourceValue,
  PaymentGatewayStatusValue,
} from './client'
export {
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
export type { PaymentGatewayFieldContext } from './reads'
export {
  getPaymentGateway,
  listGatewayHandleCensus,
  listObservedGatewayHandles,
  listPaymentGateways,
  loadPaymentGatewayFieldContext,
  requirePaymentGatewayFieldContext,
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
