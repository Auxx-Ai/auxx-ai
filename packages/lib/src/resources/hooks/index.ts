// packages/lib/src/resources/hooks/index.ts

export { BANK_DEPOSIT_HOOKS } from './bank-deposit-hooks'
export { BUILD_HOOKS } from './build-hooks'
export { autoSetCreatedBy, COMMON_HOOKS } from './common-hooks'
export { CONTACT_HOOKS } from './contact-hooks'
export { INVOICE_HOOKS } from './invoice-hooks'
export { JOURNAL_ENTRY_HOOKS } from './journal-entry-hooks'
export { LINE_ITEM_HOOKS } from './line-item-hooks'
export { ORDER_HOOKS } from './order-hooks'
export { PAYMENT_HOOKS } from './payment-hooks'
export { PURCHASE_ORDER_HOOKS, VENDOR_BILL_HOOKS } from './purchasing-hooks'
export { QUOTE_HOOKS } from './quote-hooks'
export { SERVICE_REQUEST_HOOKS } from './service-request-hooks'
export {
  getCommonHooks,
  getHooksForAttribute,
  getSystemHooks,
  hasSystemHooks,
} from './system-hooks'
export { TICKET_HOOKS } from './ticket-hooks'
export type { SystemHook, SystemHookContext, SystemHookRegistry } from './types'
export { WORK_ORDER_HOOKS } from './work-order-hooks'
