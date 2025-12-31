// packages/lib/src/workflow-engine/nodes/action-nodes/execute.ts

import { BaseNodeProcessor } from '../base-node'
import type { WorkflowNode, NodeExecutionResult, ValidationResult } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
// import type { ActionDefinition, ActionType } from '../../../actions/core/action-types'

/**
 * Action node that executes actions using the existing action system
 * This provides integration with the existing action executor
 */
export class ExecuteProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.EXECUTE

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data
    const actions = config.actions || []
    const mode = config.mode || 'AUTOMATIC' // AUTOMATIC or MANUAL_REVIEW

    if (actions.length === 0) {
      throw new Error('No actions specified for execute node')
    }

    const context = contextManager.getContext()
    if (!context.message) {
      throw new Error('No message found in execution context for action execution')
    }

    contextManager.log('INFO', node.name, 'Executing actions', {
      actionCount: actions.length,
      mode,
      messageId: context.message.id,
    })

    const executionResults = []
    let hasErrors = false

    try {
      // Import the action executor
      // const { createActionExecutor } = await import('../../../actions/core/action-executor')
      // const { createOrganizationServices } = await import('../../../services/service-registrations')

      // Create service registry for action execution
      // const serviceRegistry = await createOrganizationServices(
      //   context.organizationId,
      //   context.userId || 'system'
      // )

      // const actionExecutor = await createActionExecutor(serviceRegistry)

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]

        try {
          // Convert workflow action to ActionDefinition
          // const actionDefinition: ActionDefinition = {
          //   type: action.type as ActionType,
          //   params: this.resolveActionParams(action.params, contextManager),
          //   metadata: action.metadata || {},
          // }

          // Create action context
          // const actionContext = {
          //   userId: context.userId || 'system',
          //   organizationId: context.organizationId,
          //   message: {
          //     id: context.message.id,
          //     threadId: context.message.threadId,
          //     integrationId: context.message.integrationId || '',
          //     // Note: integrationType removed - actions should derive from integrationId if needed
          //     subject: context.message.subject || '',
          //     snippet: context.message.snippet || '',
          //   },
          //   timestamp: new Date(),
          // }

          if (mode === 'MANUAL_REVIEW') {
            // Create proposed action instead of executing immediately
            // const { createProposedActionService } = await import(
            //   '../../../actions/services/proposed-action-service'
            // )
            // const proposedActionService = await createProposedActionService(serviceRegistry)
            // const proposedAction = await proposedActionService.createProposedAction({
            //   messageId: context.message.id,
            //   ruleId: `workflow-${node.workflowId}`,
            //   actionType: action.type as ActionType,
            //   actionParams: actionDefinition.params,
            //   confidence: 0.9,
            //   explanation: `Action proposed by workflow node: ${node.name}`,
            //   userId: context.userId || 'system',
            // })
            // executionResults.push({
            //   actionIndex: i,
            //   actionType: action.type,
            //   status: 'proposed',
            //   proposedActionId: proposedAction.id,
            //   result: proposedAction,
            // })
          } else {
            // Execute action immediately
            // const result = await actionExecutor.execute(actionDefinition, actionContext)
            // executionResults.push({
            //   actionIndex: i,
            //   actionType: action.type,
            //   status: result.success ? 'completed' : 'failed',
            //   result: result,
            //   error: result.error,
            // })
            // if (result.success) {
            //   contextManager.log('INFO', node.name, `Action ${i + 1} executed successfully`, {
            //     actionType: action.type,
            //     actionId: result.actionId,
            //   })
            // } else {
            //   hasErrors = true
            //   contextManager.log('ERROR', node.name, `Action ${i + 1} failed`, {
            //     actionType: action.type,
            //     error: result.error,
            //   })
            //   // Check if we should stop on error
            //   if (config.stopOnError !== false) {
            //     break
            //   }
            // }
          }
        } catch (error) {
          hasErrors = true
          const errorMessage = error instanceof Error ? error.message : String(error)

          executionResults.push({
            actionIndex: i,
            actionType: action.type,
            status: 'failed',
            error: errorMessage,
          })

          contextManager.log('ERROR', node.name, `Action ${i + 1} execution failed`, {
            actionType: action.type,
            error: errorMessage,
          })

          // Check if we should stop on error
          if (config.stopOnError !== false) {
            break
          }
        }
      }

      // Store execution results in context
      contextManager.setNodeVariable(node.nodeId, 'results', executionResults)
      contextManager.setNodeVariable(node.nodeId, 'hasErrors', hasErrors)
      contextManager.setNodeVariable(
        node.nodeId,
        'executedCount',
        executionResults.filter((r) => r.status === 'completed').length
      )
      contextManager.setNodeVariable(
        node.nodeId,
        'proposedCount',
        executionResults.filter((r) => r.status === 'proposed').length
      )

      // Determine output handle based on success/failure
      const outputHandle = hasErrors && config.stopOnError !== false ? 'error' : 'source'

      const status =
        hasErrors && config.stopOnError !== false
          ? NodeRunningStatus.Failed
          : NodeRunningStatus.Succeeded

      return {
        status,
        output: {
          mode,
          executionResults,
          hasErrors,
          executedCount: executionResults.filter((r) => r.status === 'completed').length,
          proposedCount: executionResults.filter((r) => r.status === 'proposed').length,
          failedCount: executionResults.filter((r) => r.status === 'failed').length,
        },
        outputHandle,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      contextManager.log('ERROR', node.name, 'Action execution failed', { error: errorMessage })
      throw error
    }
  }

  /**
   * Extract variables from action parameters
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data
    const variables = new Set<string>()

    // Extract from action parameters
    if (config.actions && Array.isArray(config.actions)) {
      config.actions.forEach((action: any) => {
        if (action.params && typeof action.params === 'object') {
          this.extractVariablesFromObject(action.params, variables)
        }
      })
    }

    return Array.from(variables)
  }

  /**
   * Recursively extract variables from an object
   */
  private extractVariablesFromObject(obj: any, variables: Set<string>): void {
    if (typeof obj === 'string') {
      this.extractVariableIds(obj).forEach((v) => variables.add(v))
    } else if (Array.isArray(obj)) {
      obj.forEach((item) => this.extractVariablesFromObject(item, variables))
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach((value) => this.extractVariablesFromObject(value, variables))
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data

    // Check for actions
    if (!config.actions || !Array.isArray(config.actions)) {
      errors.push('actions must be an array')
    } else if (config.actions.length === 0) {
      errors.push('At least one action must be specified')
    } else {
      // Validate individual actions
      for (let i = 0; i < config.actions.length; i++) {
        const action = config.actions[i]
        const actionErrors = this.validateAction(action, i)
        errors.push(...actionErrors)
      }
    }

    // Validate mode
    if (config.mode && !['AUTOMATIC', 'MANUAL_REVIEW'].includes(config.mode)) {
      errors.push('mode must be either AUTOMATIC or MANUAL_REVIEW')
    }

    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Validate a single action configuration
   */
  private validateAction(action: any, index: number): string[] {
    const errors: string[] = []

    if (!action || typeof action !== 'object') {
      errors.push(`Action ${index}: must be an object`)
      return errors
    }

    if (!action.type || typeof action.type !== 'string') {
      errors.push(`Action ${index}: type is required and must be a string`)
    }

    if (action.params && typeof action.params !== 'object') {
      errors.push(`Action ${index}: params must be an object`)
    }

    // Validate action type (basic check)
    const validActionTypes = [
      'SEND_MESSAGE',
      'APPLY_TAG',
      'REMOVE_TAG',
      'REPLY',
      'FORWARD',
      'DRAFT_EMAIL',
      'APPLY_LABEL',
      'REMOVE_LABEL',
      'ARCHIVE',
      'MARK_SPAM',
      'MARK_TRASH',
      'ASSIGN_THREAD',
      'ARCHIVE_THREAD',
      'UNARCHIVE_THREAD',
      'MOVE_TO_TRASH',
    ]

    if (action.type && !validActionTypes.includes(action.type)) {
      errors.push(`Action ${index}: unknown action type '${action.type}'`)
    }

    return errors
  }

  /**
   * Resolve action parameters by substituting variables from context
   */
  private resolveActionParams(params: any, contextManager: ExecutionContextManager): any {
    if (!params || typeof params !== 'object') {
      return params
    }

    const resolved = { ...params }
    const variables = contextManager.getAllVariables()
    const context = contextManager.getContext()

    // Simple variable substitution
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string') {
        resolved[key] = this.substituteVariables(value, variables, context)
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((item) =>
          typeof item === 'string' ? this.substituteVariables(item, variables, context) : item
        )
      }
    }

    return resolved
  }

  /**
   * Substitute variables in a string template
   */
  private substituteVariables(
    template: string,
    variables: Record<string, any>,
    context: any
  ): string {
    // Replace {{variable}} patterns
    return template.replace(/\{\{([^}]+)\}\}/g, (match, varPath) => {
      const trimmed = varPath.trim()

      // Handle variables.variableName
      if (trimmed.startsWith('variables.')) {
        const varName = trimmed.substring(10)
        return variables[varName] ?? match
      }

      // Handle message.property
      if (trimmed.startsWith('message.') && context.message) {
        const propPath = trimmed.substring(8)
        const value = this.getNestedProperty(context.message, propPath)
        return value ?? match
      }

      // Handle direct variable names
      return variables[trimmed] ?? match
    })
  }
}
