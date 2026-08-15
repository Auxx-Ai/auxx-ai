// packages/lib/src/workflow-engine/nodes/dataset/dataset.ts

import { database as db, schema } from '@auxx/database'
import { DocumentTypeValues, IndexStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DocumentChunk } from '../../../datasets/types'
import { createDocumentProcessingFlow } from '../../../jobs/flows/document-processing-flow'
import type { DatasetNodeData as CatalogDatasetNodeData } from '../../catalog/nodes/dataset'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowActionType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { extractVariableRefs } from '../utils/variable-refs'
import { resolveBooleanConfig, resolveNumberConfig, variableBound } from './config-value'
import {
  clampEmbeddingTimeoutMinutes,
  EMBEDDING_WAIT,
  scheduleEmbeddingTimeout,
} from './embedding-wait'

const logger = createScopedLogger('dataset-processor')

/**
 * Dataset node configuration — the config subset of the catalog's
 * `DatasetNodeData` (node-catalog migration; this file previously shadowed it).
 *
 * `documentType` is widened back to `string`: the catalog types it as a
 * `DocumentType` for the panel's picker, but the field is variable-bindable, so
 * at run time it may still hold an unresolved reference string.
 */
type DatasetConfig = Partial<
  Pick<
    CatalogDatasetNodeData,
    | 'title'
    | 'desc'
    | 'datasetId'
    | 'chunks'
    | 'documentTitle'
    | 'mimeType'
    | 'sourceUrl'
    | 'fileId'
    | 'skipEmbedding'
    | 'waitForEmbeddings'
    | 'embeddingTimeoutMinutes'
    | 'metadata'
    | 'fieldModes'
  >
> & { documentType?: string }

/**
 * Dataset output structure
 */
interface DatasetOutput {
  documentId: string
  segmentIds: string[]
  chunksAdded: number
  embeddingStatus: 'queued' | 'completed' | 'skipped' | 'processing' | 'failed' | 'timeout'
  datasetId: string
  success: boolean
  error?: string
  // Additional fields populated on resume
  segmentsEmbedded?: number
  processingTimeMs?: number
  completedAt?: string
}

/**
 * Validation schema for Dataset configuration
 *
 * The processing toggles are widened with {@link variableBound}: in variable
 * mode the builder stores a reference string (`"extractor_1.success"`), which a
 * bare `z.boolean()` would reject — failing the node before the variable is
 * ever looked up. The reference is resolved and coerced in `preprocessNode`.
 */
