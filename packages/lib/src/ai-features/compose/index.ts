// packages/lib/src/ai-features/compose/index.ts

// Export service
export { AIComposeService, getAIComposeService } from './ai-compose.service'
// Export errors
export {
  AIComposeError,
  ContextError,
  ProviderError,
  QuotaExceededError,
  ValidationError,
} from './errors'
// Export types - Frontend safe exports
export type {
  AIComposeRequest,
  AIComposeResponse,
  AILangType,
  AIOperation,
  AIToneType,
  ComposeEntityType,
  OutputFormat,
} from './types'
// Export const values for frontend use
export {
  AI_LANG_TYPE,
  AI_LANG_TYPE_VALUES,
  AI_OPERATION,
  AI_OPERATION_VALUES,
  AI_TONE_TYPE,
  AI_TONE_TYPE_VALUES,
  COMPOSE_ENTITY_TYPE,
  COMPOSE_ENTITY_TYPE_VALUES,
  OUTPUT_FORMAT,
  OUTPUT_FORMAT_VALUES,
} from './types'
