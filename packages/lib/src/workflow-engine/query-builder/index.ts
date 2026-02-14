// packages/lib/src/workflow-engine/query-builder/index.ts

// Base class and types
export {
  BaseConditionBuilder,
  type ConditionGroup,
  type GenericCondition,
  type ValidationResult,
} from './base-condition-builder'
// Backward compatibility (deprecated)
export { ConditionQueryBuilder } from './condition-query-builder'

// Entity instance builder
export {
  EntityConditionBuilder,
  type EntityQueryContext,
  entityConditionBuilder,
} from './entity-condition-builder'
// System resource builder
export { SystemConditionBuilder, systemConditionBuilder } from './system-condition-builder'
