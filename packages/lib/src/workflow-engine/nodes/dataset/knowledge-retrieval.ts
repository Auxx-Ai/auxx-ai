// packages/lib/src/workflow-engine/nodes/dataset/knowledge-retrieval.ts

import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { SearchService } from '../../../datasets/services/search.service'
import type { SearchQuery, SearchResult, SearchType } from '../../../datasets/types/search.types'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowActionType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import {
  extractVariableRefs,
  resolveEnumConfig,
  resolveNumberConfig,
  variableBound,
} from './config-value'

const logger = createScopedLogger('knowledge-retrieval-processor')

/**
 * Dataset entry configuration
 */
interface DatasetEntry {
  datasetId: string
}

/**
 * Knowledge Retrieval node configuration
 */
interface KnowledgeRetrievalConfig {
  title?: string
  desc?: string

  // Query input
  query?: string

  // Dataset selection
  datasets?: DatasetEntry[]

  // Search configuration
  // Each carries a variable reference string when bound to a variable
  searchType?: SearchType | string
  limit?: number | string
  similarityThreshold?: number | string

  // Field modes tracking (constant vs variable)
  fieldModes?: Record<string, boolean>
}

/**
 * Simplified search result for workflow output
 * Flattens the nested SearchResult structure for easier downstream access
 */
interface KnowledgeRetrievalResultItem {
  content: string
  score: number
  rank: number
  segmentId: string
  documentId: string
  documentTitle: string
  datasetId: string
  datasetName: string
  position: number
  searchType: string
}

/**
 * Knowledge Retrieval output structure
 */
interface KnowledgeRetrievalOutput {
  results: KnowledgeRetrievalResultItem[]
  total: number
  responseTime: number
  hasMore: boolean
  query: string
  searchType: string
  success: boolean
  error?: string
}

/**
 * Validation schema for Knowledge Retrieval configuration
 */
const datasetEntrySchema = z.object({
  datasetId: z.string(),
})

/** Search types the retrieval node knows how to dispatch */
const SEARCH_TYPES = ['vector', 'text', 'hybrid'] as const

/** Defaults applied when a search-configuration field is unset or unresolvable */
const DEFAULT_SEARCH_TYPE: SearchType = 'hybrid'
const DEFAULT_LIMIT = 20
const DEFAULT_SIMILARITY_THRESHOLD = 0.7

/**
 * Validation schema for Knowledge Retrieval configuration
 *
 * The bindable search-configuration fields are widened with
 * {@link variableBound}: in variable mode the builder stores a reference string
 * (`"trigger_1.limit"`), which a bare `z.number()` / `z.enum()` would reject —
 * failing the node before the variable is ever looked up. Ranges are enforced
 * in `preprocessNode` against the resolved value instead.
 */
