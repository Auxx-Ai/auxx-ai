// packages/lib/src/workflow-engine/nodes/trigger-nodes/manual.ts

import { createScopedLogger } from '../../../logger'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { WorkflowFileData } from '../../types/file-variable'
import { BaseNodeProcessor } from '../base-node'

const logger = createScopedLogger('manual-trigger-processor')

/**
 * Manual trigger node processor
 * This node serves as an entry point for manually triggered workflows.
 *
 * Since form-input nodes are NON_EXECUTABLE, this processor is responsible
 * for setting all output variables that the frontend declares in output-variables.ts.
 */
export class ManualTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.MANUAL

  protected extractRequiredVariables(node: WorkflowNode): string[] {
    return []
  }

  async validate(node: WorkflowNode): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    logger.info('Processing manual trigger', {
      nodeId: node.name,
      workflowId: await contextManager.getVariable('sys.workflowId'),
    })

    const triggerData = (await contextManager.getVariable('sys.triggerData')) || {}

    await this.processManualInputs(triggerData, contextManager)

    contextManager.log('INFO', node.name, 'Manual trigger activated', {
      variables: Object.keys(contextManager.getContext().variables),
      hasFiles: Object.values(triggerData).some(
        (v) =>
          (Array.isArray(v) && v.length > 0 && (v[0]?.url || v[0]?.assetId)) || this.isFileObject(v)
      ),
    })

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        triggered_at: new Date().toISOString(),
        trigger_type: 'manual',
      },
      outputHandle: 'source',
      executionTime: Date.now() - startTime,
      metadata: { processor: 'manual-trigger', inputCount: Object.keys(triggerData).length },
    }
  }

  /**
   * Process all manual inputs and set them as workflow variables.
   * Detects file inputs (arrays, single objects, file: prefixed IDs) and
   * sets both single and array variable formats for each.
   * Non-file inputs are passed through as-is.
   */
  private async processManualInputs(
    triggerData: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<void> {
    for (const [nodeId, value] of Object.entries(triggerData)) {
      const files = await this.extractFiles(value, nodeId, contextManager)
      if (files.length > 0) {
        this.setFileVariables(nodeId, files, contextManager)
      } else {
        contextManager.setVariable(nodeId, value)
      }
    }

    contextManager.setVariable('manualInputs', triggerData)
  }

  /**
   * Detect and extract file data from a trigger input value.
   * Handles: file object arrays, single file objects, and file: prefixed ID arrays.
   */
  private async extractFiles(
    value: any,
    nodeId: string,
    contextManager: ExecutionContextManager
  ): Promise<WorkflowFileData[]> {
    // Array of file objects (has url or assetId)
    if (Array.isArray(value) && value.length > 0 && (value[0]?.url || value[0]?.assetId)) {
      return value.map((f: any) => this.toFileData(f, nodeId))
    }

    // Array of file: prefixed IDs (from FileInput picker)
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === 'string' &&
      value[0].startsWith('file:')
    ) {
      return this.resolveFileIds(value, nodeId, contextManager)
    }

    // Single file object
    if (this.isFileObject(value)) {
      return [this.toFileData(value, nodeId)]
    }

    return []
  }

  /**
   * Set all file variables for a node input — always sets BOTH single and array formats
   * to match the frontend contract from output-variables.ts regardless of file count.
   */
  private setFileVariables(
    nodeId: string,
    files: WorkflowFileData[],
    contextManager: ExecutionContextManager
  ): void {
    const first = files[0]!

    contextManager.setNodeVariables(nodeId, {
      // Array format — matches frontend "allowMultiple" output-variables
      files: files,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),

      // Single/nested format — matches frontend single-file output-variables
      file: first,
      'file.id': first.assetId || first.id,
      'file.filename': first.filename,
      'file.size': first.size,
      'file.mimeType': first.mimeType,
      'file.url': first.url || '',

      // Legacy flat format (existing workflows may reference these)
      filename: first.filename,
      url: first.url || '',
      size: first.size,
      mimeType: first.mimeType,
      assetId: first.assetId,
      versionId: first.versionId,
    })
  }

  /**
   * Resolve file: prefixed IDs to WorkflowFileData via FileContextService
   */
  private async resolveFileIds(
    fileIds: string[],
    nodeId: string,
    contextManager: ExecutionContextManager
  ): Promise<WorkflowFileData[]> {
    const fileService = contextManager.getFileService()
    const files: WorkflowFileData[] = []

    for (const prefixedId of fileIds) {
      const fileRef = await fileService.normalizeFileInput(prefixedId, nodeId)
      if (fileRef) {
        files.push({
          id: fileRef.id,
          fileId: fileRef.assetId,
          assetId: fileRef.assetId,
          versionId: fileRef.versionId,
          filename: fileRef.filename,
          mimeType: fileRef.mimeType,
          size: fileRef.size,
          url: fileRef.url,
          nodeId,
          uploadedAt: new Date(),
          expiresAt: fileRef.urlExpiresAt,
        })
      } else {
        logger.warn('Could not resolve file ID', { prefixedId, nodeId })
      }
    }

    return files
  }

  /** Check if value looks like a file object */
  private isFileObject(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const obj = value as Record<string, unknown>
    return (
      typeof obj.filename === 'string' &&
      (typeof obj.url === 'string' || typeof obj.assetId === 'string')
    )
  }

  /** Normalize raw file data to WorkflowFileData */
  private toFileData(file: any, nodeId: string): WorkflowFileData {
    return {
      id: file.id || file.assetId || file.fileId,
      fileId: file.fileId || file.assetId || file.id,
      assetId: file.assetId || file.fileId || file.id,
      versionId: file.versionId || file.assetId || file.fileId || file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      url: file.url || '',
      nodeId: file.nodeId || nodeId,
      uploadedAt:
        typeof file.uploadedAt === 'string'
          ? new Date(file.uploadedAt)
          : file.uploadedAt || new Date(),
      expiresAt: file.expiresAt
        ? typeof file.expiresAt === 'string'
          ? new Date(file.expiresAt)
          : file.expiresAt
        : undefined,
    }
  }
}
