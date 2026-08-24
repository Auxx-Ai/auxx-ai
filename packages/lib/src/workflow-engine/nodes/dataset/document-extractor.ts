// packages/lib/src/workflow-engine/nodes/dataset/document-extractor.ts

import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { ExtractorFactory } from '../../../datasets/extractors/extractor-factory'
import { defaultDatabase } from '../../../files/default-database'
import { getFolderFile, getFolderFileContent } from '../../../files/folder-files'
import { createS3StoragePort } from '../../../files/storage/ports'
import { ErrorStrategy, normalizeErrorStrategy } from '../../catalog/error-handling'
import {
  type DocumentExtractorNodeData as CatalogDocumentExtractorNodeData,
  DocumentSourceType,
} from '../../catalog/nodes/document-extractor'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowActionType } from '../../core/types'
import type { WorkflowFileData } from '../../types/file-variable'
import { BaseNodeProcessor } from '../base-node'
import { extractVariableRefs } from '../utils/variable-refs'
import { resolveBooleanConfig, variableBound } from './config-value'

const logger = createScopedLogger('document-extractor-processor')

/**
 * Document Extractor node configuration — the config subset of the catalog's
 * `DocumentExtractorNodeData` (node-catalog migration; this file previously
 * shadowed it, `DocumentSourceType` enum and all).
 */
type DocumentExtractorConfig = Partial<
  Pick<
    CatalogDocumentExtractorNodeData,
    'title' | 'desc' | 'fileId' | 'url' | 'preserveFormatting' | 'extractImages' | 'language'
  >
> &
  Pick<CatalogDocumentExtractorNodeData, 'sourceType'> & {
    fieldModes?: Record<string, boolean>
  }

/**
 * Extraction result structure
 */
interface ExtractionOutput {
  content: string
  wordCount: number
  metadata: Record<string, any>
  success: boolean
  error?: string
}

/**
 * Validation schema for Document Extractor configuration
 *
 * The extraction toggles are widened with {@link variableBound}: in variable
 * mode the builder stores a reference string (`"trigger_1.preserveFormatting"`),
 * which a bare `z.boolean()` would reject — failing the node before the
 * variable is ever looked up. The reference is resolved and coerced in
 * `preprocessNode`.
 */
const documentExtractorConfigSchema = z.object({
  title: z.string().optional().default('Document Extractor'),
  desc: z.string().optional(),
  sourceType: z.enum(DocumentSourceType).default(DocumentSourceType.FILE),
  fileId: z.string().optional(),
  url: z.string().optional(),
  preserveFormatting: variableBound(z.boolean()).optional(),
  extractImages: variableBound(z.boolean()).optional(),
  language: z.string().optional(),
  fieldModes: z.record(z.string(), z.boolean()).optional(),
})

/**
 * Document Extractor Node Processor
 *
 * Extracts text content from files (MediaAssets) or URLs using the existing
 * ExtractorFactory infrastructure from the datasets module.
 */
export class DocumentExtractorProcessor extends BaseNodeProcessor {
  readonly type = WorkflowActionType.DOCUMENT_EXTRACTOR

