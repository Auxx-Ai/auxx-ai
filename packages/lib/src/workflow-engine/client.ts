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

// ── Node catalog (Phase 1 of the node-catalog migration) ─────────────────────
// The server-safe node contract: manifest types, the registry, the migration
// tracker, and the pure variable-inference helpers split out of apps/web
// utils/variable-utils.ts (the store-reading display helpers stayed there).
// NOTE: `catalog/build-output-context` and `catalog/resolve-outputs` are
// SERVER-ONLY (they import the org cache, which pulls in bullmq) and must
// never be exported here — import them via their own subpaths instead.
// NOTE: `catalog/derive-trigger-server` (the composition resolving
// `triggerInstallationId`) is SERVER-ONLY for the same reason — import it
// via a relative path (lib) or its own subpath, never from here.
export {
  type DerivedTriggerColumns,
  type DerivedTriggerLinks,
  deriveTriggerColumns,
  deriveTriggerLinks,
  type TriggerDerivationNode,
} from './catalog/derive-trigger'
export {
  buildDownstreamMap,
  buildUpstreamMap,
  computeLoopAncestry,
  type EdgeMeta,
  type GraphLoopContext,
  type NodeMeta,
  topologicalSort,
} from './catalog/graph-vars'
export {
  type BaseNodeData as CatalogBaseNodeData,
  type BranchType,
  baseNodeDataSchema,
  ErrorHandleType,
  type NodeConnectionMetadata,
  type NodeLoopContext,
  type NodeRuntimeState,
  type TargetBranch,
  type WorkflowRetryConfig,
} from './catalog/node-base'
export {
  type AiCompletionParams,
  type AiFiles,
  type AiModel,
  AiModelMode,
  AiModelProvider,
  type AiNodeData as CatalogAiNodeData,
  aiManifest,
  aiNodeDataSchema,
  completionParamsSchema,
  EMPTY_PROMPT_DOC,
  extractAIVariableIds,
  PromptRole,
  type PromptTemplate,
  type StructuredOutputConfig,
  structuredOutputSchema,
  validateAiData,
} from './catalog/nodes/ai'
export {
  type AnswerNodeData as CatalogAnswerNodeData,
  answerManifest,
  answerNodeDataSchema,
  extractAnswerVariables,
  validateAnswerConfig,
} from './catalog/nodes/answer'
export {
  type CodeNodeData as CatalogCodeNodeData,
  type CodeNodeInput,
  type CodeNodeOutput,
  type CodeOutput,
  type CodeVariable,
  codeManifest,
  codeNodeDataSchema,
  extractCodeVariables,
  normalizeCodeOutputType,
  validateCodeConfig,
} from './catalog/nodes/code'
export {
  type CrudDefaultValue,
  CrudErrorStrategy,
  type CrudNodeData as CatalogCrudNodeData,
  createCrudNodeDefaultData,
  crudManifest,
  crudNodeDataSchema,
  extractCrudVariables,
  getCrudNodeOutputVariables,
  validateCrudNodeConfig,
} from './catalog/nodes/crud'
export {
  DateFormatType,
  type DateTimeNodeData as CatalogDateTimeNodeData,
  DateTimeOperation,
  dateTimeManifest,
  dateTimeNodeSchema,
  extractDateTimeNodeVariables,
  ParseDateFormatType,
  TimeUnit,
  validateDateTimeNodeData,
} from './catalog/nodes/date-time'
export {
  type EndNodeData as CatalogEndNodeData,
  endManifest,
  endNodeDataSchema,
  extractEndVariables,
  validateEndConfig,
} from './catalog/nodes/end'
export {
  createFindNodeDefaultData,
  extractFindVariables,
  type FindNodeData as CatalogFindNodeData,
  findManifest,
  findNodeDataSchema,
  getFindNodeOutputVariables,
  validateFindNodeConfig,
} from './catalog/nodes/find'
export {
  computeFormatOutputVariables,
  extractFormatVariables,
  type FormatNodeData as CatalogFormatNodeData,
  formatManifest,
  formatNodeSchema,
  validateFormatNodeData,
} from './catalog/nodes/format'
export {
  type Authorization,
  AuthType,
  type Body,
  type BodyPayload,
  type BodyPayloadItem,
  BodyPayloadValueType,
  BodyType,
  type DefaultValueItem,
  ErrorStrategy,
  extractHttpVariableIds,
  getHttpOutputVariables,
  type HttpNodeData as CatalogHttpNodeData,
  httpManifest,
  httpNodeDataSchema,
  type KeyValue,
  Method,
  type RetryConfig as HttpRetryConfig,
  type Timeout as HttpTimeout,
  type ValueSelector,
  validateHttpNodeData,
} from './catalog/nodes/http'
export {
  type HumanConfirmationNodeData as CatalogHumanConfirmationNodeData,
  humanConfirmationManifest,
  humanConfirmationNodeDataSchema,
  validateHumanConfirmationConfig,
} from './catalog/nodes/human'
export {
  branchNameCorrect,
  extractIfElseVariableIds,
  type IfElseCondition,
  type IfElseNodeData as CatalogIfElseNodeData,
  ifElseManifest,
  ifElseNodeDataSchema,
  type NodeCase,
  type NodeCondition,
  validateIfElseConfig,
} from './catalog/nodes/if-else'
export {
  createInformationExtractorDefaultData,
  extractInformationExtractorVariables,
  type InformationExtractorInstruction,
  type InformationExtractorModel,
  type InformationExtractorNodeData as CatalogInformationExtractorNodeData,
  type InformationExtractorVision,
  informationExtractorManifest,
  informationExtractorSchema,
  validateInformationExtractor,
} from './catalog/nodes/information-extractor'
export {
  extractKnowledgeRetrievalVariables,
  getKnowledgeRetrievalOutputVariables,
  KNOWLEDGE_RETRIEVAL_MAX_LIMIT,
  KNOWLEDGE_SEARCH_TYPES,
  type KnowledgeRetrievalNodeData as CatalogKnowledgeRetrievalNodeData,
  type KnowledgeSearchType,
  type KnowledgeSourceRow,
  knowledgeRetrievalDefaultData,
  knowledgeRetrievalManifest,
  knowledgeRetrievalNodeDataSchema,
  sourceFieldKey,
  sourceRawId,
  validateKnowledgeRetrievalConfig,
} from './catalog/nodes/knowledge-retrieval'
export {
  CONFIG_KEY_BY_OPERATION,
  computeListOutputVariables,
  extractListVariables,
  type FilterConfig,
  type JoinConfig,
  type JoinType,
  type ListNodeData as CatalogListNodeData,
  type ListOperation,
  listManifest,
  listNodeDataSchema,
  type NullHandling,
  type PluckConfig,
  type SliceConfig,
  type SliceMode,
  type SortConfig,
  type SortDirection,
  type UniqueBy,
  type UniqueConfig,
  validateListNodeData,
} from './catalog/nodes/list'
export {
  extractLoopVariables,
  LOOP_CONSTANTS,
  LOOP_HANDLES,
  type LoopNodeData as CatalogLoopNodeData,
  loopConfigSchema,
  loopManifest,
  validateLoop,
} from './catalog/nodes/loop'
export {
  type ManualNodeData as CatalogManualNodeData,
  manualManifest,
  manualNodeDataSchema,
  validateManualData,
} from './catalog/nodes/manual'
export {
  type MessageReceivedNodeData as CatalogMessageReceivedNodeData,
  messageReceivedManifest,
  messageReceivedNodeDataSchema,
  UNSCOPED_MESSAGE_TRIGGER_WARNING,
  validateMessageReceivedConfig,
} from './catalog/nodes/message-received'
export {
  type NoteNodeData as CatalogNoteNodeData,
  type NoteTheme,
  noteManifest,
  noteNodeDataSchema,
  validateNoteConfig,
} from './catalog/nodes/note'
export {
  createResourceTriggerDefaultData,
  getResourceTriggerOutputVariables,
  type ResourceTriggerData as CatalogResourceTriggerData,
  resourceTriggerManifest,
  resourceTriggerNodeDataSchema,
  validateResourceTriggerConfig,
} from './catalog/nodes/resource-trigger'
export {
  extractScheduledTriggerVariables,
  type ScheduledTriggerNodeData as CatalogScheduledTriggerNodeData,
  type ScheduledTriggerUIConfig,
  scheduledTriggerManifest,
  scheduledTriggerNodeDataSchema,
  scheduledTriggerUIConfigSchema,
  validateScheduledTriggerData,
} from './catalog/nodes/scheduled'
export {
  type Category as TextClassifierCategory,
  type ClassificationResult,
  type CompletionParams as TextClassifierCompletionParams,
  extractTextClassifierVariables,
  type InstructionConfig as TextClassifierInstructionConfig,
  type ModelConfig as TextClassifierModelConfig,
  type TextClassifierNodeData as CatalogTextClassifierNodeData,
  type TextClassifierOutputMode,
  textClassifierManifest,
  textClassifierSchema,
  type VisionConfig as TextClassifierVisionConfig,
  validateTextClassifierData,
} from './catalog/nodes/text-classifier'
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
export { NOT_YET_MIGRATED } from './catalog/not-yet-migrated'
export {
  type OutputContext,
  type OutputResolver,
  staticOutputContext,
} from './catalog/output-context'
export {
  getAuthorableManifests,
  getManifest,
  listManifests,
} from './catalog/registry'
export {
  extractSchemaPropertyPaths,
  generateSampleFromSchema,
  schemaRootToUnifiedVariables,
  schemaToUnifiedVariable,
  schemaTypeToBaseType,
  validateAgainstSchema,
} from './catalog/schema-to-variable'
export {
  type NodeAgentDocs,
  type NodeBranch,
  NodeCategory,
  type NodeConnectionRules,
  type NodeManifest,
  type NodeValidationResult,
} from './catalog/types'
export {
  assignVariableIds,
  cloneAndRewriteVariableIds,
} from './catalog/variable-cloning'
export {
  createNestedVariable,
  createUnifiedOutputVariable,
  deduplicateVariables,
  isNavigableVariable,
} from './catalog/variable-conversion'
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
  resolveFieldPath,
  setSegmentAccessor,
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
