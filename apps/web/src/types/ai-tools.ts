// apps/web/src/types/ai-tools.ts

/**
 * Re-export only frontend-safe types from the lib package
 * This ensures no backend service code leaks to the frontend
 */

// Type-only imports for safety
export type {
  AIComposeRequest,
  AIComposeResponse,
  AILangType,
  AIOperation,
  AIToneType,
  ComposeEntityType,
  OutputFormat,
} from '@auxx/lib/ai-features/compose/types'

// Import const values safely
export {
  AI_LANG_TYPE,
  AI_LANG_TYPE_VALUES,
  AI_OPERATION,
  // Also export the VALUE versions for easier access
  AI_OPERATION_VALUES,
  AI_TONE_TYPE,
  AI_TONE_TYPE_VALUES,
  COMPOSE_ENTITY_TYPE,
  COMPOSE_ENTITY_TYPE_VALUES,
  OUTPUT_FORMAT,
  OUTPUT_FORMAT_VALUES,
} from '@auxx/lib/ai-features/compose/types'