  /**
   * Preprocess node - validate config and resolve variables
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    // Validate configuration
    const configResult = documentExtractorConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      throw this.createProcessingError(
        `Invalid Document Extractor configuration: ${configResult.error.issues.map((e) => e.message).join(', ')}`,
        node,
        { validationErrors: configResult.error.issues }
      )
    }

    const config = configResult.data as DocumentExtractorConfig
    const usedVariables = new Set<string>()

    // Resolve source based on type
    let resolvedFileId: string | undefined
    let resolvedUrl: string | undefined

    if (config.sourceType === DocumentSourceType.FILE) {
      if (!config.fileId) {
        throw this.createProcessingError('File ID is required when source type is "file"', node, {
          sourceType: config.sourceType,
        })
      }

      // Check if fileId is in constant mode (direct MediaAsset ID) or variable mode
      const isConstantMode = config.fieldModes?.fileId === true

      if (isConstantMode) {
        // Constant mode: fileId is a direct MediaAsset ID
        resolvedFileId = config.fileId
      } else {
        // Variable mode: resolve the variable reference
        resolvedFileId = await this.interpolateVariables(config.fileId, contextManager)

        // If fileId is a variable reference to a WorkflowFileData object, extract the actual ID
        const fileValue = await contextManager.getVariable(config.fileId)
        if (fileValue && typeof fileValue === 'object' && 'fileId' in fileValue) {
          // It's a WorkflowFileData object - extract the fileId
          resolvedFileId = (fileValue as WorkflowFileData).fileId
        } else if (fileValue && typeof fileValue === 'string') {
          // Direct string value (could be MediaAsset ID)
          resolvedFileId = fileValue
        }

        // Track variable usage
        this.extractVariableIds(config.fileId).forEach((v) => usedVariables.add(v))
      }
    } else if (config.sourceType === DocumentSourceType.URL) {
      if (!config.url) {
        throw this.createProcessingError('URL is required when source type is "url"', node, {
          sourceType: config.sourceType,
        })
      }

      // Interpolate URL - it may contain variable references
      resolvedUrl = await this.interpolateVariables(config.url, contextManager)

      // Validate URL format
      if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
        throw this.createProcessingError('URL must start with http:// or https://', node, {
          originalUrl: config.url,
          resolvedUrl,
        })
      }

      // Track variable usage
      this.extractVariableIds(config.url).forEach((v) => usedVariables.add(v))
    }

    // Resolve extraction toggles — a literal boolean in constant mode; in
    // variable mode a reference string that must be resolved and coerced,
    // never read for truthiness (the string "false" is truthy).
    const resolveValue = (raw: string) => this.resolveVariableValue(raw, contextManager)
    const resolvedPreserveFormatting = await resolveBooleanConfig(
      config.preserveFormatting,
      false,
      resolveValue
    )
    const resolvedExtractImages = await resolveBooleanConfig(
      config.extractImages,
      false,
      resolveValue
    )
    extractVariableRefs(config.preserveFormatting).forEach((v) => usedVariables.add(v))
    extractVariableRefs(config.extractImages).forEach((v) => usedVariables.add(v))

    // Get organization ID from context
    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    if (!organizationId) {
      throw this.createProcessingError('Organization ID not available in execution context', node)
    }

    return {
      inputs: {
        sourceType: config.sourceType,
        fileId: resolvedFileId,
        url: resolvedUrl,
        preserveFormatting: resolvedPreserveFormatting,
        extractImages: resolvedExtractImages,
        language: config.language,
        organizationId,
        variablesUsed: Array.from(usedVariables),
      },
      metadata: {
        nodeType: 'document-extractor',
        sourceType: config.sourceType,
        hasFile: !!resolvedFileId,
        hasUrl: !!resolvedUrl,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  /**
   * Execute node - extract content from file or URL
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
        contextManager.log('INFO', node.name, 'Extracting document with preprocessed data', {
          sourceType: inputs.sourceType,
          hasFile: !!inputs.fileId,
          hasUrl: !!inputs.url,
        })
      } else {
        // Fallback: process configuration directly
        const config = node.data as unknown as DocumentExtractorConfig
        const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
        const resolveValue = (raw: string) => this.resolveVariableValue(raw, contextManager)

        inputs = {
          sourceType: config.sourceType,
          fileId: config.fileId
            ? await this.interpolateVariables(config.fileId, contextManager)
            : undefined,
          url: config.url ? await this.interpolateVariables(config.url, contextManager) : undefined,
          preserveFormatting: await resolveBooleanConfig(
            config.preserveFormatting,
            false,
            resolveValue
          ),
          extractImages: await resolveBooleanConfig(config.extractImages, false, resolveValue),
          language: config.language,
          organizationId,
        }
      }

      // Extract content based on source type
      let extractionResult: ExtractionOutput

      if (inputs.sourceType === DocumentSourceType.FILE) {
        extractionResult = await this.extractFromFile(
          inputs.fileId,
          inputs.organizationId,
          inputs,
          contextManager,
          node
        )
      } else {
        extractionResult = await this.extractFromUrl(
          inputs.url,
          inputs.organizationId,
          inputs,
          contextManager,
          node
        )
      }

      // Store output variables
      this.storeOutputVariables(node.nodeId, extractionResult, contextManager)

      const executionTime = Date.now() - startTime

      contextManager.log('INFO', node.name, 'Document extraction completed', {
        success: extractionResult.success,
        wordCount: extractionResult.wordCount,
        contentLength: extractionResult.content?.length || 0,
        executionTime,
      })

      if (extractionResult.success) {
        return {
          status: NodeRunningStatus.Succeeded,
          output: extractionResult,
          outputHandle: 'source',
        }
      }
      return this.failureResult(node, extractionResult, extractionResult.error)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Document extraction failed'

      contextManager.log('ERROR', node.name, 'Document extraction failed', {
        error: errorMessage,
        executionTime: Date.now() - startTime,
      })

      // Store error output
      const errorOutput: ExtractionOutput = {
        content: '',
        wordCount: 0,
        metadata: {},
        success: false,
        error: errorMessage,
      }
      this.storeOutputVariables(node.nodeId, errorOutput, contextManager)

      return this.failureResult(node, errorOutput, errorMessage)
    }
  }

  /**
   * Apply the node's failure policy (`catalog/error-handling.ts`).
   *
   * Replaces the `outputHandle: 'error'` this used to emit — a handle no
   * manifest declared, no `node.tsx` rendered and no edge could ever address,
   * so the run died anyway (plan 21 §14.2). Behaviour is preserved exactly for
   * a node with no stored `error_strategy`: it resolves to `fail`, emits the
   * declared `fail` handle, `findFailureEdge` finds nothing (the node never
   * rendered the handle, so no edge can exist) and the engine throws — the
   * same fatal outcome, now over a vocabulary an author can actually wire.
   *
   * The `'fail'` literal stays inline in every opted-in processor rather than
   * moving to a shared helper: the builder↔engine parity reader
   * (`apps/web/.../parity/engine-write-scrape.ts`) extracts emitted handles by
   * reading each processor FILE, so a handle emitted from a util would drop out
   * of the contract it is supposed to be pinned by.
   */
  private failureResult(
    node: WorkflowNode,
    output: ExtractionOutput,
    error?: string
  ): Partial<NodeExecutionResult> {
    const strategy = normalizeErrorStrategy(
      (node.data as { error_strategy?: unknown }).error_strategy
    )
    if (strategy === ErrorStrategy.continue) {
      return { status: NodeRunningStatus.Succeeded, output, outputHandle: 'source' }
    }
    return { status: NodeRunningStatus.Failed, error, output, outputHandle: 'fail' }
  }

