// packages/lib/src/ai-features/generator/types.ts

/** Type of content to generate */
export type GenerationType = 'prompt' | 'code'

/** Supported code languages */
export type CodeLanguage = 'javascript' | 'json'

/**
 * Input variable for code generation
 * Represents a function parameter in the main function
 */
export interface CodeGeneratorInput {
  name: string
  description?: string
}

/**
 * Output variable for code generation
 * Represents a key in the return object of the main function
 */
export interface CodeGeneratorOutput {
  name: string
  type: string // e.g., 'string', 'number', 'object', 'array', 'boolean'
  description?: string
}

/**
 * Request interface for content generation
 */
export interface AIGeneratorRequest {
  instruction: string
  generationType: GenerationType
  language?: CodeLanguage // Required for code generation
  currentContent?: string // Existing content to modify/improve
  idealOutput?: string
  modelId?: string
  // Code generation specific fields
  codeInputs?: CodeGeneratorInput[]
  codeOutputs?: CodeGeneratorOutput[]
}

/**
 * Response interface for content generation
 */
export interface AIGeneratorResponse {
  content: string
  metadata?: {
    tokensUsed?: number
    model?: string
    processingTime?: number
  }
}
