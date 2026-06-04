// packages/lib/src/ai/agent-framework/context/index.ts

export type {
  CapturedInvocation,
  ContextEntryDescriptor,
  ContextManager,
  ContextRef,
  ContextRefKind,
  SerializedContext,
} from './context-manager'
export { type ParsedRef, parseContextRef } from './context-ref'
export {
  CONTEXT_SLICE_KEY,
  KopilotContextStore,
  readContextSlice,
  syncContextSlice,
} from './context-store'
export { walkPath } from './path-walker'
export { buildFieldSource } from './sources/field-source'
export { createSysSource } from './sources/sys-source'
