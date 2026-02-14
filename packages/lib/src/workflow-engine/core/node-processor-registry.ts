// packages/lib/src/workflow-engine/core/node-processor-registry.ts

import { createScopedLogger } from '@auxx/logger'
import { AIProcessorV2 } from '../nodes/action-nodes/ai-v2'
// import { RuleMatchProcessor } from '../nodes/condition-nodes/rule-match'
import { AnswerProcessor } from '../nodes/action-nodes/answer'
import { CodeProcessor } from '../nodes/action-nodes/code'
import { CrudNodeProcessor } from '../nodes/action-nodes/crud'
import { ExecuteProcessor } from '../nodes/action-nodes/execute'
import { FindProcessor } from '../nodes/action-nodes/find'
import { HttpProcessor } from '../nodes/action-nodes/http'
import { HumanConfirmationProcessor } from '../nodes/action-nodes/human-confirmation'
import { VariableSetProcessor } from '../nodes/action-nodes/variable-set'
import {
  AppWorkflowBlockProcessor,
  type WorkflowBlockMetadata,
} from '../nodes/app-workflow-block-processor'
import { IfElseProcessor } from '../nodes/condition-nodes/if-else'
import { ChunkerProcessor } from '../nodes/dataset/chunker'
import { DatasetProcessor } from '../nodes/dataset/dataset'
import { DocumentExtractorProcessor } from '../nodes/dataset/document-extractor'
import { KnowledgeRetrievalProcessor } from '../nodes/dataset/knowledge-retrieval'
import { EndProcessor } from '../nodes/flow-nodes/end'
import { LoopProcessor } from '../nodes/flow-nodes/loop'
import { FormInputNodeProcessor } from '../nodes/form-input'
import { DateTimeProcessor } from '../nodes/transform-nodes/date-time-processor'
import { InformationExtractorProcessor } from '../nodes/transform-nodes/information-extractor'
import { ListProcessor } from '../nodes/transform-nodes/list-processor'
// JoinNode removed - merging now handled in workflow-engine.ts
import { TextClassifierProcessor } from '../nodes/transform-nodes/text-classifier'
import { VarAssignProcessor } from '../nodes/transform-nodes/var-assign-processor'
import { ManualTriggerProcessor } from '../nodes/trigger-nodes/manual'
// Import all processors at the top
import { MessageReceivedProcessor } from '../nodes/trigger-nodes/message-received'
import { ScheduledTriggerProcessor } from '../nodes/trigger-nodes/scheduled'
import { WebhookProcessor } from '../nodes/trigger-nodes/webhook-processor'
import { ResourceTriggerBase } from '../nodes/triggers/resource-trigger-base'
import { WaitNodeProcessor } from '../nodes/wait'
import type { NodeProcessor, WorkflowNodeType } from './types'

const logger = createScopedLogger('node-processor-registry')

/**
 * Registry for managing workflow node processors
 * Supports both static processors (built-in) and dynamic processors (app blocks)
 */
export class NodeProcessorRegistry {
  private processors: Map<WorkflowNodeType, NodeProcessor> = new Map()
  private appBlockProcessors: Map<string, AppWorkflowBlockProcessor> = new Map()
  private appBlockMetadataCache: Map<string, WorkflowBlockMetadata> = new Map()

  /**
   * Register a node processor
   */
  registerProcessor(processor: NodeProcessor): void {
    if (this.processors.has(processor.type as WorkflowNodeType)) {
      logger.warn(`Processor for type ${processor.type} already registered, overwriting`)
    }

    this.processors.set(processor.type as WorkflowNodeType, processor)
  }

  /**
   * Register multiple processors at once
   */
  registerProcessors(processors: NodeProcessor[]): void {
    processors.forEach((processor) => this.registerProcessor(processor))
  }

