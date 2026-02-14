// packages/lib/src/resources/hooks/index.ts

export { autoSetCreatedBy, COMMON_HOOKS } from './common-hooks'
export { CONTACT_HOOKS } from './contact-hooks'
export {
  getCommonHooks,
  getHooksForAttribute,
  getSystemHooks,
  hasSystemHooks,
} from './system-hooks'
export { TICKET_HOOKS } from './ticket-hooks'
export type { SystemHook, SystemHookContext, SystemHookRegistry } from './types'
