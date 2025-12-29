// packages/lib/src/workflow-engine/nodes/dataset/chunker.ts

import { createScopedLogger } from '@auxx/logger'
import { BaseNodeProcessor } from '../base-node'
import type {
  WorkflowNode,
  NodeExecutionResult,
  ValidationResult,
  PreprocessedNodeData,
} from '../../core/types'
import { NodeRunningStatus, WorkflowActionType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import { z } from 'zod'
import { TextChunker, DocumentProcessor } from '@auxx/lib/datasets'
import type { DocumentChunk } from '@auxx/lib/datasets'
import { interpretEscapeSequences } from '@auxx/lib/utils'

const logger = createScopedLogger('chunker-processor')

/**
 * Chunker node configuration
 */
interface ChunkerConfig {
  title?: string
  desc?: string

  // Input content
  content?: string

  // Chunking configuration
  chunkSize?: number
  chunkOverlap?: number
  delimiter?: string
  normalizeWhitespace?: boolean
  removeUrlsAndEmails?: boolean

  // Field modes tracking (constant vs variable)
  fieldModes?: Record<string, boolean>
}

/**
 * Chunker output structure
 * Uses structured chunks array (no separate chunkedContent needed)
 */
interface ChunkerOutput {
  /** Array of chunk objects with content and metadata */
  chunks: DocumentChunk[]
  /** Number of chunks created */
  chunkCount: number
  /** Chunking statistics */
  metadata: {
    totalSegments: number
    totalCharacters: number
    totalWords: number
    totalTokens: number
    averageChunkSize: number
    minChunkSize: number
    maxChunkSize: number
    originalLength: number
  }
  /** Whether chunking succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Validation schema for Chunker configuration
 */
const chunkerConfigSchema = z.object({
  title: z.string().optional().default('Chunker'),
  desc: z.string().optional(),
  content: z.string().optional(),
  chunkSize: z.number().positive().optional().default(1000),
  chunkOverlap: z.number().nonnegative().optional().default(50),
  delimiter: z.string().optional().default('\\n\\n'),
  normalizeWhitespace: z.boolean().optional().default(true),
  removeUrlsAndEmails: z.boolean().optional().default(false),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Chunker Node Processor
 *
 * Splits text content into chunks using the existing TextChunker infrastructure.
 * Outputs both simple chunk array and structured ChunkedContent for Knowledge Base.
 */
export class ChunkerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowActionType.CHUNKER

  /**
   * Preprocess node - validate config and resolve variables
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    // Validate configuration
    const configResult = chunkerConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      throw this.createProcessingError(
        `Invalid Chunker configuration: ${configResult.error.issues.map((e) => e.message).join(', ')}`,
        node,
        { validationErrors: configResult.error.issues }
      )
    }

    const config = configResult.data as ChunkerConfig
    const usedVariables = new Set<string>()

    // Resolve content - required field
    if (!config.content) {
      throw this.createProcessingError('Content is required for chunking', node, { config })
    }

    // Check if content is in constant mode (direct text) or variable mode (picker reference)
    const isConstantMode = config.fieldModes?.content === true
    let resolvedContent: string

    if (isConstantMode) {
      // Constant mode: content is direct text, use as-is
      resolvedContent = config.content
    } else {
      // Variable mode (picker): content is a direct variable path like "nodeId.content"
      // Use getVariable to resolve it directly
      const contentValue = await contextManager.getVariable(config.content)

      if (contentValue === undefined || contentValue === null) {
        throw this.createProcessingError(
          `Variable "${config.content}" not found or is null`,
          node,
          { variablePath: config.content }
        )
      }

      // Ensure it's a string
      resolvedContent = typeof contentValue === 'string' ? contentValue : String(contentValue)

      // Track variable usage
      usedVariables.add(config.content)
    }

    if (!resolvedContent || resolvedContent.trim().length === 0) {
      throw this.createProcessingError('Content is empty after variable resolution', node, {
        originalContent: config.content,
        isConstantMode,
      })
    }

    // Resolve numeric fields (may be variables)
    let resolvedChunkSize = config.chunkSize ?? 1000
    let resolvedChunkOverlap = config.chunkOverlap ?? 50

    // Handle chunkSize as potential variable
    if (typeof config.chunkSize === 'string') {
      const interpolated = await this.interpolateVariables(config.chunkSize, contextManager)
      resolvedChunkSize = parseInt(interpolated, 10)
      if (isNaN(resolvedChunkSize) || resolvedChunkSize <= 0) {
        throw this.createProcessingError('Invalid chunk size: must be a positive number', node, {
          originalValue: config.chunkSize,
          resolvedValue: interpolated,
        })
      }
      this.extractVariableIds(config.chunkSize).forEach((v) => usedVariables.add(v))
    }

    // Handle chunkOverlap as potential variable
    if (typeof config.chunkOverlap === 'string') {
      const interpolated = await this.interpolateVariables(config.chunkOverlap, contextManager)
      resolvedChunkOverlap = parseInt(interpolated, 10)
      if (isNaN(resolvedChunkOverlap) || resolvedChunkOverlap < 0) {
        throw this.createProcessingError(
          'Invalid chunk overlap: must be a non-negative number',
          node,
          { originalValue: config.chunkOverlap, resolvedValue: interpolated }
        )
      }
      this.extractVariableIds(config.chunkOverlap).forEach((v) => usedVariables.add(v))
    }

    // Validate overlap vs size relationship
    if (resolvedChunkOverlap >= resolvedChunkSize) {
      throw this.createProcessingError('Chunk overlap must be less than chunk size', node, {
        chunkSize: resolvedChunkSize,
        chunkOverlap: resolvedChunkOverlap,
      })
    }

    // Validate effective step (must be at least 20% of chunk size)
    const effectiveStep = resolvedChunkSize - resolvedChunkOverlap
    if (effectiveStep < resolvedChunkSize * 0.2) {
      throw this.createProcessingError(
        `Overlap too large: effective step (${effectiveStep}) must be at least 20% of chunk size (${resolvedChunkSize})`,
        node,
        { chunkSize: resolvedChunkSize, chunkOverlap: resolvedChunkOverlap, effectiveStep }
      )
    }

    // Resolve delimiter - use shared interpretEscapeSequences utility
    let resolvedDelimiter: string | undefined
    if (config.delimiter) {
      resolvedDelimiter = await this.interpolateVariables(config.delimiter, contextManager)
      // Use shared utility for escape sequence interpretation (same as DocumentProcessor)
      resolvedDelimiter = interpretEscapeSequences(resolvedDelimiter)
      this.extractVariableIds(config.delimiter).forEach((v) => usedVariables.add(v))
    }

    return {
      inputs: {
        content: resolvedContent,
        chunkSize: resolvedChunkSize,
        chunkOverlap: resolvedChunkOverlap,
        delimiter: resolvedDelimiter,
        normalizeWhitespace: config.normalizeWhitespace ?? true,
        removeUrlsAndEmails: config.removeUrlsAndEmails ?? false,
        variablesUsed: Array.from(usedVariables),
      },
      metadata: {
        nodeType: 'chunker',
        contentLength: resolvedContent.length,
        chunkSize: resolvedChunkSize,
        chunkOverlap: resolvedChunkOverlap,
        hasDelimiter: !!resolvedDelimiter,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  /**
   * Execute node - chunk the content
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    try {
      if (!preprocessedData?.inputs) {
        throw this.createExecutionError('Preprocessed data is required for chunking', node)
      }

      const inputs = preprocessedData.inputs
      contextManager.log('INFO', node.name, 'Chunking content', {
        contentLength: inputs.content.length,
        chunkSize: inputs.chunkSize,
        chunkOverlap: inputs.chunkOverlap,
      })

      // Step 1: Preprocess content using shared DocumentProcessor method
      // SINGLE SOURCE OF TRUTH: Same preprocessing as processDocumentWithFlow
      const preprocessedContent = DocumentProcessor.preprocessContent(inputs.content, {
        normalizeWhitespace: inputs.normalizeWhitespace,
        removeUrlsAndEmails: inputs.removeUrlsAndEmails,
      })

      if (preprocessedContent.trim().length === 0) {
        throw this.createExecutionError('Content is empty after preprocessing', node, {
          originalLength: inputs.content.length,
        })
      }

      // Step 2: Chunk the content using TextChunker
      const chunks = await TextChunker.chunkText(preprocessedContent, {
        chunkSize: inputs.chunkSize,
        chunkOverlap: inputs.chunkOverlap,
        delimiter: inputs.delimiter,
        preserveParagraphs: true,
        maxTokens: 8000,
      })

      // Step 3: Get chunking statistics
      const stats = TextChunker.getChunkingStats(chunks)

      // Step 4: Build output (structured chunks array, no separate chunkedContent)
      const output: ChunkerOutput = {
        chunks, // Full DocumentChunk[] with content, position, offsets, tokenCount
        chunkCount: chunks.length,
        metadata: {
          totalSegments: stats.totalSegments,
          totalCharacters: stats.totalCharacters,
          totalWords: stats.totalWords,
          totalTokens: stats.totalTokens,
          averageChunkSize: stats.averageChunkSize,
          minChunkSize: stats.minChunkSize,
          maxChunkSize: stats.maxChunkSize,
          originalLength: preprocessedContent.length,
        },
        success: true,
      }

      // Store output variables
      this.storeOutputVariables(node.nodeId, output, contextManager)

      const executionTime = Date.now() - startTime

      contextManager.log('INFO', node.name, 'Chunking completed', {
        chunkCount: chunks.length,
        originalLength: inputs.content.length,
        preprocessedLength: preprocessedContent.length,
        averageChunkSize: stats.averageChunkSize,
        executionTime,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output,
        outputHandle: 'source',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Chunking failed'

      contextManager.log('ERROR', node.name, 'Chunking failed', {
        error: errorMessage,
        executionTime: Date.now() - startTime,
      })

      // Store error output
      const errorOutput: ChunkerOutput = {
        chunks: [],
        chunkCount: 0,
        metadata: {
          totalSegments: 0,
          totalCharacters: 0,
          totalWords: 0,
          totalTokens: 0,
          averageChunkSize: 0,
          minChunkSize: 0,
          maxChunkSize: 0,
          originalLength: 0,
        },
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

  // NOTE: No local preprocessContent or interpretEscapeSequences methods needed!
  // We use shared infrastructure:
  // - DocumentProcessor.preprocessContent() from @auxx/lib/datasets
  // - interpretEscapeSequences() from @auxx/lib/utils

  /**
   * Store output variables in context
   * Chunks are stored as full DocumentChunk[] objects (not just strings)
   */
  private storeOutputVariables(
    nodeId: string,
    result: ChunkerOutput,
    contextManager: ExecutionContextManager
  ): void {
    // Store chunks as full objects with metadata (content, position, offsets, tokenCount, wordCount)
    contextManager.setNodeVariable(nodeId, 'chunks', result.chunks)
    contextManager.setNodeVariable(nodeId, 'chunkCount', result.chunkCount)
    contextManager.setNodeVariable(nodeId, 'metadata', result.metadata)
    contextManager.setNodeVariable(nodeId, 'success', result.success)
    contextManager.setNodeVariable(nodeId, 'error', result.error || null)
  }

  /**
   * Extract required variables from node configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as ChunkerConfig
    const variables = new Set<string>()

    // Extract from content
    if (config.content) {
      this.extractVariableIds(config.content).forEach((v) => variables.add(v))
      if (config.content.includes('.')) {
        variables.add(config.content)
      }
    }

    // Extract from chunkSize (if string/variable)
    if (typeof config.chunkSize === 'string') {
      this.extractVariableIds(config.chunkSize).forEach((v) => variables.add(v))
    }

    // Extract from chunkOverlap (if string/variable)
    if (typeof config.chunkOverlap === 'string') {
      this.extractVariableIds(config.chunkOverlap).forEach((v) => variables.add(v))
    }

    // Extract from delimiter
    if (config.delimiter) {
      this.extractVariableIds(config.delimiter).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    const configResult = chunkerConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      configResult.error.issues.forEach((issue) => {
        errors.push(`${issue.path.join('.')}: ${issue.message}`)
      })
      return { valid: false, errors, warnings }
    }

    const config = configResult.data

    // Validate content is provided
    if (!config.content) {
      errors.push('Content is required for chunking')
    }

    // Validate chunk size and overlap relationship (if both are numbers)
    if (typeof config.chunkSize === 'number' && typeof config.chunkOverlap === 'number') {
      if (config.chunkOverlap >= config.chunkSize) {
        errors.push('Chunk overlap must be less than chunk size')
      }

      const effectiveStep = config.chunkSize - config.chunkOverlap
      if (effectiveStep < config.chunkSize * 0.2) {
        warnings.push(
          `Overlap is very large (${config.chunkOverlap}). Effective step is only ${effectiveStep} characters.`
        )
      }
    }

    // Warning for very large chunk sizes
    if (typeof config.chunkSize === 'number' && config.chunkSize > 8000) {
      warnings.push('Large chunk size may exceed token limits for some embedding models')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