  /**
   * Get a processor for the given node type
   * IMPORTANT: This method is async to support dynamic app block loading.
   * All callers must await this method.
   *
   * @param type Node type (either built-in or app block format "appId:blockId")
   * @returns Processor for the node type
   * @throws Error if no processor found for the type
   */
  async getProcessor(
    type: WorkflowNodeType | string
  ): Promise<NodeProcessor | AppWorkflowBlockProcessor> {
    // Check static processors first
    if (this.processors.has(type as WorkflowNodeType)) {
      return this.processors.get(type as WorkflowNodeType)!
    }

    // Check if it's an app block (format: "appId:blockId")
    if (typeof type === 'string' && type.includes(':')) {
      // Check cache first
      if (this.appBlockProcessors.has(type)) {
        return this.appBlockProcessors.get(type)!
      }

      // Dynamic registration on-demand
      const [appId, blockId] = type.split(':')
      return await this.createAppBlockProcessor(appId!, blockId!)
    }

    throw new Error(`No processor found for node type: ${type}`)
  }

  /**
   * Check if a processor is registered for the given type
   * Supports both built-in node types and app workflow blocks (format: "appId:blockId")
   */
  hasProcessor(type: WorkflowNodeType | string): boolean {
    // Check static processors
    if (this.processors.has(type as WorkflowNodeType)) {
      return true
    }

    // Check if it's an app block (format: "appId:blockId")
    if (typeof type === 'string' && type.includes(':')) {
      // Check if already cached
      if (this.appBlockProcessors.has(type)) {
        return true
      }
      // App blocks can be loaded dynamically, so return true
      // The actual processor will be created on-demand in getProcessor()
      return true
    }

    return false
  }

  /**
   * Unregister a processor
   */
  unregisterProcessor(type: WorkflowNodeType): boolean {
    const removed = this.processors.delete(type)
    if (removed) {
      logger.info(`Unregistered processor for node type: ${type}`)
    }
    return removed
  }

  /**
   * Get all registered processor types
   * Includes both built-in node types and app workflow blocks
   */
  getRegisteredTypes(): (WorkflowNodeType | string)[] {
    return [...Array.from(this.processors.keys()), ...Array.from(this.appBlockProcessors.keys())]
  }

  /**
   * Get the count of registered processors
   */
  getProcessorCount(): number {
    return this.processors.size
  }

  /**
   * Clear all registered processors
   */
  clear(): void {
    const count = this.processors.size
    this.processors.clear()
    logger.info(`Cleared ${count} registered processors`)
  }

