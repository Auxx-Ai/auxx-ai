// packages/lib/src/files/upload/processors/index.ts

import { createScopedLogger } from '@auxx/logger'
import { DatasetAssetProcessor } from './dataset'
import {
  ArticleProcessor,
  ChatWidgetProcessor,
  CommentProcessor,
  CustomFieldProcessor,
  KnowledgeBaseProcessor,
  MessageProcessor,
  UserProfileProcessor,
  WorkflowRunProcessor,
} from './entity-processors'
import { FileProcessor } from './file-processor'
import { ProcessorRegistry } from './processor-registry'
import { VisitQcItemProcessor } from './visit-qc-processor'

const logger = createScopedLogger('processors')

export * from '../init-types'
export * from '../util'
export * from './base-asset-processor'
export * from './base-processor'
export * from './dataset'
export * from './entity-processors'
export * from './processor-registry'
// Export all processors and types
export * from './types'
export * from './visit-qc-processor'
export * from './workflow-processor'

/**
 * Initialize and register all default processors using the simplified EntityType approach.
 *
 * Every value of `ENTITY_TYPES` must be registered here — there is no default processor, so an
 * unregistered type throws at the front door instead of silently producing a `FolderFile`
 * (`docs/files-upload-architecture-guide.md` §11.3). The
 * "registers a processor for every ENTITY_TYPES value" test is the guard.
 */
export function initializeProcessors(): void {
  // Register processors directly by EntityType
  ProcessorRegistry.registerForEntity('FILE', (orgId) => new FileProcessor(orgId))
  ProcessorRegistry.registerForEntity('DATASET', (orgId) => new DatasetAssetProcessor(orgId))
  ProcessorRegistry.registerForEntity('ARTICLE', (orgId) => new ArticleProcessor(orgId))
  ProcessorRegistry.registerForEntity('USER_PROFILE', (orgId) => new UserProfileProcessor(orgId))
  ProcessorRegistry.registerForEntity('WORKFLOW_RUN', (orgId) => new WorkflowRunProcessor(orgId))
  ProcessorRegistry.registerForEntity('COMMENT', (orgId) => new CommentProcessor(orgId))
  ProcessorRegistry.registerForEntity('CUSTOM_FIELD', (orgId) => new CustomFieldProcessor(orgId))
  ProcessorRegistry.registerForEntity('MESSAGE', (orgId) => new MessageProcessor(orgId))
  ProcessorRegistry.registerForEntity(
    'KNOWLEDGE_BASE',
    (orgId) => new KnowledgeBaseProcessor(orgId)
  )
  ProcessorRegistry.registerForEntity('CHAT_WIDGET', (orgId) => new ChatWidgetProcessor(orgId))
  ProcessorRegistry.registerForEntity('visit_qc_item', (orgId) => new VisitQcItemProcessor(orgId))

  // Mark as initialized
  ProcessorRegistry.markInitialized()

  logger.info(`Registered ${ProcessorRegistry.getProcessorCount()} file upload processors`)
}

/**
 * Lazy initialization flag to ensure processors are only initialized once
 */
let processorsInitialized = false

/**
 * Ensure processors are initialized (call this before using the registry)
 */
export function ensureProcessorsInitialized(): void {
  if (!processorsInitialized) {
    initializeProcessors()
    processorsInitialized = true
  }
}
