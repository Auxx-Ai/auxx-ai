// packages/lib/src/resources/hooks/index.ts

export { autoSetCreatedBy, COMMON_HOOKS } from './common-hooks'
export { CONTACT_HOOKS } from './contact-hooks'
export { INVOICE_HOOKS } from './invoice-hooks'
export { PAYMENT_HOOKS } from './payment-hooks'
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
