// packages/lib/src/workflow-engine/client.ts

// Client-safe workflow-engine exports for UI usage
// Re-export only pure utilities and data definitions (no server/queue/redis deps)

// Registry exports (Phase 1: Single source of truth for field definitions)
// Import from client.ts to avoid server-side code in barrel exports
export * from '../resources/client'
// CRUD resource configurations (Phase 3: CRUD node refactor)
export * from '../resources/crud-definitions'
export * from '../resources/definitions'
export * from '../resources/find-definitions'
export { RESOURCE_FIELD_REGISTRY, RESOURCE_TABLE_MAP } from '../resources/registry/field-registry'
export * from '../resources/variable-generators'
// Core types
export { BaseType, TRIGGER_NAME_MAP, WorkflowTriggerType } from './core/types'
// Input mode utilities - for workflow variable inputs
export { type InputConfig, InputMode, resolveInputConfig } from './operators/input-modes'
// Operators (Type-Operator Map) - for BaseType lookups in workflow variables
export {
  getOperatorsForType,
  isValidOperatorForType,
  TYPE_OPERATOR_MAP,
} from './operators/type-operator-map'
export { getDefaultValueForType } from './utils/default-values'
export * from './utils/serialization'
export * from './utils/terminal-nodes'

// NOTE: Operator definitions moved to @auxx/lib/conditions
// Import OPERATOR_DEFINITIONS, Operator, etc. from '@auxx/lib/conditions' or '@auxx/lib/conditions/client'

// Field type mapping utilities
export {
  extractEnumOptions,
  fieldTypeIsRelationship,
  fieldTypeNeedsEnumOptions,
  mapBaseTypeToFieldType,
  mapFieldTypeToBaseType,
} from './utils/field-type-mapper'
// Type compatibility utilities
export { getCompatibleTypes, isTypeCompatible } from './utils/type-compatibility'
