// packages/lib/src/agents/restrictions/index.ts

export { buildApplyToolRestrictions } from './apply'
export type {
  ArgRestriction,
  RestrictionSource,
  RestrictionVar,
  ToolRestrictionMap,
} from './client'
export { projectToolSchema, projectToolsSchemas } from './project-schema'
export {
  buildResolveVar,
  buildRestrictionVarRegistry,
  type VarRegistryOptions,
} from './var-registry'