  /**
   * Extract content from a FolderFile
   */
  private async extractFromFile(
    fileId: string,
    organizationId: string,
    options: { preserveFormatting?: boolean; extractImages?: boolean; language?: string },
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<ExtractionOutput> {
    contextManager.log('DEBUG', node.name, 'Extracting from file', { fileId, organizationId })

    // The pool, exactly as the deleted `createFileService(organizationId, userId)`
    // resolved it. This node has no caller-supplied client and never writes, so
    // there is no transaction to stay inside of.
    const ctx = { db: defaultDatabase(), organizationId }

    const fileResult = await getFolderFile(ctx, fileId)
    if (fileResult.isErr()) throw fileResult.error
    const file = fileResult.value

    if (!file) {
      throw this.createExecutionError(`File not found: ${fileId}`, node, {
        fileId,
        organizationId,
      })
    }

    const content = await getFolderFileContent(
      ctx,
      { storage: createS3StoragePort(organizationId) },
      fileId
    )
    if (content.isErr()) throw content.error
    const contentBuffer = content.value
    if (!contentBuffer) {
      throw this.createExecutionError('Failed to retrieve file content', node, {
        fileId,
        fileName: file.name,
      })
    }

    // Extract content using ExtractorFactory
    const extension = file.ext || file.name?.split('.').pop() || ''
    const normalizedExtension = extension ? `.${extension}` : ''

    const result = await ExtractorFactory.extractWithFallback(
      contentBuffer,
      file.mimeType || 'application/octet-stream',
      normalizedExtension,
      {
        fileName: file.name || 'unknown',
        organizationId,
      },
      {
        preserveFormatting: options.preserveFormatting,
        extractImages: options.extractImages,
        fallbackEnabled: true,
      }
    )

    return {
      content: result.content,
      wordCount: result.wordCount || this.countWords(result.content),
      metadata: {
        fileName: file.name,
        mimeType: file.mimeType,
        fileSize: file.size,
        extractorUsed: result.extractorUsed,
        fallbacksAttempted: result.fallbacksAttempted,
        ...result.metadata,
      },
      success: true,
    }
  }

  /**
   * Extract content from a URL
   */
  private async extractFromUrl(
    url: string,
    organizationId: string,
    options: { preserveFormatting?: boolean; extractImages?: boolean; language?: string },
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<ExtractionOutput> {
    contextManager.log('DEBUG', node.name, 'Extracting from URL', { url })

    // Fetch content from URL
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Auxx-DocumentExtractor/1.0',
      },
      signal: AbortSignal.timeout(60000), // 60 second timeout
    })