  /**
   * Initialize with default processors
   */
  async initializeWithDefaults(): Promise<void> {
    // Skip initialization in browser environment
    if (typeof window !== 'undefined') {
      logger.warn('Skipping processor initialization in browser environment')
      return
    }

    logger.info('Initializing with default node processors')

    try {
      // Use the processors imported at the top of the file
      const defaultProcessors = [
        new MessageReceivedProcessor(),
        new WebhookProcessor(),
        new ManualTriggerProcessor(),
        new ScheduledTriggerProcessor(),
        new ResourceTriggerBase(), // Unified resource trigger for all resource types
        new IfElseProcessor(),
        new AnswerProcessor(),
        new AIProcessorV2(this), // Pass registry for tools support
        new CodeProcessor(),
        new ExecuteProcessor(),
        new VariableSetProcessor(),
        new HttpProcessor(),
        new FindProcessor(),
        new CrudNodeProcessor(),
        new HumanConfirmationProcessor(),
        new EndProcessor(),
        // JoinNode removed - merging now handled in workflow-engine.ts
        new TextClassifierProcessor(),
        new InformationExtractorProcessor(),
        new VarAssignProcessor(),
        new DateTimeProcessor(),
        new ListProcessor(),
        new WaitNodeProcessor(),
        new LoopProcessor(),
        new DocumentExtractorProcessor(),
        new ChunkerProcessor(),
        new DatasetProcessor(),
        new KnowledgeRetrievalProcessor(),
        new FormInputNodeProcessor(),
      ]

      this.registerProcessors(defaultProcessors)

      logger.info(
        `Initialized with ${defaultProcessors.length} default processors (including unified resource trigger)`
      )
    } catch (error) {
      logger.error('Failed to initialize default processors', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Register an app workflow block processor dynamically
   * This is used to pre-register known app blocks
   */
  registerAppWorkflowBlock(appId: string, blockId: string, metadata: WorkflowBlockMetadata): void {
    const type = `${appId}:${blockId}`
    const processor = new AppWorkflowBlockProcessor(appId, blockId, metadata)
    this.appBlockProcessors.set(type, processor)
    this.appBlockMetadataCache.set(type, metadata)

    logger.debug('Registered app workflow block processor', { type, appId, blockId })
  }

  /**
   * Create app block processor on-demand
   * This is called when an app block is encountered that hasn't been pre-registered
   */
  private async createAppBlockProcessor(
    appId: string,
    blockId: string
  ): Promise<AppWorkflowBlockProcessor> {
    const type = `${appId}:${blockId}`

    // 1. Fetch block metadata from database or app runtime
    // TODO: Implement actual metadata fetching
    const metadata = await this.fetchBlockMetadata(appId, blockId)

    // 2. Create and register processor
    const processor = new AppWorkflowBlockProcessor(appId, blockId, metadata)
    this.appBlockProcessors.set(type, processor)
    this.appBlockMetadataCache.set(type, metadata)

    logger.info('Created app workflow block processor on-demand', { type, appId, blockId })

    return processor
  }

  /**
   * Fetch block metadata from app installation
   *
   * Strategy:
   * 1. Check in-memory cache
   * 2. Try to fetch from database (app_workflow_block table if exists)
   * 3. Fetch from app runtime by invoking get-workflow-blocks
   * 4. Fall back to permissive default that allows execution
   */
  private async fetchBlockMetadata(appId: string, blockId: string): Promise<WorkflowBlockMetadata> {
    const type = `${appId}:${blockId}`

    // 1. Check cache first
    if (this.appBlockMetadataCache.has(type)) {
      logger.debug('Block metadata found in cache', { type })
      return this.appBlockMetadataCache.get(type)!
    }

    logger.info('Fetching block metadata', { appId, blockId })

    try {
      // 2. Try to fetch from database (if table exists)
      // This would be implemented if we add a database table for workflow blocks
      // For now, we'll skip this step

      // 3. For server-side execution, we need to fetch metadata from the app runtime
      // This could be done by:
      // - Invoking the app's server bundle to get metadata
      // - Fetching from a metadata cache API endpoint
      // - Loading from a pre-cached metadata store

      // For now, we'll create a permissive default that allows execution
      // The schema will be validated at runtime by the app's execute function
      const metadata: WorkflowBlockMetadata = {
        id: blockId,
        label: blockId,
        description: `Workflow block from app ${appId}`,
        category: 'integration',
        schema: {
          // Permissive schema - any inputs/outputs allowed
          inputs: {},
          outputs: {},
        },
        // Conservative defaults
        timeout: 30000, // 30 seconds
        cacheable: false,
        hasSideEffects: true, // Assume blocks have side effects by default
        retries: 0, // No retries by default
      }

      // Cache it for future use
      this.appBlockMetadataCache.set(type, metadata)

      logger.info('Block metadata created with permissive defaults', { type })

      return metadata
    } catch (error) {
      logger.error('Failed to fetch block metadata', {
        appId,
        blockId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Return minimal metadata that allows execution to proceed
      return {
        id: blockId,
        label: blockId,
        description: `Workflow block from app ${appId}`,
        category: 'integration',
        schema: {
          inputs: {},
          outputs: {},
        },
        timeout: 30000,
      }
    }
  }

  /**
   * Preload block metadata for an app
   * This can be called when an app is installed or updated to cache metadata
   *
   * @param appId App ID
   * @param blocks Array of workflow blocks with metadata
   */
  preloadBlockMetadata(appId: string, blocks: WorkflowBlockMetadata[]): void {
    blocks.forEach((block) => {
      const type = `${appId}:${block.id}`
      this.appBlockMetadataCache.set(type, block)
      logger.debug('Preloaded block metadata', { type })
    })

    logger.info('Preloaded workflow block metadata', {
      appId,
      count: blocks.length,
    })
  }

  /**
   * Clear app block processor cache
   * Useful for development/testing or when apps are updated
   */
  clearAppBlockCache(): void {
    const count = this.appBlockProcessors.size
    this.appBlockProcessors.clear()
    this.appBlockMetadataCache.clear()
    logger.info(`Cleared ${count} app block processors from cache`)
  }

  /**
   * Get all registered app block types
   */
  getRegisteredAppBlocks(): string[] {
    return Array.from(this.appBlockProcessors.keys())
  }
}
