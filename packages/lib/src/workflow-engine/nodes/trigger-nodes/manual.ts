// packages/lib/src/workflow-engine/nodes/trigger-nodes/manual.ts

import { createScopedLogger } from '../../../logger'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { BaseType, NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { WorkflowFileData } from '../../types/file-variable'
import { BaseNodeProcessor } from '../base-node'
import { applyFormInputOutputVariables, type TypeOptions } from '../form-input/form-input-processor'

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

    const triggeredAt = new Date().toISOString()

    // The trigger's own three advertised variables. `userId` is the run's acting
    // user — `WorkflowRun.createdBy`, which the run creator resolves to the org
    // system user for a headless run — so it is populated for a builder test run
    // (the signed-in user) and for a production run alike. `inputs` is the whole
    // form-input payload, keyed by form-input node id — the same record whose
    // entries `processManualInputs` also publishes one node at a time.
    contextManager.setNodeVariables(node.nodeId, {
      timestamp: triggeredAt,
      userId: contextManager.getContext().userId ?? '',
      inputs: triggerData,
    })

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
        triggered_at: triggeredAt,
        trigger_type: 'manual',
      },
      outputHandle: 'source',
      executionTime: Date.now() - startTime,
      metadata: { processor: 'manual-trigger', inputCount: Object.keys(triggerData).length },
    }
  }

  /**
   * Process all manual inputs and set them as per-form-input-node variables.
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
        // The bare key stays for `{{nodeId}}` and back-compat...
        contextManager.setVariable(nodeId, value)
        // ...but the picker emits `{{nodeId.value}}`, and nothing else publishes
        // it: the form-input node is wired into this trigger, so it is
        // NON_EXECUTABLE and its own processor never runs. Without this, every
        // simple-type input interpolated to an empty string.
        const config = await this.findFormInputConfig(nodeId, contextManager)
        applyFormInputOutputVariables({
          nodeId,
          value,
          inputType: config?.inputType ?? BaseType.STRING,
          typeOptions: config?.typeOptions,
          label: config?.label,
          ctx: contextManager,
        })
      }
    }
  }

  /**
   * Find the form-input node this trigger input came from, for its declared type.
   *
   * `triggerData` is keyed by form-input node id, but carries no type information.
   * Returns null when the graph is unavailable or the id is not a form-input node,
   * in which case the caller falls back to STRING — the default branch of the
   * output contract, and the shape a bare scalar already has.
   *
   * The `data` read here is the FORM-INPUT node's, not this trigger's: `inputType`
   * / `typeOptions` / `label` are written by the form-input panel, and the run
   * panel's manual-input prompt reads the very same three keys off the very same
   * node (`nodes/shared/manual-trigger-input.tsx`). The manual trigger's own
   * `node.data` carries none of them.
   */
  private async findFormInputConfig(
    nodeId: string,
    contextManager: ExecutionContextManager
  ): Promise<{ inputType?: BaseType; typeOptions?: TypeOptions; label?: string } | null> {
    const workflow = (await contextManager.getVariable('sys.workflow')) as
      | { graph?: { nodes?: Array<Record<string, any>> } }
      | undefined
    const nodes = workflow?.graph?.nodes
    if (!Array.isArray(nodes)) return null

    const formInputNode = nodes.find((candidate) => (candidate?.nodeId ?? candidate?.id) === nodeId)
    if (!formInputNode || formInputNode.type !== 'form-input') return null

    return {
      inputType: formInputNode.data?.inputType as BaseType | undefined,
      typeOptions: formInputNode.data?.typeOptions as TypeOptions | undefined,
      label: formInputNode.data?.label as string | undefined,
    }
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
