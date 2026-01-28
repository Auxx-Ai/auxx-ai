// packages/lib/src/workflow-engine/client.ts

// Client-safe workflow-engine exports for UI usage
// Re-export only pure utilities and data definitions (no server/queue/redis deps)

export * from './utils/terminal-nodes'
export * from '../resources/definitions'
export * from '../resources/find-definitions'
export * from '../resources/variable-generators'
export * from './utils/serialization'
export { getDefaultValueForType } from './utils/default-values'

// Registry exports (Phase 1: Single source of truth for field definitions)
// Import from client.ts to avoid server-side code in barrel exports
export * from '../resources/client'

// CRUD resource configurations (Phase 3: CRUD node refactor)
export * from '../resources/crud-definitions'

export { RESOURCE_TABLE_MAP, RESOURCE_FIELD_REGISTRY } from '../resources/registry/field-registry'

// Core types
export { BaseType, WorkflowTriggerType, TRIGGER_NAME_MAP } from './core/types'

// Operators (Type-Operator Map) - for BaseType lookups in workflow variables
export {
  TYPE_OPERATOR_MAP,
  getOperatorsForType,
  isValidOperatorForType,
} from './operators/type-operator-map'

// Input mode utilities - for workflow variable inputs
export { InputMode, resolveInputConfig, type InputConfig } from './operators/input-modes'

// NOTE: Operator definitions moved to @auxx/lib/conditions
// Import OPERATOR_DEFINITIONS, Operator, etc. from '@auxx/lib/conditions' or '@auxx/lib/conditions/client'

// Type compatibility utilities
export { isTypeCompatible, getCompatibleTypes } from './utils/type-compatibility'

// Field type mapping utilities
export {
  mapFieldTypeToBaseType,
  mapBaseTypeToFieldType,
  fieldTypeNeedsEnumOptions,
  fieldTypeIsRelationship,
  extractEnumOptions,
} from './utils/field-type-mapper'
