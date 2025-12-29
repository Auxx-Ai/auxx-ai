// packages/lib/src/ai-features/compose/index.ts

// Export service
export { AIComposeService, getAIComposeService } from './ai-compose.service'

// Export types - Frontend safe exports
export type {
  AIOperation,
  AIToneType,
  AILangType,
  OutputFormat,
  ComposeEntityType,
  AIComposeRequest,
  AIComposeResponse
} from './types'

// Export const values for frontend use
export {
  AI_OPERATION,
  AI_TONE_TYPE,
  AI_LANG_TYPE,
  OUTPUT_FORMAT,
  COMPOSE_ENTITY_TYPE,
  AI_OPERATION_VALUES,
  AI_TONE_TYPE_VALUES,
  AI_LANG_TYPE_VALUES,
  OUTPUT_FORMAT_VALUES,
  COMPOSE_ENTITY_TYPE_VALUES
} from './types'

// Export errors
export {
  AIComposeError,
  ValidationError,
  ContextError,
  QuotaExceededError,
  ProviderError
} from './errors'