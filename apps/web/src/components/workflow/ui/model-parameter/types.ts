// apps/web/src/components/workflow/ui/model-parameter/types.ts

// Import clean types from consolidated architecture
import type { ModelData, ParameterRule, ProviderData } from '@auxx/lib/ai/providers/types'

// Keep TypeWithI18N for legacy compatibility but prefer simple strings
export type TypeWithI18N<T = string> = { en_US: T; [key: string]: T }

export type FormValue = Record<string, any>

export enum ModelTypeEnum {
  textGeneration = 'llm',
  textEmbedding = 'text-embedding',
  rerank = 'rerank',
  speech2text = 'speech2text',
  moderation = 'moderation',
  tts = 'tts',
}

export const MODEL_TYPE_TEXT = {
  [ModelTypeEnum.textGeneration]: 'LLM',
  [ModelTypeEnum.textEmbedding]: 'Text Embedding',
  [ModelTypeEnum.rerank]: 'Rerank',
  [ModelTypeEnum.speech2text]: 'Speech2text',
  [ModelTypeEnum.moderation]: 'Moderation',
  [ModelTypeEnum.tts]: 'TTS',
}

export enum ConfigurationMethodEnum {
  predefinedModel = 'predefined-model',
  customizableModel = 'customizable-model',
  fetchFromRemote = 'fetch-from-remote',
}

export enum ModelFeatureEnum {
  toolCall = 'tool-call',
  multiToolCall = 'multi-tool-call',
  agentThought = 'agent-thought',
  streamToolCall = 'stream-tool-call',
  vision = 'vision',
  video = 'video',
  document = 'document',
  audio = 'audio',
  StructuredOutput = 'structured-output',
}

export enum ModelStatusEnum {
  active = 'active',
  noConfigure = 'no-configure',
  quotaExceeded = 'quota-exceeded',
  noPermission = 'no-permission',
  disabled = 'disabled',
}

export const MODEL_STATUS_TEXT: { [k: string]: TypeWithI18N } = {
  'no-configure': { en_US: 'No Configure' },
  'quota-exceeded': { en_US: 'Quota Exceeded' },
  'no-permission': { en_US: 'No Permission' },
  disabled: { en_US: 'Disabled' },
}

// export enum CustomConfigurationStatusEnum {
//   active = 'active',
//   noConfigure = 'no-configure',
// }

// export type ModelItem = {
//   model: string
//   label: TypeWithI18N
//   modelType: ModelTypeEnum
//   features?: ModelFeatureEnum[]
//   fetchFrom: ConfigurationMethodEnum
//   status: ModelStatusEnum
//   modelProperties: Record<string, string | number>
//   loadBalancingEnabled: boolean
//   deprecated?: boolean
// }

// export type ModelProvider = {
//   provider: string
//   label: TypeWithI18N
//   description?: TypeWithI18N
//   supportedModelTypes: ModelTypeEnum[]
// }

// export type Model = {
//   provider: string
//   label: TypeWithI18N
//   models: ModelItem[]
//   status: ModelStatusEnum
// }

export type DefaultModel = { provider: string; model: string }

export type ModelParameterRule = ParameterRule

// Legacy compatibility for complex parameter rules
export type LegacyModelParameterRule = {
  default?: number | string | boolean | string[]
  help?: TypeWithI18N | string
  label: TypeWithI18N | string
  min?: number
  max?: number
  name: string
  precision?: number
  required: boolean
  type: string
  use_template?: string
  options?: string[]
  tagPlaceholder?: TypeWithI18N | string
}

export type ParameterValue = number | string | string[] | boolean | undefined

// Component prop types - Updated to use new ModelData architecture
export type TriggerProps = {
  open?: boolean
  disabled?: boolean
  currentProvider?: ProviderData | { provider: string; label: string }
  currentModel?: ModelData
  providerName?: string
  modelId?: string
  hasDeprecated?: boolean
  modelDisabled?: boolean
  isInWorkflow?: boolean
}

export type ModelParameterModalProps = {
  popupClassName?: string
  isAdvancedMode: boolean
  mode: string
  modelId: string
  provider: string
  setModel: (model: {
    modelId: string
    provider: string
    mode?: string
    features?: string[]
  }) => void
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
  hideDebugWithMultipleModel?: boolean
  debugWithMultipleModel?: boolean
  onDebugWithMultipleModelChange?: () => void
  renderTrigger?: (v: TriggerProps) => React.ReactNode
  readonly?: boolean
  isInWorkflow?: boolean
  scope?: string
  /** Which ModelType to use for auto-populating the org's system default. */
  defaultModelType?: ModelTypeEnum
  /** When true, the node uses the org's default model resolved at execution time. */
  useDefault?: boolean
  /** Callback to toggle useDefault on/off. */
  onUseDefaultChange?: (useDefault: boolean) => void
}

// export type AgentModelTriggerProps = {
//   open?: boolean
//   disabled?: boolean
//   currentProvider?: ModelProvider
//   currentModel?: ModelItem
//   providerName?: string
//   modelId?: string
//   hasDeprecated?: boolean
//   scope?: string
// }

export type ParameterItemProps = {
  parameterRule: ModelParameterRule | LegacyModelParameterRule
  value?: ParameterValue
  onChange?: (value: ParameterValue) => void
  onSwitch?: (checked: boolean, assignValue: ParameterValue) => void
  isInWorkflow?: boolean
  disabled?: boolean
}

// Re-export new types for easier migration
export type { ModelData, ProviderData } from '@auxx/lib/ai/providers/types'

// Legacy type aliases for backwards compatibility
export type ModelItem = ModelData
export type ModelProvider = ProviderData
export type Model = ProviderData

export type PresetsParameterProps = { onSelect: (toneId: number) => void }