const knowledgeRetrievalConfigSchema = z.object({
  title: z.string().optional().default('Knowledge Retrieval'),
  desc: z.string().optional(),
  query: z.string().optional(),
  datasets: z.array(datasetEntrySchema).optional(),
  searchType: variableBound(z.enum(SEARCH_TYPES)).optional(),
  limit: variableBound(z.number().min(1).max(100)).optional(),
  similarityThreshold: variableBound(z.number().min(0).max(1)).optional(),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Knowledge Retrieval Node Processor
 *
 * Performs semantic search across one or more datasets using the existing
 * SearchService infrastructure. Supports vector, text, and hybrid search modes.
 *
 * This is the retrieval step in RAG pipelines:
 * Dataset (indexing) → ... → Knowledge Retrieval (query) → LLM (generate)
 */
export class KnowledgeRetrievalProcessor extends BaseNodeProcessor {
  readonly type = WorkflowActionType.KNOWLEDGE_RETRIEVAL

  /**
   * Preprocess node - validate config and resolve variables
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    // Validate configuration
    const configResult = knowledgeRetrievalConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      throw this.createProcessingError(
        `Invalid Knowledge Retrieval configuration: ${configResult.error.issues.map((e) => e.message).join(', ')}`,
        node,
        { validationErrors: configResult.error.issues }
      )
    }

    const config = configResult.data as KnowledgeRetrievalConfig
    const usedVariables = new Set<string>()
    const resolveValue = (raw: string) => this.resolveVariableValue(raw, contextManager)

    // === Resolve query ===
    if (!config.query) {
      throw this.createProcessingError('Query is required', node, { config })
    }

    const isQueryConstantMode = config.fieldModes?.query === true
    let resolvedQuery: string

    if (isQueryConstantMode) {
      resolvedQuery = config.query
    } else {
      // Variable mode - interpolate variables in the query
      resolvedQuery = await this.interpolateVariables(config.query, contextManager)
      this.extractVariableIds(config.query).forEach((v) => usedVariables.add(v))
      // Also check if it's a direct variable reference
      if (config.query.includes('.')) {
        const directValue = await contextManager.getVariable(config.query)
        if (typeof directValue === 'string' || typeof directValue === 'number') {
          resolvedQuery = String(directValue)
          usedVariables.add(config.query)
        }
      }
    }

    if (!resolvedQuery || resolvedQuery.trim().length === 0) {
      throw this.createProcessingError('Query resolved to empty value', node, {
        originalQuery: config.query,
        isConstantMode: isQueryConstantMode,
      })
    }

    // === Resolve datasets ===
    if (!config.datasets || config.datasets.length === 0) {
      throw this.createProcessingError('At least one dataset must be selected', node, { config })
    }

    const resolvedDatasetIds: string[] = []

    for (let i = 0; i < config.datasets.length; i++) {
      const entry = config.datasets[i]
      if (!entry?.datasetId) continue

      const fieldKey = `datasets.${i}.datasetId`
      const isConstantMode = config.fieldModes?.[fieldKey] !== false // Default to constant mode

      let resolvedDatasetId: string | undefined

      if (isConstantMode) {
        resolvedDatasetId = entry.datasetId
      } else {
        // Variable mode - use extractIdFromValue which handles ResourceReference objects
        resolvedDatasetId = await this.extractIdFromValue(entry.datasetId, contextManager)
        this.extractVariableIds(entry.datasetId).forEach((v) => usedVariables.add(v))
        if (entry.datasetId.includes('.')) {
          usedVariables.add(entry.datasetId)
        }
      }

      if (resolvedDatasetId) {
        resolvedDatasetIds.push(resolvedDatasetId)
      }
    }

    if (resolvedDatasetIds.length === 0) {
      throw this.createProcessingError('No valid dataset IDs after resolution', node, {
        originalDatasets: config.datasets,
      })
    }

    // === Resolve search configuration ===
    // Each of these is a literal in constant mode and a variable reference
    // string in variable mode; resolution happens before the range check so a
    // bound field is judged on its resolved value, never on the raw reference.
    const resolvedSearchType = await resolveEnumConfig(
      config.searchType,
      SEARCH_TYPES,
      DEFAULT_SEARCH_TYPE,
      resolveValue
    )
    extractVariableRefs(config.searchType).forEach((v) => usedVariables.add(v))

    let resolvedLimit = DEFAULT_LIMIT
    const limitValue = await resolveNumberConfig(config.limit, resolveValue)
    if (limitValue !== undefined && limitValue >= 1 && limitValue <= 100) {
      resolvedLimit = Math.floor(limitValue)
    }
    extractVariableRefs(config.limit).forEach((v) => usedVariables.add(v))

    let resolvedSimilarityThreshold = DEFAULT_SIMILARITY_THRESHOLD
    const thresholdValue = await resolveNumberConfig(config.similarityThreshold, resolveValue)
    if (thresholdValue !== undefined && thresholdValue >= 0 && thresholdValue <= 1) {
      resolvedSimilarityThreshold = thresholdValue
    }
    extractVariableRefs(config.similarityThreshold).forEach((v) => usedVariables.add(v))

    // Get organization and user IDs from context
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string | undefined

    if (!organizationId) {
      throw this.createProcessingError('Organization ID not available in execution context', node)
    }

    return {
      inputs: {
        query: resolvedQuery,
        datasetIds: resolvedDatasetIds,
        searchType: resolvedSearchType,
        limit: resolvedLimit,
        similarityThreshold: resolvedSimilarityThreshold,
        organizationId,
        userId,
        variablesUsed: Array.from(usedVariables),
      },
      metadata: {
        nodeType: 'knowledge-retrieval',
        datasetCount: resolvedDatasetIds.length,
        searchType: resolvedSearchType,
        limit: resolvedLimit,
        similarityThreshold: resolvedSimilarityThreshold,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  /**
   * Execute node - perform search across datasets
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    try {
      let inputs: any

      // Use preprocessed data if available
      if (preprocessedData?.inputs) {
        inputs = preprocessedData.inputs
        contextManager.log(
          'INFO',
          node.name,
          'Executing knowledge retrieval with preprocessed data',
          {
            query: inputs.query.substring(0, 100) + (inputs.query.length > 100 ? '...' : ''),
            datasetCount: inputs.datasetIds.length,
            searchType: inputs.searchType,
            limit: inputs.limit,
          }
        )
      } else {
        // Fallback: process configuration directly (should not happen in normal flow)
        throw this.createExecutionError('Preprocessed data is required', node)
      }

      // Build search query
      const searchQuery: SearchQuery = {
        query: inputs.query,
        datasetIds: inputs.datasetIds,
        searchType: inputs.searchType,
        limit: inputs.limit,
        similarityThreshold: inputs.similarityThreshold,
      }

      // Execute search
      const searchResponse = await SearchService.search(
        searchQuery,
        inputs.organizationId,
        inputs.userId
      )

      // Transform results to flattened format for easier downstream access
      const transformedResults: KnowledgeRetrievalResultItem[] = searchResponse.results.map(
        (result: SearchResult) => ({
          content: result.segment.content,
          score: result.score,
          rank: result.rank,
          segmentId: result.segment.id,
          documentId: result.segment.document.id,
          documentTitle: result.segment.document.title || result.segment.document.filename,
          datasetId: result.segment.document.dataset.id,
          datasetName: result.segment.document.dataset.name,
          position: result.segment.position,
          searchType: result.searchType,
        })
      )

      // Build output
      const output: KnowledgeRetrievalOutput = {
        results: transformedResults,
        total: searchResponse.total,
        responseTime: searchResponse.responseTime,
        hasMore: searchResponse.hasMore ?? false,
        query: searchResponse.query,
        searchType: searchResponse.searchType,
        success: true,
      }

      // Store output variables
      this.storeOutputVariables(node.nodeId, output, contextManager)

      const executionTime = Date.now() - startTime

      contextManager.log('INFO', node.name, 'Knowledge retrieval completed', {
        resultsCount: transformedResults.length,
        total: searchResponse.total,
        responseTime: searchResponse.responseTime,
        executionTime,
        hasMore: output.hasMore,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output,
        outputHandle: 'source',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Knowledge retrieval failed'

      contextManager.log('ERROR', node.name, 'Knowledge retrieval failed', {
        error: errorMessage,
        executionTime: Date.now() - startTime,
      })

      // Store error output
      const errorOutput: KnowledgeRetrievalOutput = {
        results: [],
        total: 0,
        responseTime: Date.now() - startTime,
        hasMore: false,
        query: preprocessedData?.inputs?.query || '',
        searchType: preprocessedData?.inputs?.searchType || 'hybrid',
        success: false,
        error: errorMessage,
      }
      this.storeOutputVariables(node.nodeId, errorOutput, contextManager)

      return {
        status: NodeRunningStatus.Failed,
        error: errorMessage,
        output: errorOutput,
        outputHandle: 'error',
      }
    }
  }

  /**
   * Store output variables in context
   */
  private storeOutputVariables(
    nodeId: string,
    result: KnowledgeRetrievalOutput,
    contextManager: ExecutionContextManager
  ): void {
    contextManager.setNodeVariable(nodeId, 'results', result.results)
    contextManager.setNodeVariable(nodeId, 'total', result.total)
    contextManager.setNodeVariable(nodeId, 'responseTime', result.responseTime)
    contextManager.setNodeVariable(nodeId, 'hasMore', result.hasMore)
    contextManager.setNodeVariable(nodeId, 'query', result.query)
    contextManager.setNodeVariable(nodeId, 'searchType', result.searchType)
    contextManager.setNodeVariable(nodeId, 'success', result.success)
    contextManager.setNodeVariable(nodeId, 'error', result.error || null)
  }

  /**
   * Extract required variables from node configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as KnowledgeRetrievalConfig
    const variables = new Set<string>()

    // Extract from query (if variable mode)
    if (config.query && config.fieldModes?.query !== true) {
      this.extractVariableIds(config.query).forEach((v) => variables.add(v))
      if (config.query.includes('.')) {
        variables.add(config.query)
      }
    }

    // Extract from datasets (each entry can be a variable)
    if (config.datasets && Array.isArray(config.datasets)) {
      config.datasets.forEach((entry, index) => {
        const fieldKey = `datasets.${index}.datasetId`
        if (entry.datasetId && config.fieldModes?.[fieldKey] === false) {
          this.extractVariableIds(entry.datasetId).forEach((v) => variables.add(v))
          if (entry.datasetId.includes('.')) {
            variables.add(entry.datasetId)
          }
        }
      })
    }

    // Bindable search settings — a bound field carries either a {{…}} template
    // or a bare picker path, both of which extractVariableRefs recognises
    extractVariableRefs(config.searchType).forEach((v) => variables.add(v))
    extractVariableRefs(config.limit).forEach((v) => variables.add(v))
    extractVariableRefs(config.similarityThreshold).forEach((v) => variables.add(v))

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    const configResult = knowledgeRetrievalConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      configResult.error.issues.forEach((issue) => {
        errors.push(`${issue.path.join('.')}: ${issue.message}`)
      })
      return { valid: false, errors, warnings }
    }

    const config = configResult.data

    // Validate required fields
    if (!config.query) {
      errors.push('Query is required')
    }

    if (!config.datasets || config.datasets.length === 0) {
      errors.push('At least one dataset must be selected')
    }

    // Validate literal ranges only — a bound field holds a variable reference
    // whose value is not known until the run, and is range-checked there
    if (typeof config.limit === 'number' && (config.limit < 1 || config.limit > 100)) {
      errors.push('Limit must be between 1 and 100')
    }

    if (
      typeof config.similarityThreshold === 'number' &&
      (config.similarityThreshold < 0 || config.similarityThreshold > 1)
    ) {
      errors.push('Similarity threshold must be between 0 and 1')
    }

    // Warning for text search with similarity threshold
    if (config.searchType === 'text' && config.similarityThreshold !== undefined) {
      warnings.push('Similarity threshold has no effect for text-only search')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
