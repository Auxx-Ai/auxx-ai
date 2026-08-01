// packages/lib/src/resources/query-builder/index.ts

// Base class and types
export {
  BaseConditionBuilder,
  type ConditionGroup,
  type ConditionQueryResult,
  type DroppedCondition,
  type DroppedConditionReason,
  type GenericCondition,
  type ValidationResult,
} from './base-condition-builder'
// System field-reference canonicalization (runs before the system builder)
export {
  canonicalizeSystemConditions,
  canonicalizeSystemFieldRef,
} from './canonicalize-system-fields'
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
