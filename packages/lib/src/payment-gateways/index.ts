// packages/lib/src/payment-gateways/index.ts

/**
 * Payment gateways: a record carrying its own clearing account, never a role
 * (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §5.3).
 *
 * 🛑 Server-only. Client code imports `@auxx/lib/payment-gateways/client`,
 * which carries the vocabularies, the read model and the pure handle/route
 * arithmetic.
 */

export type {
  GatewayRoute,
  PaymentGatewayRow,
  PaymentGatewaySettlementSourceValue,
  PaymentGatewayStatusValue,
} from './client'
export {
  normaliseGatewayHandle,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS,
  PAYMENT_GATEWAY_SETTLEMENT_SOURCES,
  PAYMENT_GATEWAY_STATUS_LABELS,
  PAYMENT_GATEWAY_STATUSES,
  resolvePaymentGatewaySettlementSource,
  resolvePaymentGatewayStatus,
  toGatewayRoutes,
} from './client'
export type { PaymentGatewayFieldContext } from './reads'
export {
  getPaymentGateway,
  listPaymentGateways,
  loadPaymentGatewayFieldContext,
  requirePaymentGatewayFieldContext,
} from './reads'
export type {
  ArchivePaymentGatewayInput,
  CreatePaymentGatewayInput,
  UpdatePaymentGatewayInput,
} from './writes'
export { archivePaymentGateway, createPaymentGateway, updatePaymentGateway } from './writes'
