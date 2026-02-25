// packages/lib/src/workflow-engine/nodes/dataset/document-extractor.ts

import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { ExtractorFactory } from '../../../datasets/extractors/extractor-factory'
import { createFileService } from '../../../files/core/file-service'
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

const logger = createScopedLogger('document-extractor-processor')

/**
 * Source type for document extraction
 */
enum DocumentSourceType {
  FILE = 'file',
  URL = 'url',
}

/**
 * Document Extractor node configuration
 */
interface DocumentExtractorConfig {
  title?: string
  desc?: string

  // Source configuration
  sourceType: DocumentSourceType
  fileId?: string // Variable reference or constant - MediaAsset ID
  url?: string // Variable reference or constant - URL to fetch

  // Extraction options
  preserveFormatting?: boolean
  extractImages?: boolean
  language?: string // Language hint for OCR

  // Field modes tracking (constant vs variable)
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
 */
const documentExtractorConfigSchema = z.object({
  title: z.string().optional().default('Document Extractor'),
  desc: z.string().optional(),
  sourceType: z.nativeEnum(DocumentSourceType).default(DocumentSourceType.FILE),
  fileId: z.string().optional(),
  url: z.string().optional(),
  preserveFormatting: z.boolean().optional().default(false),
  extractImages: z.boolean().optional().default(false),
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
        preserveFormatting: config.preserveFormatting ?? false,
        extractImages: config.extractImages ?? false,
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

        inputs = {
          sourceType: config.sourceType,
          fileId: config.fileId
            ? await this.interpolateVariables(config.fileId, contextManager)
            : undefined,
          url: config.url ? await this.interpolateVariables(config.url, contextManager) : undefined,
          preserveFormatting: config.preserveFormatting ?? false,
          extractImages: config.extractImages ?? false,
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

      return {
        status: extractionResult.success ? NodeRunningStatus.Succeeded : NodeRunningStatus.Failed,
        output: extractionResult,
        outputHandle: extractionResult.success ? 'source' : 'error',
        error: extractionResult.error,
      }
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

      return {
        status: NodeRunningStatus.Failed,
        error: errorMessage,
        output: errorOutput,
        outputHandle: 'error',
      }
    }
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

    // Get userId from context for FileService
    const userId = (await contextManager.getVariable('sys.userId')) as string

    // Get file metadata and content via FileService
    const fileService = createFileService(organizationId, userId)
    const file = await fileService.get(fileId)

    if (!file) {
      throw this.createExecutionError(`File not found: ${fileId}`, node, {
        fileId,
        organizationId,
      })
    }

    const contentBuffer = await fileService.getContent(fileId)
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
