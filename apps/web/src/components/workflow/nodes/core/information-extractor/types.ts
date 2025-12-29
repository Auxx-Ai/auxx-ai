// apps/web/src/components/workflow/nodes/core/information-extractor/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types'
import type { UnifiedVariable } from '../if-else'
import type { SchemaRoot } from '~/components/workflow/ui/structured-output-generator/types'

/**
 * Structured output configuration
 */
export interface StructuredOutputConfig {
  enabled: boolean
  schema?: SchemaRoot
}

/**
 * Model configuration
 */
export interface InformationExtractorModel {
  provider: string
  name: string
  mode: 'chat' | 'completion'
  completion_params?: {
    temperature: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
  }
}

/**
 * Vision configuration
 */
export interface InformationExtractorVision {
  enabled: boolean
}

/**
 * Instruction configuration
 */
export interface InformationExtractorInstruction {
  enabled: boolean
  text: string
  // editorContent?: string
}

/**
 * Node data interface - flattened structure
 */
export interface InformationExtractorNodeData extends BaseNodeData {
  model: InformationExtractorModel
  text: string // Preprocessed text with variables
  // textEditorContent?: string // Tiptap JSON content
  structured_output: StructuredOutputConfig
  vision: InformationExtractorVision
  instruction: InformationExtractorInstruction
}

/**
 * Full Information Extractor node type for React Flow
 */
export type InformationExtractorNode = SpecificNode<
  'information-extractor',
  InformationExtractorNodeData
>

/**
 * Context value interface for React Context
 */
export interface InformationExtractorContextValue {
  // State
  config: InformationExtractorNodeData
  availableVariables: Array<{ name: string; type: string; nodeId: string }>
  isReadOnly: boolean
  schema: SchemaRoot | undefined

  // Actions
  updateTitle: (title: string) => void
  updateDescription: (desc: string) => void
  updateModel: (model: InformationExtractorModel) => void
  updateText: (text: string) => void
  updateStructuredOutput: (enabled: boolean, schema?: SchemaRoot) => void

  // Advanced settings
  updateVision: (enabled: boolean) => void
  updateInstruction: (enabled: boolean, text?: string) => void

  // Utilities
  preprocessPrompt: (editorContent: string) => { text: string; variables: string[] }
  getOutputVariables: () => UnifiedVariable[]
}
