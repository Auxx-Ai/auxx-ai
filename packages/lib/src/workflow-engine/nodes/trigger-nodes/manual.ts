// packages/lib/src/workflow-engine/nodes/trigger-nodes/manual.ts

import { createScopedLogger } from '../../../logger'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import {
  createFileVariable,
  createMultipleFilesVariable,
  type WorkflowFileData,
} from '../../types/file-variable'
import { BaseNodeProcessor } from '../base-node'

// Use WorkflowFileData from file-variable types

const logger = createScopedLogger('manual-trigger-processor')

type ManualTriggerConfig = {}

/**
 * Manual trigger node processor
 * This node serves as an entry point for manually triggered workflows
 */
export class ManualTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.MANUAL

  /**
   * Extract required variables from node configuration
   * Trigger nodes don't use upstream variables as they start workflows
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Manual trigger nodes start workflows and don't depend on upstream variables
    return []
  }

  async validate(node: WorkflowNode): Promise<ValidationResult> {
    // Manual trigger is always valid as it doesn't require configuration
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

    // Get manual trigger data including file uploads
    const triggerData = (await contextManager.getVariable('sys.triggerData')) || {}

    // Process manual inputs and set as workflow variables
    await this.processManualInputs(triggerData, contextManager)

    contextManager.log('INFO', node.name, 'Manual trigger activated', {
      variables: Object.keys(contextManager.getContext().variables),
      hasFiles: Object.values(triggerData).some(
        (v) => (Array.isArray(v) && v.length > 0 && v[0]?.url) || this.isFileObject(v)
      ),
    })

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        triggered_at: new Date().toISOString(),
        trigger_type: 'manual',
        input_summary: this.createInputSummary(triggerData),
      },
      outputHandle: 'source', // Standard output for trigger nodes
      executionTime: Date.now() - startTime,
      metadata: { processor: 'manual-trigger', inputCount: Object.keys(triggerData).length },
    }
  }

  /**
   * Process manual inputs and set them as workflow variables
   * Handles file arrays, single file objects, and regular inputs
   */
  private async processManualInputs(
    triggerData: Record<string, any>,
    contextManager: ExecutionContextManager
  ): Promise<void> {
    for (const [nodeId, value] of Object.entries(triggerData)) {
      // Check for file array (multiple files or single file in array format)
      if (Array.isArray(value) && value.length > 0 && value[0]?.url) {
        const files = value.map((file: any) => this.normalizeFileData(file, nodeId))

        if (files.length === 1) {
          // Single file from array - create structured file variable
          this.setSingleFileVariables(nodeId, files[0], contextManager)
        } else {
          // Multiple files - create structured array variable
          this.setMultipleFileVariables(nodeId, files, contextManager)
        }
      }
      // Check for single file object (not in array)
      else if (this.isFileObject(value)) {
        const file = this.normalizeFileData(value, nodeId)
        this.setSingleFileVariables(nodeId, file, contextManager)
      }
      // Regular text/other input
      else {
        contextManager.setVariable(nodeId, value)
      }
    }

    // Set a summary variable for easy access
    contextManager.setVariable('manualInputs', triggerData)
  }

  /**
   * Check if value looks like a file object (has url and filename)
   */
  private isFileObject(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const obj = value as Record<string, unknown>
    return typeof obj.url === 'string' && typeof obj.filename === 'string' && obj.url.length > 0
  }

  /**
   * Normalize file data to WorkflowFileData format with version support
   */
  private normalizeFileData(file: any, nodeId: string): WorkflowFileData {
    return {
      id: file.id || file.assetId || file.fileId,
      fileId: file.fileId || file.assetId || file.id,
      assetId: file.assetId || file.fileId || file.id,
      versionId: file.versionId || file.assetId || file.fileId || file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      url: file.url,
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

  /**
   * Set variables for a single file input
   */
  private setSingleFileVariables(
    nodeId: string,
    file: WorkflowFileData,
    contextManager: ExecutionContextManager
  ): void {
    // Create structured file variable
    const fileVariable = createFileVariable(nodeId, 'file', file)
    contextManager.setNodeVariable(nodeId, 'file', fileVariable)

    // Set backwards-compatible flat variables for existing workflows
    contextManager.setNodeVariable(nodeId, 'filename', file.filename)
    contextManager.setNodeVariable(nodeId, 'url', file.url)
    contextManager.setNodeVariable(nodeId, 'size', file.size)
    contextManager.setNodeVariable(nodeId, 'mimeType', file.mimeType)
    contextManager.setNodeVariable(nodeId, 'assetId', file.assetId)
    contextManager.setNodeVariable(nodeId, 'versionId', file.versionId)
  }

  /**
   * Set variables for multiple file inputs
   */
  private setMultipleFileVariables(
    nodeId: string,
    files: WorkflowFileData[],
    contextManager: ExecutionContextManager
  ): void {
    // Create structured array variable
    const filesVariable = createMultipleFilesVariable(nodeId, 'files', files)
    contextManager.setNodeVariable(nodeId, 'files', filesVariable)

    // Set backwards-compatible flat variables
    contextManager.setNodeVariable(nodeId, 'count', files.length)
    contextManager.setNodeVariable(
      nodeId,
      'totalSize',
      files.reduce((sum, f) => sum + f.size, 0)
    )
  }

  /**
   * Create a summary of manual inputs for logging/debugging
   */
  private createInputSummary(triggerData: Record<string, any>): Record<string, any> {
    const summary: Record<string, any> = {}

    for (const [nodeId, value] of Object.entries(triggerData)) {
      // File array
      if (Array.isArray(value) && value.length > 0 && value[0]?.url) {
        const files = value as WorkflowFileData[]
        summary[nodeId] = {
          type: 'files',
          count: files.length,
          filenames: files.map((f: WorkflowFileData) => f.filename),
          totalSize: files.reduce((sum: number, f: WorkflowFileData) => sum + f.size, 0),
        }
      }
      // Single file object
      else if (this.isFileObject(value)) {
        summary[nodeId] = {
          type: 'file',
          filename: (value as any).filename,
          size: (value as any).size,
        }
      }
      // Regular input
      else {
        summary[nodeId] = {
          type: typeof value,
          value: typeof value === 'string' ? value.substring(0, 100) : value,
        }
      }
    }

    return summary
  }
}
