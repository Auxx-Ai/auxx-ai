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
// Core types and enums
export {
  BASE_TYPE_GROUPS,
  BaseType,
  isResourceTriggerType,
  type NodeExecutionResult,
  NodeRunningStatus,
  RESOURCE_OPERATION_TO_TRIGGER_TYPE,
  type ResourceTriggerOperation,
  TEST_RECORD_ID,
  TRIGGER_NAME_MAP,
  type ValidationResult,
  type Workflow,
  type WorkflowEdge,
  type WorkflowExecutionOptions,
  type WorkflowExecutionResult,
  WorkflowExecutionStatus,
  type WorkflowNode,
  WorkflowNodeType,
  type WorkflowTriggerEvent,
  WorkflowTriggerType,
} from './core/types'
// The one rule for telling a variable reference from a literal. The builder's
// dependency extraction and the engine's field resolution must draw that line in
// exactly the same place, or a picker-bound field declares no dependency on
// either side and the parity suite cannot see the gap.
export {
  BARE_VARIABLE_PATH_PATTERN,
  extractVariableRefs,
  isBareVariablePath,
  isVariableTemplate,
} from './nodes/utils/variable-refs'
// Input mode utilities - for workflow variable inputs
export { type InputConfig, InputMode, resolveInputConfig } from './operators/input-modes'
// Operators (Type-Operator Map) - for BaseType lookups in workflow variables
export {
  getOperatorsForType,
  isValidOperatorForType,
  TYPE_OPERATOR_MAP,
} from './operators/type-operator-map'
// Shared event types
export { WorkflowEventType } from './shared/types'
// Content segment types (for end node rich content)
export type {
  ContentSegment,
  FileArrayContentSegment,
  FileContentSegment,
  TextContentSegment,
} from './types/content-segment'
// File variable types
export type { WorkflowFileData } from './types/file-variable'
export { getDefaultValueForType } from './utils/default-values'
export * from './utils/serialization'
export * from './utils/terminal-nodes'

// NOTE: Operator definitions moved to @auxx/lib/conditions
// Import OPERATOR_DEFINITIONS, Operator, etc. from '@auxx/lib/conditions' or '@auxx/lib/conditions/client'

export {
  type BaseNodeData as CatalogBaseNodeData,
  baseNodeDataSchema,
  ErrorHandleType,
  type NodeConnectionMetadata,
  type NodeLoopContext,
  type NodeRuntimeState,
  type WorkflowRetryConfig,
} from './catalog/node-base'
export {
  type EndNodeData as CatalogEndNodeData,
  endManifest,
  endNodeDataSchema,
  extractEndVariables,
  validateEndConfig,
} from './catalog/nodes/end'
export {
  type NoteNodeData as CatalogNoteNodeData,
  type NoteTheme,
  noteManifest,
  noteNodeDataSchema,
  validateNoteConfig,
} from './catalog/nodes/note'
export {
  extractVarAssignVariables,
  type VarAssignNodeData as CatalogVarAssignNodeData,
  type VariableAssignment,
  validateVarAssign,
  varAssignManifest,
  varAssignNodeDataSchema,
} from './catalog/nodes/var-assign'
export {
  DurationUnit,
  validateWaitConfig,
  type WaitNodeData as CatalogWaitNodeData,
  WaitType,
  waitManifest,
  waitNodeDataSchema,
} from './catalog/nodes/wait'
// ── Node catalog (Phase 1 of the node-catalog migration) ─────────────────────
// The server-safe node contract: manifest types, the registry, the migration
// tracker, and the pure variable-inference helpers split out of apps/web
// utils/variable-utils.ts (the store-reading display helpers stayed there).
export { NOT_YET_MIGRATED } from './catalog/not-yet-migrated'
export {
  getAuthorableManifests,
  getManifest,
  listManifests,
} from './catalog/registry'
export {
  type NodeAgentDocs,
  type NodeBranch,
  NodeCategory,
  type NodeConnectionRules,
  type NodeManifest,
  type NodeValidationResult,
} from './catalog/types'
export {
  type ArraySegmentInfo,
  buildVariableId,
  buildVariableLabelPath,
  containsVariableReference,
  extractVarIdsFromString,
  getArrayAccessorCompactLabel,
  getArrayAccessorMenuLabel,
  getArrayItemVariable,
  getLabelFromVariableId,
  getNodeIdFromVariableId,
  getPathFromVariableId,
  inferPluckOutputType,
  isEnvironmentVariable,
  isNodeVariable,
  isSystemVariable,
  isVariableMode,
  parseArraySegmentsFromId,
  parseResourceFieldFromVariableId,
  preserveArrayStructure,
  replaceArrayAccessor,
  resolveFieldPath,
  VARIABLE_PATTERN,
} from './catalog/variable-inference'
export type {
  AllowedVarType,
  UnifiedVariable,
  ValidationRules,
} from './types/unified-variable'
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
