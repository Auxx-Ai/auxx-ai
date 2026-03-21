// packages/lib/src/workflow-engine/nodes/trigger-nodes/message-received.ts

import { toRecordId } from '@auxx/types/resource'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Trigger node that activates when a message is received
 * This node serves as an entry point for message-based workflows
 */
export class MessageReceivedProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.MESSAGE_RECEIVED

  /**
   * Extract required variables from node configuration
   * Trigger nodes don't use upstream variables as they start workflows
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Message received trigger nodes start workflows and don't depend on upstream variables
    // Filters are static and don't support variable interpolation
    return []
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const context = contextManager.getContext()

    // Check if we have a message to process
    if (!context.message) {
      throw new Error('No message found in execution context')
    }

    contextManager.log('INFO', node.name, 'Message trigger activated', {
      messageId: context.message.id,
      subject: context.message.subject,
      from: context.message.from?.identifier,
    })

    // Set message-related variables in context (legacy global variables)
    contextManager.setVariable('messageId', context.message.id)
    contextManager.setVariable('messageSubject', context.message.subject || '')
    contextManager.setVariable('messageFrom', context.message.from?.identifier || '')
    contextManager.setVariable(
      'messageBody',
      context.message.textPlain || context.message.textHtml || ''
    )
    contextManager.setVariable('messageSnippet', context.message.snippet || '')
    contextManager.setVariable('isInbound', context.message.isInbound)
    contextManager.setVariable('hasAttachments', context.message.hasAttachments)

    // Set node-scoped message output variables (matching frontend output variable definitions)
    contextManager.setNodeVariable(node.nodeId, 'message.id', context.message.id)
    contextManager.setNodeVariable(node.nodeId, 'message.thread_id', context.message.threadId || '')
    contextManager.setNodeVariable(node.nodeId, 'message.subject', context.message.subject || '')
    contextManager.setNodeVariable(
      node.nodeId,
      'message.body',
      context.message.textPlain || context.message.textHtml || ''
    )
    contextManager.setNodeVariable(node.nodeId, 'message.html', context.message.textHtml || '')
    contextManager.setNodeVariable(
      node.nodeId,
      'message.received_at',
      context.message.receivedAt || new Date().toISOString()
    )
    contextManager.setNodeVariable(
      node.nodeId,
      'message.has_attachments',
      context.message.hasAttachments
    )
    if (context.message.from) {
      contextManager.setNodeVariable(
        node.nodeId,
        'message.from.email',
        context.message.from.identifier || ''
      )
      contextManager.setNodeVariable(
        node.nodeId,
        'message.from.name',
        context.message.from.name || ''
      )
    }

    // Set thread-related variables if available
    if (context.message.threadId) {
      contextManager.setVariable('threadId', context.message.threadId)
    }

    // Set RELATION output variables using RecordId format (entityDefinitionId:entityInstanceId)
    if (context.message.threadId) {
      contextManager.setNodeVariable(
        node.nodeId,
        'thread',
        toRecordId('thread', context.message.threadId)
      )
    }
    contextManager.setNodeVariable(
      node.nodeId,
      'message_ref',
      toRecordId('message', context.message.id)
    )

    // Set organization context
    contextManager.setVariable('organizationId', context.organizationId)

    // Apply any filters from node data
    const data = node.data
    if (data.filters) {
      const passesFilters = await this.applyFilters(data.filters, context.message, contextManager)
      if (!passesFilters) {
        contextManager.log('INFO', node.name, 'Message filtered out by trigger conditions')
        return {
          status: NodeRunningStatus.Skipped,
          output: { filtered: true, reason: 'Did not pass trigger filters' },
        }
      }
    }

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        messageId: context.message.id,
        subject: context.message.subject,
        triggeredAt: new Date(),
      },
      outputHandle: 'source', // Standard output for trigger nodes
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const data = node.data

    // Validate filters if present
    if (data.filters) {
      if (typeof data.filters !== 'object') {
        errors.push('Filters must be an object')
      } else {
        // Validate individual filter conditions
        for (const [key, value] of Object.entries(data.filters)) {
          if (!this.isValidFilterCondition(key, value)) {
            warnings.push(`Potentially invalid filter condition: ${key}`)
          }
        }
      }
    }

    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Apply filters to determine if the message should trigger the workflow
   */
  private async applyFilters(
    filters: Record<string, any>,
    message: any,
    contextManager: ExecutionContextManager
  ): Promise<boolean> {
    for (const [filterType, filterValue] of Object.entries(filters)) {
      const passed = await this.applyFilter(filterType, filterValue, message, contextManager)
      if (!passed) {
        contextManager.log('DEBUG', undefined, `Message failed filter: ${filterType}`, {
          filterValue,
          messageValue: this.getMessageValue(filterType, message),
        })
        return false
      }
    }
    return true
  }

  /**
   * Apply a single filter condition
   */
  private async applyFilter(
    filterType: string,
    filterValue: any,
    message: any,
    contextManager: ExecutionContextManager
  ): Promise<boolean> {
    const messageValue = this.getMessageValue(filterType, message)

    switch (filterType) {
      case 'fromDomain':
        return this.matchesDomain(message.from?.identifier, filterValue)

      case 'fromEmail':
        return this.matchesEmail(message.from?.identifier, filterValue)

      case 'subjectContains':
        return this.containsText(message.subject, filterValue)

      case 'subjectMatches':
        return this.matchesPattern(message.subject, filterValue)

      case 'bodyContains': {
        const bodyText = message.textPlain || message.textHtml || ''
        return this.containsText(bodyText, filterValue)
      }

      case 'isInbound':
        return message.isInbound === filterValue

      case 'hasAttachments':
        return message.hasAttachments === filterValue

      case 'integrationId':
        return message.integrationId === filterValue

      default:
        contextManager.log('WARN', undefined, `Unknown filter type: ${filterType}`)
        return true // Unknown filters pass by default
    }
  }

  /**
   * Get message value for a filter type
   */
  private getMessageValue(filterType: string, message: any): any {
    switch (filterType) {
      case 'fromDomain':
      case 'fromEmail':
        return message.from?.identifier
      case 'subjectContains':
      case 'subjectMatches':
        return message.subject
      case 'bodyContains':
        return message.textPlain || message.textHtml
      case 'isInbound':
        return message.isInbound
      case 'hasAttachments':
        return message.hasAttachments
      case 'integrationId':
        return message.integrationId
      default:
        return undefined
    }
  }

  /**
   * Check if email domain matches filter
   */
  private matchesDomain(email: string | undefined, domain: string): boolean {
    if (!email || !domain) return false
    const emailDomain = email.split('@')[1]
    return emailDomain?.toLowerCase() === domain.toLowerCase()
  }

  /**
   * Check if email matches filter (exact or pattern)
   */
  private matchesEmail(email: string | undefined, filter: string): boolean {
    if (!email || !filter) return false

    if (filter.includes('*')) {
      // Simple wildcard matching
      const pattern = filter.replace(/\*/g, '.*')
      const regex = new RegExp(`^${pattern}$`, 'i')
      return regex.test(email)
    }

    return email.toLowerCase() === filter.toLowerCase()
  }

  /**
   * Check if text contains the filter value
   */
  private containsText(text: string | undefined, filter: string): boolean {
    if (!text || !filter) return false
    return text.toLowerCase().includes(filter.toLowerCase())
  }

  /**
   * Check if text matches a pattern (regex or simple wildcard)
   */
  private matchesPattern(text: string | undefined, pattern: string): boolean {
    if (!text || !pattern) return false

    try {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Regex pattern
        const regex = new RegExp(pattern.slice(1, -1), 'i')
        return regex.test(text)
      } else if (pattern.includes('*')) {
        // Simple wildcard
        const regexPattern = pattern.replace(/\*/g, '.*')
        const regex = new RegExp(`^${regexPattern}$`, 'i')
        return regex.test(text)
      } else {
        // Exact match
        return text.toLowerCase().includes(pattern.toLowerCase())
      }
    } catch (error) {
      // Invalid regex, fall back to simple contains
      return text.toLowerCase().includes(pattern.toLowerCase())
    }
  }

  /**
   * Validate if a filter condition is valid
   */
  private isValidFilterCondition(key: string, value: any): boolean {
    const validFilters = [
      'fromDomain',
      'fromEmail',
      'subjectContains',
      'subjectMatches',
      'bodyContains',
      'isInbound',
      'hasAttachments',
      'integrationId',
    ]

    return validFilters.includes(key) && value !== undefined && value !== null
  }
}
