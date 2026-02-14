// apps/web/src/components/workflow/nodes/core/text-classifier/types.ts

import type { TargetBranch } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Text Classifier node data interface - flattened structure
 */
export interface TextClassifierNodeData extends BaseNodeData {
  model: ModelConfig
  text: string // Preprocessed text
  categories: Category[]
  vision: VisionConfig
  instruction: InstructionConfig
  _targetBranches?: TargetBranch[]
}

/**
 * Full Text Classifier node type for React Flow
 */
export type TextClassifierNode = SpecificNode<'text-classifier', TextClassifierNodeData>

/**
 * Model mode enum (reusing from AI node pattern)
 */
export enum AiModelMode {
  CHAT = 'chat',
  COMPLETION = 'completion',
}

/**
 * Model configuration interface
 */
export interface ModelConfig {
  provider: string
  name: string
  mode: AiModelMode
  completion_params?: CompletionParams
}

/**
 * Completion parameters interface
 */
export interface CompletionParams {
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

/**
 * Category interface for classification
 */
export interface Category {
  id: string
  name: string
  description?: string // Preprocessed text with {{variables}}
  text: string
  // editorContent?: string        // Tiptap JSON content
}

/**
 * Vision configuration interface
 */
export interface VisionConfig {
  enabled: boolean
}

/**
 * Instruction configuration interface
 */
export interface InstructionConfig {
  enabled: boolean
  text: string // Preprocessed text
  // editorContent?: string // Tiptap JSON content
}

/**
 * Classification result interface (for backend processing)
 */
export interface ClassificationResult {
  category: string
  confidence: number
  reasoning: string
}
