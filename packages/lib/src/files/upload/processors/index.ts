// packages/lib/src/files/upload/processors/index.ts

import { ProcessorRegistry } from './processor-registry'
import { FileProcessor } from './file-processor'
import { WorkflowProcessor } from './workflow-processor'
import {
  TicketProcessor,
  UserProfileProcessor,
  ArticleProcessor,
  WorkflowRunProcessor,
  CommentProcessor,
  MessageProcessor,
  KnowledgeBaseProcessor,
} from './entity-processors'
import { DatasetAssetProcessor } from './dataset'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('processors')

// Export all processors and types
export * from './types'
export * from './processor-registry'
export * from './base-processor'
export * from './base-asset-processor'
export * from './workflow-processor'
export * from './entity-processors'
export * from './dataset'
export * from '../init-types'
export * from '../util'

/**
 * Initialize and register all default processors using the simplified EntityType approach
 */
export function initializeProcessors(): void {
  // Register processors directly by EntityType
  ProcessorRegistry.registerForEntity('FILE', (orgId) => new FileProcessor(orgId))
  ProcessorRegistry.registerForEntity('DATASET', (orgId) => new DatasetAssetProcessor(orgId))
  ProcessorRegistry.registerForEntity('TICKET', (orgId) => new TicketProcessor(orgId))
  ProcessorRegistry.registerForEntity('ARTICLE', (orgId) => new ArticleProcessor(orgId))
  ProcessorRegistry.registerForEntity('USER_PROFILE', (orgId) => new UserProfileProcessor(orgId))
  ProcessorRegistry.registerForEntity('WORKFLOW_RUN', (orgId) => new WorkflowRunProcessor(orgId))
  ProcessorRegistry.registerForEntity('COMMENT', (orgId) => new CommentProcessor(orgId))
  ProcessorRegistry.registerForEntity('MESSAGE', (orgId) => new MessageProcessor(orgId))
  ProcessorRegistry.registerForEntity('KNOWLEDGE_BASE', (orgId) => new KnowledgeBaseProcessor(orgId))

  // Set default processor for unknown entity types
  ProcessorRegistry.setDefaultProcessor((orgId) => new FileProcessor(orgId))

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
