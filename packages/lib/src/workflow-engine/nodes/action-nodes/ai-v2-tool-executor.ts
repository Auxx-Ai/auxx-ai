// packages/lib/src/workflow-engine/nodes/action-nodes/ai-v2-tool-executor.ts

import type { ToolExecutor, ToolExecutionResult } from '../../../ai/orchestrator/types'
import type { ToolCall } from '../../../ai/clients/base/types'
import type { Workflow } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import { ToolExecutionManager } from '../../core/tool-execution-manager'
import { createScopedLogger } from '../../../logger'

/**
 * Tool executor for AI-v2 node that integrates with the workflow engine's tool system
 */
export class AIV2ToolExecutor implements ToolExecutor {
  private logger = createScopedLogger('AIV2ToolExecutor')

  constructor(
    private toolExecutionManager: ToolExecutionManager,
    private contextManager: ExecutionContextManager,
    private nodeId: string,
    private workflow: Workflow
  ) {}

  async executeTools(toolCalls: ToolCall[], context?: any): Promise<ToolExecutionResult[]> {
    this.logger.debug('Executing tools for AI-v2 node', {
      nodeId: this.nodeId,
      toolCount: toolCalls.length,
      toolNames: toolCalls.map(t => t.function.name),
    })

    const results: ToolExecutionResult[] = []

    for (const toolCall of toolCalls) {
      const startTime = Date.now()
      
      try {
        this.contextManager.log('DEBUG', this.nodeId, 'Executing tool', {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })

        // Parse arguments if they're a string
        let parsedArguments: Record<string, any>
        if (typeof toolCall.function.arguments === 'string') {
          try {
            parsedArguments = JSON.parse(toolCall.function.arguments)
          } catch (error) {
            throw new Error(`Invalid tool arguments JSON: ${toolCall.function.arguments}`)
          }
        } else {
          parsedArguments = toolCall.function.arguments
        }

        // Execute the tool using the workflow engine's tool execution manager
        const toolResult = await this.toolExecutionManager.executeTool(
          toolCall.function.name,
          parsedArguments,
          this.contextManager,
          this.nodeId,
          this.workflow
        )

        const executionTime = Date.now() - startTime

        this.contextManager.log('INFO', this.nodeId, 'Tool executed successfully', {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          executionTime,
          outputKeys: Object.keys(toolResult || {}),
        })

        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: true,
          output: toolResult || {},
          executionTime,
          metadata: {
            nodeId: this.nodeId,
            workflowId: this.workflow.id,
          },
        })

      } catch (error) {
        const executionTime = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : String(error)

        this.contextManager.log('ERROR', this.nodeId, 'Tool execution failed', {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          error: errorMessage,
          executionTime,
        })

        this.logger.error('Tool execution failed', {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          error: errorMessage,
          nodeId: this.nodeId,
        })

        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          success: false,
          output: {},
          error: errorMessage,
          executionTime,
          metadata: {
            nodeId: this.nodeId,
            workflowId: this.workflow.id,
          },
        })
      }
    }

    this.logger.info('Tool execution batch completed', {
      nodeId: this.nodeId,
      totalTools: toolCalls.length,
      successfulTools: results.filter(r => r.success).length,
      failedTools: results.filter(r => !r.success).length,
    })

    return results
  }
}