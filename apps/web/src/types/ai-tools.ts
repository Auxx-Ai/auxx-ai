// apps/web/src/types/ai-tools.ts

/**
 * Re-export only frontend-safe types from the lib package
 * This ensures no backend service code leaks to the frontend
 */

// Type-only imports for safety
export type {
  AIOperation,
  AIToneType,
  AILangType,
  OutputFormat,
  ComposeEntityType,
  AIComposeRequest,
  AIComposeResponse,
} from '@auxx/lib/ai-features/compose/types'

// Import const values safely
export {
  AI_OPERATION,
  AI_TONE_TYPE,
  AI_LANG_TYPE,
  OUTPUT_FORMAT,
  COMPOSE_ENTITY_TYPE,
  // Also export the VALUE versions for easier access
  AI_OPERATION_VALUES,
  AI_TONE_TYPE_VALUES,
  AI_LANG_TYPE_VALUES,
  OUTPUT_FORMAT_VALUES,
  COMPOSE_ENTITY_TYPE_VALUES,
} from '@auxx/lib/ai-features/compose/types'