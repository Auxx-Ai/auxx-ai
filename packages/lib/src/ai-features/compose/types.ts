// packages/lib/src/ai-features/compose/types.ts

/**
 * AI Operations using const assertion for type safety
 */
export const AI_OPERATION = {
  COMPOSE: 'compose',
  TONE: 'tone',
  TRANSLATE: 'translate',
  FIX_GRAMMAR: 'fix_grammar',
  EXPAND: 'expand',
  SHORTEN: 'shorten'
} as const

export type AIOperation = (typeof AI_OPERATION)[keyof typeof AI_OPERATION]

/**
 * Tone types using const assertion
 */
export const AI_TONE_TYPE = {
  PROFESSIONAL: 'Professional',
  FRIENDLY: 'Friendly',
  EMPATHETIC: 'Empathetic'
} as const

export type AIToneType = (typeof AI_TONE_TYPE)[keyof typeof AI_TONE_TYPE]

/**
 * Language types using const assertion
 */
export const AI_LANG_TYPE = {
  CHINESE_SIMPLIFIED: 'Chinese (Simplified)',
  CHINESE_TRADITIONAL: 'Chinese (Traditional)',
  DANISH: 'Danish',
  DUTCH: 'Dutch',
  ENGLISH: 'English',
  FINNISH: 'Finnish',
  FRENCH: 'French',
  GERMAN: 'German',
  ITALIAN: 'Italian',
  JAPANESE: 'Japanese',
  KOREAN: 'Korean',
  POLISH: 'Polish',
  PORTUGUESE: 'Portuguese',
  ROMANIAN: 'Romanian',
  RUSSIAN: 'Russian',
  SPANISH: 'Spanish',
  SWEDISH: 'Swedish',
  TURKISH: 'Turkish'
} as const

export type AILangType = (typeof AI_LANG_TYPE)[keyof typeof AI_LANG_TYPE]

/**
 * Output format using const assertion
 */
export const OUTPUT_FORMAT = {
  EDITOR: 'editor',
  RAW: 'raw',
  HTML: 'html'
} as const

export type OutputFormat = (typeof OUTPUT_FORMAT)[keyof typeof OUTPUT_FORMAT]

/**
 * Entity types using const assertion
 */
export const COMPOSE_ENTITY_TYPE = {
  THREAD: 'THREAD'
} as const

export type ComposeEntityType = (typeof COMPOSE_ENTITY_TYPE)[keyof typeof COMPOSE_ENTITY_TYPE]

/**
 * Request payload for AI compose operations
 */
export interface AIComposeRequest {
  operation: AIOperation
  messageHtml: string
  entityType: ComposeEntityType
  entityId?: string
  senderId: string
  tone?: AIToneType
  language?: AILangType | string
  output: OutputFormat
}

/**
 * Response from AI compose operations
 */
export interface AIComposeResponse {
  content: string
  format: OutputFormat
  operation: AIOperation
  metadata?: {
    tokensUsed?: number
    model?: string
    processingTime?: number
  }
}

// Export const values separately for frontend use
export const AI_OPERATION_VALUES = AI_OPERATION
export const AI_TONE_TYPE_VALUES = AI_TONE_TYPE
export const AI_LANG_TYPE_VALUES = AI_LANG_TYPE
export const OUTPUT_FORMAT_VALUES = OUTPUT_FORMAT
export const COMPOSE_ENTITY_TYPE_VALUES = COMPOSE_ENTITY_TYPE