// packages/sdk/src/root/index.ts

/**
 * Auxx Root SDK
 *
 * This module provides type definitions for the main app structure.
 * Use these types when defining your app's entry point.
 */

export type {
  BulkRecordAction,
  RecordAction,
  RecordActionContext,
} from '../client/record-actions.js'
export type {
  TriggerContext,
  WorkflowContext,
  WorkflowInput,
  WorkflowOutput,
} from '../server/workflow/index.js'
// Scope→capability helpers — `import { resolveCapabilities } from '@auxx/sdk'`.
// Deliberately on the ROOT surface, not `/server`: `/server` is externalized to the injected
// `AUXX_SERVER_SDK` global and would need a hand-mirrored copy in the lambda runtime, whereas
// the root SDK is injected from the real module. See shared/scopes.ts.
export { parseScopeString, resolveCapabilities } from '../shared/scopes.js'
export type { App, AppSettings, Permission } from './app.js'
export type {
  ConnectorConnection,
  ConnectorConnectionField,
  ConnectorContributingFieldSourceOnly,
  ConnectorContributingFieldToAppField,
  ConnectorContributingFieldToTarget,
  ConnectorContributingMappingField,
  ConnectorExecute,
  ConnectorExecuteArgs,
  ConnectorFetchResult,
  ConnectorMapping,
  ConnectorOwnedMappingField,
  ConnectorRecord,
  ConnectorStreamDecl,
  ConnectorStreamState,
  ContributingConnectorMapping,
  DataConnectorDefinition,
  FieldMergeStrategy,
  OwnedConnectorMapping,
} from './data-connectors/index.js'
// Data Connectors surface — `import { defineDataConnector } from '@auxx/sdk/data-connectors'`
export { defineDataConnector } from './data-connectors/index.js'
// Entities surface — `import { defineEntity } from '@auxx/sdk/entities'`
export { defineEntity, type EntityDecl } from './entities/index.js'
// Fields surface — `import { defineField, defineFields } from '@auxx/sdk/fields'`
export {
  type AppFieldDefinition,
  type AppFieldValues,
  defineField,
  defineFields,
  FIELD_TYPES,
  type FieldCapabilities,
  type FieldDecl,
  type FieldScope,
  type FieldSelectOption,
  type FieldType,
  type FieldTypeValueMap,
  type FieldValueType,
} from './fields/index.js'
export { Settings } from './settings/index.js'
// Export settings schema types and namespace
export type {
  BaseSettingOptions,
  BooleanSettingOptions,
  NumberSettingOptions,
  SelectSettingOptions,
  SettingsBooleanNode,
  SettingsNode,
  SettingsNumberNode,
  SettingsSchema,
  SettingsSelectNode,
  SettingsStringNode,
  SettingsStructNode,
  StringSettingOptions,
  StructSettingOptions,
} from './settings/settings-schema.js'
export type {
  AuxxRefMeta,
  EntityRefKind,
  ToolActionContext,
  ToolActionEntity,
  ToolActionParticipant,
  ToolActionSurface,
  ToolAgentSurface,
  ToolConfig,
  ToolDefinition,
  ToolExecuteContext,
  Toolset,
} from './tools/index.js'
// Tools surface — `import { defineTool, refs, z } from '@auxx/sdk/tools'`
export { defineTool, refs, z } from './tools/index.js'
export type {
  ArrayInputOptions,
  BaseType,
  BaseWorkflowFieldOptions,
  BooleanInputOptions,
  Connection,
  InferFieldType,
  InferWorkflowInput,
  InferWorkflowOutput,
  NumberInputOptions,
  SelectInputOptions,
  SelectOption,
  // Input field options
  StringInputOptions,
  StructInputOptions,
  Trigger,
  TriggerAgentSurface,
  TriggerWorkflowSurface,
  WorkflowArrayNode,
  WorkflowBlock,
  WorkflowBlockConfig,
  WorkflowBooleanNode,
  WorkflowCategory,
  WorkflowExecuteContext,
  WorkflowExecuteFunction,
  WorkflowExecutionContext,
  WorkflowFieldNode,
  // Node classes (for advanced usage)
  WorkflowNode,
  WorkflowNodeProps,
  WorkflowNumberNode,
  WorkflowOrganization,
  WorkflowPanelProps,
  WorkflowSchema,
  WorkflowSDK,
  WorkflowSelectNode,
  WorkflowStringNode,
  WorkflowStructNode,
  WorkflowUser,
} from './workflow/index.js'
// Export workflow namespace and types
export { defineTrigger, Workflow } from './workflow/index.js'
