// packages/lib/src/resources/hooks/index.ts

export { getSystemHooks, getHooksForAttribute, hasSystemHooks, getCommonHooks } from './system-hooks'
export { CONTACT_HOOKS } from './contact-hooks'
export { TICKET_HOOKS } from './ticket-hooks'
export { COMMON_HOOKS, autoSetCreatedBy } from './common-hooks'
export type { SystemHook, SystemHookContext, SystemHookRegistry } from './types'
