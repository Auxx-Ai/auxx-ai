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
export type { App, AppSettings, Permission } from './app.js'
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
  WorkflowArrayNode,
  WorkflowBlock,
  WorkflowBlockConfig,
  WorkflowBooleanNode,
  WorkflowCategory,
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
  WorkflowTrigger,
  WorkflowUser,
} from './workflow/index.js'
// Export workflow namespace and types
export { Workflow } from './workflow/index.js'