const datasetConfigSchema = z.object({
  title: z.string().optional().default('Dataset'),
  desc: z.string().optional(),
  datasetId: z.string().optional(),
  chunks: z.string().optional(),
  documentTitle: z.string().optional(),
  mimeType: z.string().optional().default('text/plain'),
  documentType: z.string().optional(),
  sourceUrl: z.string().optional(),
  fileId: z.string().optional(),
  skipEmbedding: variableBound(z.boolean()).optional(),
  waitForEmbeddings: variableBound(z.boolean()).optional(),
  embeddingTimeoutMinutes: variableBound(z.number()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Dataset Node Processor
 *
 * Adds chunked content to a dataset with optional embedding generation.
 * This is the final step in the document processing pipeline:
 * Document Extractor → Chunker → Dataset
 *
 * Features:
 * - Creates document and segments in the target dataset
 * - Optionally queues embeddings via existing document processing flow
 * - Supports waitForEmbeddings mode that pauses workflow until embeddings complete
 *
 * `waitForEmbeddings` defaults to ON. Embedding generation is a BullMQ flow, so
 * without the wait the node reports success while the dataset still holds zero
 * vectors: a downstream knowledge-retrieval node reading the same dataset gets
 * fewer results, or none, with no error anywhere. That failure is silent and
 * data-dependent; the wait's cost is a pause/resume and bounded latency, and it
 * is what makes `embeddingStatus` / `segmentsEmbedded` mean anything. The wait
 * is ALWAYS bounded by `embeddingTimeoutMinutes` (see `./embedding-wait.ts`) —
 * a run that waits forever on a stuck embedding job is worse than one that
 * never waited.
 */
export class DatasetProcessor extends BaseNodeProcessor {
  readonly type = WorkflowActionType.DATASET

  /**
   * Preprocess node - validate config and resolve variables
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    // Validate configuration
    const configResult = datasetConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      throw this.createProcessingError(
        `Invalid Dataset configuration: ${configResult.error.issues.map((e) => e.message).join(', ')}`,
        node,
        { validationErrors: configResult.error.issues }
      )
    }

    const config = configResult.data as DatasetConfig
    const usedVariables = new Set<string>()
    const resolveValue = (raw: string) => this.resolveVariableValue(raw, contextManager)

    // === Resolve datasetId ===
    if (!config.datasetId) {
      throw this.createProcessingError('Dataset ID is required', node, { config })
    }

    const isDatasetConstantMode = config.fieldModes?.datasetId === true

    // Use extractIdFromValue which handles both direct IDs and ResourceReference objects
    const resolvedDatasetId = isDatasetConstantMode
      ? config.datasetId
      : await this.extractIdFromValue(config.datasetId, contextManager)

    // Track variable usage for non-constant mode
    if (!isDatasetConstantMode) {
      this.extractVariableIds(config.datasetId).forEach((v) => usedVariables.add(v))
      if (config.datasetId.includes('.')) {
        usedVariables.add(config.datasetId)
      }
    }

    if (!resolvedDatasetId) {
      throw this.createProcessingError('Dataset ID resolved to empty value', node, {
        originalValue: config.datasetId,
        isConstantMode: isDatasetConstantMode,
      })
    }

    // === Resolve chunks ===
    if (!config.chunks) {
      throw this.createProcessingError('Chunks input is required', node, { config })
    }

    // Chunks are always in variable mode (array from Chunker node)
    const chunksValue = await contextManager.getVariable(config.chunks)
    if (!chunksValue) {
      throw this.createProcessingError(
        `Chunks variable "${config.chunks}" not found or is null`,
        node,
        { variablePath: config.chunks }
      )
    }

    if (!Array.isArray(chunksValue)) {
      throw this.createProcessingError(`Chunks must be an array, got ${typeof chunksValue}`, node, {
        variablePath: config.chunks,
        valueType: typeof chunksValue,
      })
    }

    const resolvedChunks = chunksValue as DocumentChunk[]
    usedVariables.add(config.chunks)

    if (resolvedChunks.length === 0) {
      throw this.createProcessingError('Chunks array is empty', node, {
        variablePath: config.chunks,
      })
    }

    // === Resolve document settings ===
    let resolvedDocumentTitle = 'Workflow Document'
    if (config.documentTitle) {
      const isConstant = config.fieldModes?.documentTitle !== false
      if (isConstant) {
        resolvedDocumentTitle = config.documentTitle
      } else {
        resolvedDocumentTitle = await this.interpolateVariables(
          config.documentTitle,
          contextManager
        )
        this.extractVariableIds(config.documentTitle).forEach((v) => usedVariables.add(v))
      }
    }

    let resolvedMimeType = config.mimeType || 'text/plain'
    if (config.mimeType && config.fieldModes?.mimeType === false) {
      resolvedMimeType = await this.interpolateVariables(config.mimeType, contextManager)
      this.extractVariableIds(config.mimeType).forEach((v) => usedVariables.add(v))
    }

    let resolvedDocumentType = config.documentType
    if (config.documentType && config.fieldModes?.documentType === false) {
      resolvedDocumentType = await this.interpolateVariables(config.documentType, contextManager)
      this.extractVariableIds(config.documentType).forEach((v) => usedVariables.add(v))
    }

    let resolvedSourceUrl: string | undefined
    if (config.sourceUrl) {
      const isConstant = config.fieldModes?.sourceUrl !== false
      if (isConstant) {
        resolvedSourceUrl = config.sourceUrl
      } else {
        resolvedSourceUrl = await this.interpolateVariables(config.sourceUrl, contextManager)
        this.extractVariableIds(config.sourceUrl).forEach((v) => usedVariables.add(v))
      }
    }

    let resolvedFileId: string | undefined
    if (config.fileId) {
      const isConstant = config.fieldModes?.fileId === true
      if (isConstant) {
        resolvedFileId = config.fileId
      } else {
        const fileValue = await contextManager.getVariable(config.fileId)
        if (fileValue) {
          // Handle WorkflowFileData or direct string
          if (typeof fileValue === 'object' && 'fileId' in fileValue) {
            resolvedFileId = (fileValue as { fileId: string }).fileId
          } else if (typeof fileValue === 'string') {
            resolvedFileId = fileValue
          }
        }
        if (config.fileId.includes('.')) {
          usedVariables.add(config.fileId)
        }
      }
    }

    // === Resolve processing toggles ===
    // A literal boolean in constant mode; in variable mode a reference string
    // that must be resolved and coerced — never read for truthiness, since the
    // string "false" is truthy and would invert the switch.
    const resolvedSkipEmbedding = await resolveBooleanConfig(
      config.skipEmbedding,
      false,
      resolveValue
    )
    // Defaults ON — see the class docblock. An unset toggle waits.
    const resolvedWaitForEmbeddings = await resolveBooleanConfig(
      config.waitForEmbeddings,
      EMBEDDING_WAIT.DEFAULT_WAIT_FOR_EMBEDDINGS,
      resolveValue
    )
    const resolvedTimeoutMinutes = clampEmbeddingTimeoutMinutes(
      await resolveNumberConfig(config.embeddingTimeoutMinutes, resolveValue)
    )
    extractVariableRefs(config.skipEmbedding).forEach((v) => usedVariables.add(v))
    extractVariableRefs(config.waitForEmbeddings).forEach((v) => usedVariables.add(v))
    extractVariableRefs(config.embeddingTimeoutMinutes).forEach((v) => usedVariables.add(v))

    // Get organization and user IDs from context
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string

    if (!organizationId) {
      throw this.createProcessingError('Organization ID not available in execution context', node)
    }

    return {
      inputs: {
        datasetId: resolvedDatasetId,
        chunks: resolvedChunks,
        documentTitle: resolvedDocumentTitle,
        mimeType: resolvedMimeType,
        documentType: resolvedDocumentType,
        sourceUrl: resolvedSourceUrl,
        fileId: resolvedFileId,
        skipEmbedding: resolvedSkipEmbedding,
        waitForEmbeddings: resolvedWaitForEmbeddings,
        embeddingTimeoutMinutes: resolvedTimeoutMinutes,
        metadata: config.metadata,
        organizationId,
        userId,
        variablesUsed: Array.from(usedVariables),
      },
      metadata: {
        nodeType: 'dataset',
        datasetId: resolvedDatasetId,
        chunkCount: resolvedChunks.length,
        skipEmbedding: resolvedSkipEmbedding,
        waitForEmbeddings: resolvedWaitForEmbeddings,
        embeddingTimeoutMinutes: resolvedTimeoutMinutes,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  /**
   * Execute node - create document and segments in dataset
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    try {
      if (!preprocessedData?.inputs) {
        throw this.createExecutionError('Preprocessed data is required', node)
      }

      const inputs = preprocessedData.inputs

      contextManager.log('INFO', node.name, 'Adding chunks to dataset', {
        datasetId: inputs.datasetId,
        chunkCount: inputs.chunks.length,
        skipEmbedding: inputs.skipEmbedding,
        waitForEmbeddings: inputs.waitForEmbeddings,
      })

      // Step 1: Validate dataset exists and is accessible
      const [dataset] = await db
        .select({
          id: schema.Dataset.id,
          name: schema.Dataset.name,
          organizationId: schema.Dataset.organizationId,
          status: schema.Dataset.status,
        })
        .from(schema.Dataset)
        .where(eq(schema.Dataset.id, inputs.datasetId))
        .limit(1)

      if (!dataset) {
        throw this.createExecutionError(`Dataset not found: ${inputs.datasetId}`, node, {
          datasetId: inputs.datasetId,
        })
      }

      if (dataset.organizationId !== inputs.organizationId) {
        throw this.createExecutionError('Dataset belongs to different organization', node, {
          datasetId: inputs.datasetId,
          expectedOrg: inputs.organizationId,
        })
      }

      // Step 2: Calculate total content size
      const totalContentSize = inputs.chunks.reduce(
        (sum: number, chunk: DocumentChunk) => sum + chunk.content.length,
        0
      )

      // Step 3: Create document record
      // Generate a checksum from the content for deduplication
      const contentHash = await this.generateContentHash(inputs.chunks)

      const [document] = await db
        .insert(schema.Document)
        .values({
          title: inputs.documentTitle,
          filename: `workflow-${node.nodeId}-${Date.now()}`,
          datasetId: inputs.datasetId,
          organizationId: inputs.organizationId,
          type: inputs.documentType || 'TXT',
          mimeType: inputs.mimeType,
          status: inputs.skipEmbedding ? 'INDEXED' : 'PROCESSING',
          size: totalContentSize,
          checksum: contentHash,
          mediaAssetId: inputs.fileId || null,
          updatedAt: new Date(),
          metadata: {
            sourceUrl: inputs.sourceUrl,
            ...inputs.metadata,
            createdViaWorkflow: true,
            workflowNodeId: node.nodeId,
            chunkCount: inputs.chunks.length,
          },
        })
        .returning()

      if (!document) {
        throw this.createExecutionError('Failed to create document record', node)
      }

      contextManager.log('DEBUG', node.name, 'Document record created', {
        documentId: document.id,
        status: document.status,
      })

      // Step 4: Create document segments
      // All segments start as PENDING. When embeddings are processed, they'll be marked INDEXED.
      // If skipEmbedding is true, they remain PENDING but the document is marked INDEXED.
      const segmentIds: string[] = []
      const indexStatus = IndexStatus.PENDING

      for (let i = 0; i < inputs.chunks.length; i++) {
        const chunk = inputs.chunks[i] as DocumentChunk

        const [segment] = await db
          .insert(schema.DocumentSegment)
          .values({
            documentId: document.id,
            content: chunk.content,
            position: chunk.position ?? i,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            tokenCount: chunk.tokenCount,
            metadata: chunk.metadata || {},
            enabled: true,
            indexStatus,
            organizationId: inputs.organizationId,
            updatedAt: new Date(),
          })
          .returning()

        if (!segment) {
          throw this.createExecutionError(`Failed to create segment at position ${i}`, node)
        }

        segmentIds.push(segment.id)
      }

      contextManager.log('DEBUG', node.name, 'Segments created', {
        segmentCount: segmentIds.length,
        indexStatus,
      })

      // Step 5: Queue embedding generation if not skipped
      let embeddingStatus: 'queued' | 'completed' | 'skipped' | 'processing' = 'skipped'

      if (!inputs.skipEmbedding && segmentIds.length > 0) {
        // Get workflowRunId from context options
        const workflowRunId = contextManager.getOptions()?.workflowRunId

        // A run with no id cannot be resumed, so it cannot be paused either —
        // say so rather than silently ignoring the toggle.
        if (inputs.waitForEmbeddings && !workflowRunId) {
          contextManager.log(
            'WARN',
            node.name,
            'Cannot wait for embeddings without a workflow run id — continuing without waiting'
          )
        }

        const originalNodeOutput = {
          documentId: document.id,
          segmentIds,
          chunksAdded: segmentIds.length,
          datasetId: inputs.datasetId,
          success: true,
        }

        // Prepare workflow resume info if waitForEmbeddings is enabled
        const workflowResume =
          inputs.waitForEmbeddings && workflowRunId
            ? {
                workflowRunId,
                resumeFromNodeId: node.nodeId,
                documentId: document.id,
                originalNodeOutput,
              }
            : undefined

        // Use the document processing flow with optional workflow resume
        await createDocumentProcessingFlow({
          documentId: document.id,
          datasetId: inputs.datasetId,
          organizationId: inputs.organizationId,
          userId: inputs.userId,
          segments: inputs.chunks.map((chunk: DocumentChunk, index: number) => ({
            segmentId: segmentIds[index]!,
            content: chunk.content,
          })),
          workflowResume,
        })

        embeddingStatus = 'queued'

        contextManager.log('INFO', node.name, 'Embedding generation queued', {
          documentId: document.id,
          segmentCount: segmentIds.length,
          waitForEmbeddings: inputs.waitForEmbeddings,
        })

        // If waitForEmbeddings is enabled, pause the workflow
        if (inputs.waitForEmbeddings && workflowRunId) {
          const timeoutMinutes = clampEmbeddingTimeoutMinutes(inputs.embeddingTimeoutMinutes)
          const timeoutMs = timeoutMinutes * 60_000

          contextManager.log('INFO', node.name, 'Pausing workflow until embeddings complete', {
            documentId: document.id,
            segmentCount: segmentIds.length,
            workflowRunId,
            timeoutMinutes,
          })

          // The safety net for a flow that never finalizes — a permanently
          // failing embedding batch leaves the parent job waiting on children
          // forever, and nothing else would ever resume this run.
          await scheduleEmbeddingTimeout({
            workflowRunId,
            nodeId: node.nodeId,
            documentId: document.id,
            timeoutMs,
            originalNodeOutput,
          })

          // Store partial output variables (will be completed on resume)
          const partialOutput: DatasetOutput = {
            documentId: document.id,
            segmentIds,
            chunksAdded: segmentIds.length,
            embeddingStatus: 'processing',
            datasetId: inputs.datasetId,
            success: true,
          }
          this.storeOutputVariables(node.nodeId, partialOutput, contextManager)

          // Return paused status
          return {
            status: NodeRunningStatus.Paused,
            pauseReason: {
              type: 'document_processing',
              nodeId: node.nodeId,
              message: `Waiting for ${segmentIds.length} segments to be embedded`,
              metadata: {
                documentId: document.id,
                datasetId: inputs.datasetId,
                segmentCount: segmentIds.length,
                queuedAt: new Date().toISOString(),
                timeoutMinutes,
                timesOutAt: new Date(Date.now() + timeoutMs).toISOString(),
              },
            },
            output: partialOutput,
            outputHandle: 'source',
          }
        }
      }

      // Step 6: Build output (non-waiting case)
      const output: DatasetOutput = {
        documentId: document.id,
        segmentIds,
        chunksAdded: segmentIds.length,
        embeddingStatus,
        datasetId: inputs.datasetId,
        success: true,
      }

      // Store output variables
      this.storeOutputVariables(node.nodeId, output, contextManager)

      const executionTime = Date.now() - startTime

      contextManager.log('INFO', node.name, 'Dataset operation completed', {
        documentId: document.id,
        segmentCount: segmentIds.length,
        embeddingStatus,
        executionTime,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output,
        outputHandle: 'source',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Dataset operation failed'

      contextManager.log('ERROR', node.name, 'Dataset operation failed', {
        error: errorMessage,
        executionTime: Date.now() - startTime,
      })

      // Store error output
      const errorOutput: DatasetOutput = {
        documentId: '',
        segmentIds: [],
        chunksAdded: 0,
        embeddingStatus: 'skipped',
        datasetId: preprocessedData?.inputs?.datasetId || '',
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
    result: DatasetOutput,
    contextManager: ExecutionContextManager
  ): void {
    contextManager.setNodeVariable(nodeId, 'documentId', result.documentId)
    contextManager.setNodeVariable(nodeId, 'segmentIds', result.segmentIds)
    contextManager.setNodeVariable(nodeId, 'chunksAdded', result.chunksAdded)
    contextManager.setNodeVariable(nodeId, 'embeddingStatus', result.embeddingStatus)
    contextManager.setNodeVariable(nodeId, 'datasetId', result.datasetId)
    contextManager.setNodeVariable(nodeId, 'success', result.success)
    contextManager.setNodeVariable(nodeId, 'error', result.error || null)
    // Store additional fields if present (from resume)
    if (result.segmentsEmbedded !== undefined) {
      contextManager.setNodeVariable(nodeId, 'segmentsEmbedded', result.segmentsEmbedded)
    }
    if (result.processingTimeMs !== undefined) {
      contextManager.setNodeVariable(nodeId, 'processingTimeMs', result.processingTimeMs)
    }
    if (result.completedAt !== undefined) {
      contextManager.setNodeVariable(nodeId, 'completedAt', result.completedAt)
    }
  }

  /**
   * Extract required variables from node configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as DatasetConfig
    const variables = new Set<string>()

    // Extract from datasetId (if variable mode)
    if (config.datasetId && config.fieldModes?.datasetId !== true) {
      this.extractVariableIds(config.datasetId).forEach((v) => variables.add(v))
      if (config.datasetId.includes('.')) {
        variables.add(config.datasetId)
      }
    }

    // Extract from chunks (always variable mode)
    if (config.chunks) {
      variables.add(config.chunks)
    }

    // Extract from documentTitle (if variable mode)
    if (config.documentTitle && config.fieldModes?.documentTitle === false) {
      this.extractVariableIds(config.documentTitle).forEach((v) => variables.add(v))
    }

    // Extract from sourceUrl (if variable mode)
    if (config.sourceUrl && config.fieldModes?.sourceUrl === false) {
      this.extractVariableIds(config.sourceUrl).forEach((v) => variables.add(v))
    }

    // Extract from fileId (if variable mode)
    if (config.fileId && config.fieldModes?.fileId !== true) {
      if (config.fileId.includes('.')) {
        variables.add(config.fileId)
      }
    }

    // Bindable processing toggles — a bound field carries either a {{…}}
    // template or a bare picker path
    extractVariableRefs(config.skipEmbedding).forEach((v) => variables.add(v))
    extractVariableRefs(config.waitForEmbeddings).forEach((v) => variables.add(v))
    extractVariableRefs(config.embeddingTimeoutMinutes).forEach((v) => variables.add(v))

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    const configResult = datasetConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      configResult.error.issues.forEach((issue) => {
        errors.push(`${issue.path.join('.')}: ${issue.message}`)
      })
      return { valid: false, errors, warnings }
    }

    const config = configResult.data

    // Validate required fields
    if (!config.datasetId) {
      errors.push('Dataset ID is required')
    }

    if (!config.chunks) {
      errors.push('Chunks input is required')
    }

    // Validate documentType if provided
    if (config.documentType) {
      const validTypes = DocumentTypeValues || [
        'PDF',
        'TXT',
        'DOCX',
        'CSV',
        'HTML',
        'MARKDOWN',
        'JSON',
      ]
      if (!validTypes.includes(config.documentType as any)) {
        warnings.push(`Document type "${config.documentType}" may not be a valid type`)
      }
    }

    // Warning for waitForEmbeddings with skipEmbedding. Only a literal `false`
    // disables the wait now that it defaults ON, and only a literal comparison
    // is meaningful either way — a bound toggle holds a reference string that
    // is truthy whatever it resolves to.
    if (config.skipEmbedding === true && config.waitForEmbeddings !== false) {
      warnings.push('waitForEmbeddings has no effect when skipEmbedding is true')
    }

    // Range is clamped rather than rejected at run time, so say so here instead
    // of silently honouring something other than what the panel shows.
    if (typeof config.embeddingTimeoutMinutes === 'number') {
      const { MIN_TIMEOUT_MINUTES, MAX_TIMEOUT_MINUTES } = EMBEDDING_WAIT
      if (
        config.embeddingTimeoutMinutes < MIN_TIMEOUT_MINUTES ||
        config.embeddingTimeoutMinutes > MAX_TIMEOUT_MINUTES
      ) {
        warnings.push(
          `Embedding timeout is clamped to ${MIN_TIMEOUT_MINUTES}–${MAX_TIMEOUT_MINUTES} minutes`
        )
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Generate a content hash from chunks for document deduplication
   */
  private async generateContentHash(chunks: DocumentChunk[]): Promise<string> {
    // Create a simple hash from chunk contents
    const content = chunks.map((c) => c.content).join('')
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    return hashHex
  }
}
