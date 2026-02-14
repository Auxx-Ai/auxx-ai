// packages/lib/src/workflow-engine/nodes/flow-nodes/end.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ContentSegment } from '../../types/content-segment'
import {
  extractFileData,
  isWorkflowFileData,
  isWorkflowFileDataArray,
} from '../../types/content-segment'
import { BaseNodeProcessor } from '../base-node'

/**
 * End node configuration interface
 * Minimal configuration for workflow termination
 */
interface EndNodeConfig {
  /** Message to display when workflow ends */
  message?: string

  /** Status of workflow completion */
  status?: 'success' | 'error'
}

/**
 * Flow control node that explicitly ends workflow execution
 * Minimal configuration - just optional message and status
 */
export class EndProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.END

  /**
   * Preprocess End node configuration
   * Resolves variables in the message field
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as EndNodeConfig

    // Resolve message variable if present
    const message = config.message
      ? await this.interpolateVariables(config.message, contextManager)
      : 'Workflow completed'

    const status = config.status || 'success'

    return {
      inputs: {
        message,
        status,
      },
      metadata: {
        nodeType: 'end',
        hasMessage: !!config.message,
        status,
      },
    }
  }

  /**
   * Helper method to extract variable IDs from template strings
   */
  // private extractVariableIds(template: string): string[] {
  //   const variables: string[] = []
  //   const regex = /\{\{([^}]+)\}\}/g
  //   let match

  //   while ((match = regex.exec(template)) !== null) {
  //     const variablePath = match[1].trim()
  //     variables.push(variablePath)
  //   }

  //   return variables
  // }

  /**
   * Extract variables from end node message
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as EndNodeConfig
    const variables = new Set<string>()

    // Extract from message
    if (config.message && typeof config.message === 'string') {
      this.extractVariableIds(config.message).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    // END node execution - terminates the workflow
    const config = node.data as EndNodeConfig
    const status = preprocessedData?.inputs.status || config.status || 'success'

    // Parse message to segments for rich content rendering
    const messageTemplate = config.message || 'Workflow completed'
    const { plainText, segments } = await this.parseMessageToSegments(
      messageTemplate,
      contextManager
    )

    // Use preprocessed message if available (for backwards compatibility)
    const message = preprocessedData?.inputs.message ?? plainText

    contextManager.log('INFO', node.name, message, { status, hasSegments: segments.length > 0 })

    // Store end node outputs as variables
    contextManager.setNodeVariable(node.nodeId, 'message', message)
    contextManager.setNodeVariable(node.nodeId, 'status', status)

    const output = {
      message,
      contentSegments: segments, // Rich content for file rendering
      status,
      completedAt: new Date().toISOString(),
    }

    // Determine final execution status
    const finalStatus = status === 'error' ? NodeRunningStatus.Failed : NodeRunningStatus.Succeeded

    return {
      status: finalStatus,
      output,
      outputHandle: 'source', // Enable continuation to downstream nodes if connected
    }
  }

  /**
   * Parse message template to content segments
   * Detects file objects and creates structured segments for rich rendering
   *
   * @param template - Message template with {{variable}} placeholders
   * @param contextManager - Execution context for variable resolution
   * @returns Plain text message and array of content segments
   */
  private async parseMessageToSegments(
    template: string,
    contextManager: ExecutionContextManager
  ): Promise<{ plainText: string; segments: ContentSegment[] }> {
    const segments: ContentSegment[] = []
    const varPattern = /\{\{([^}]+)\}\}/g
    let lastIndex = 0
    let plainText = ''
    let match

    while ((match = varPattern.exec(template)) !== null) {
      // Add text before this variable
      const textBefore = template.slice(lastIndex, match.index)
      if (textBefore) {
        segments.push({ type: 'text', value: textBefore })
        plainText += textBefore
      }

      const variablePath = match[1]?.trim()
      if (!variablePath) continue

      // Resolve the variable value
      const value = await contextManager.resolveVariablePath(variablePath)

      // Check if this is a file or file array
      const fileData = extractFileData(value)

      if (fileData) {
        if (isWorkflowFileDataArray(fileData)) {
          // Multiple files
          segments.push({ type: 'file-array', value: fileData })
          plainText += `[${fileData.length} file(s)]`
        } else if (isWorkflowFileData(fileData)) {
          // Single file
          segments.push({ type: 'file', value: fileData })
          plainText += `[File: ${fileData.filename}]`
        }
      } else {
        // Not a file - convert to string
        let stringValue: string
        if (value === undefined || value === null) {
          stringValue = ''
        } else if (typeof value === 'object') {
          stringValue = JSON.stringify(value)
        } else {
          stringValue = String(value)
        }

        if (stringValue) {
          segments.push({ type: 'text', value: stringValue })
        }
        plainText += stringValue
      }

      lastIndex = match.index + match[0].length
    }

    // Add remaining text after last variable
    const textAfter = template.slice(lastIndex)
    if (textAfter) {
      segments.push({ type: 'text', value: textAfter })
      plainText += textAfter
    }

    // If no variables found, return simple text segment
    if (segments.length === 0) {
      segments.push({ type: 'text', value: template })
      plainText = template
    }

    return { plainText, segments }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    const config = node.data as EndNodeConfig

    // Validate status if provided
    if (config.status && !['success', 'error'].includes(config.status)) {
      warnings.push('Status should be one of: success, error')
    }

    // End nodes are terminal by definition, no need to check connections

    return { valid: errors.length === 0, errors, warnings }
  }
}