    if (!response.ok) {
      throw this.createExecutionError(
        `Failed to fetch URL: ${response.status} ${response.statusText}`,
        node,
        { url, status: response.status, statusText: response.statusText }
      )
    }

    const contentBuffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type') || 'application/octet-stream'
    const fileName = this.extractFilenameFromUrl(url)
    const extension = fileName.split('.').pop() || ''
    const normalizedExtension = extension ? `.${extension}` : ''

    // Extract content using ExtractorFactory
    const result = await ExtractorFactory.extractWithFallback(
      contentBuffer,
      mimeType,
      normalizedExtension,
      {
        fileName,
        organizationId,
      },
      {
        preserveFormatting: options.preserveFormatting,
        extractImages: options.extractImages,
        fallbackEnabled: true,
      }
    )

    return {
      content: result.content,
      wordCount: result.wordCount || this.countWords(result.content),
      metadata: {
        sourceUrl: url,
        fileName,
        mimeType,
        contentLength: contentBuffer.length,
        extractorUsed: result.extractorUsed,
        fallbacksAttempted: result.fallbacksAttempted,
        ...result.metadata,
      },
      success: true,
    }
  }

  /**
   * Store output variables in context
   */
  private storeOutputVariables(
    nodeId: string,
    result: ExtractionOutput,
    contextManager: ExecutionContextManager
  ): void {
    contextManager.setNodeVariable(nodeId, 'content', result.content)
    contextManager.setNodeVariable(nodeId, 'wordCount', result.wordCount)
    contextManager.setNodeVariable(nodeId, 'metadata', result.metadata)
    contextManager.setNodeVariable(nodeId, 'success', result.success)
    contextManager.setNodeVariable(nodeId, 'error', result.error || null)
  }

  /**
   * Extract required variables from node configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as DocumentExtractorConfig
    const variables = new Set<string>()

    // Extract from fileId
    if (config.sourceType === DocumentSourceType.FILE && config.fileId) {
      this.extractVariableIds(config.fileId).forEach((v) => variables.add(v))
      // Also add the raw value if it looks like a variable reference
      if (config.fileId.includes('.')) {
        variables.add(config.fileId)
      }
    }

    // Extract from url
    if (config.sourceType === DocumentSourceType.URL && config.url) {
      this.extractVariableIds(config.url).forEach((v) => variables.add(v))
    }

    // Bindable extraction toggles — a bound field carries either a {{…}}
    // template or a bare picker path
    extractVariableRefs(config.preserveFormatting).forEach((v) => variables.add(v))
    extractVariableRefs(config.extractImages).forEach((v) => variables.add(v))

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    const configResult = documentExtractorConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      configResult.error.issues.forEach((issue) => {
        errors.push(`${issue.path.join('.')}: ${issue.message}`)
      })
      return { valid: false, errors, warnings }
    }

    const config = configResult.data

    // Validate source configuration
    if (config.sourceType === DocumentSourceType.FILE && !config.fileId) {
      errors.push('File ID is required when source type is "file"')
    }

    if (config.sourceType === DocumentSourceType.URL && !config.url) {
      errors.push('URL is required when source type is "url"')
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Extract filename from URL
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const filename = pathname.split('/').pop() || 'document'
      // Remove query parameters from filename
      return filename.split('?')[0] || 'document'
    } catch {
      return 'document'
    }
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    if (!text) return 0
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length
  }
}
