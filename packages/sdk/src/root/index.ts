// packages/sdk/src/root/index.ts

/**
 * Auxx Root SDK
 *
 * This module provides type definitions for the main app structure.
 * Use these types when defining your app's entry point.
 */

export type { App, AppSettings, Permission } from './app.js'

// Export settings schema types and namespace
export type { SettingsSchema } from './settings/settings-schema.js'
export { Settings } from './settings/index.js'
export type {
  StringSettingOptions,
  NumberSettingOptions,
  BooleanSettingOptions,
  SelectSettingOptions,
  StructSettingOptions,
  BaseSettingOptions,
  SettingsNode,
  SettingsStringNode,
  SettingsNumberNode,
  SettingsBooleanNode,
  SettingsSelectNode,
  SettingsStructNode,
} from './settings/settings-schema.js'

// Export workflow namespace and types
export { Workflow } from './workflow/index.js'
export type {
  WorkflowBlock,
  WorkflowTrigger,
  WorkflowSchema,
  WorkflowExecutionContext,
  WorkflowExecuteFunction,
  WorkflowCategory,
  WorkflowBlockConfig,
  WorkflowNodeProps,
  WorkflowPanelProps,
  WorkflowUser,
  WorkflowOrganization,
  WorkflowSDK,
  Connection,
  BaseType,
  InferWorkflowInput,
  InferWorkflowOutput,
  InferFieldType,
  // Input field options
  StringInputOptions,
  NumberInputOptions,
  BooleanInputOptions,
  SelectInputOptions,
  ArrayInputOptions,
  StructInputOptions,
  SelectOption,
  BaseWorkflowFieldOptions,
  // Node classes (for advanced usage)
  WorkflowNode,
  WorkflowStringNode,
  WorkflowNumberNode,
  WorkflowBooleanNode,
  WorkflowSelectNode,
  WorkflowArrayNode,
  WorkflowStructNode,
  WorkflowFieldNode,
} from './workflow/index.js'

export type {
  RecordAction,
  RecordActionContext,
  BulkRecordAction,
} from '../client/record-actions.js'
export type {
  WorkflowContext,
  TriggerContext,
  WorkflowInput,
  WorkflowOutput,
} from '../server/workflow/index.js'
