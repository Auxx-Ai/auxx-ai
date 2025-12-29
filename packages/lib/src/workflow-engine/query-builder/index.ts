// packages/lib/src/workflow-engine/query-builder/index.ts

// Base class and types
export {
  BaseConditionBuilder,
  type GenericCondition,
  type ConditionGroup,
  type ValidationResult,
} from './base-condition-builder'

// System resource builder
export { SystemConditionBuilder, systemConditionBuilder } from './system-condition-builder'

// Entity instance builder
export {
  EntityConditionBuilder,
  entityConditionBuilder,
  type EntityQueryContext,
} from './entity-condition-builder'

// Backward compatibility (deprecated)
export { ConditionQueryBuilder } from './condition-query-builder'
