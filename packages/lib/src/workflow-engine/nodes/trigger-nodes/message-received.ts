// packages/lib/src/workflow-engine/nodes/trigger-nodes/message-received.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { ParticipantRole } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, TEST_RECORD_ID, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Static filter conditions for the MESSAGE_RECEIVED trigger, matched against the
 * inbound message at run time inside `MessageReceivedProcessor.applyFilters`.
 */
export interface MessageReceivedTriggerFilters {
  fromDomain?: string
  fromEmail?: string
  subjectContains?: string
  subjectMatches?: string
  bodyContains?: string
  isInbound?: boolean
  hasAttachments?: boolean
  integrationId?: string
}

/**
 * Config (`node.data`) for the MESSAGE_RECEIVED trigger node.
 */
export interface MessageReceivedTriggerConfig {
  filters?: MessageReceivedTriggerFilters
  /**
   * Soft-tier machine-mail handling (OOO auto-replies, list/notification mail).
   * `'exclude'` (the default when absent) skips this workflow for soft machine
   * mail; `'include'` opts it in. Hard-tier machine mail (bounces/NDRs) is always
   * skipped at the dispatcher regardless of this setting. Read by
   * `triggerMessageWorkflows` off the published graph — the runtime processor
   * does not re-check it (the dispatcher is the gate).
   */
  machineMail?: 'exclude' | 'include'
}

/** Output shape for the `message.attachments` node variable. */
interface MessageAttachmentOutput {
  name: string
  size: number
  type: string | null
  url: string | null
}

/**
 * Lazily resolve attachments for `message.attachments` — only queried when
 * `hasAttachments` is true. One row-listing query plus one `getDownloadInfo`
 * call per attachment (bounded by the message's own attachment count).
 * `getDownloadInfo` never throws on an unresolvable URL — it just returns
 * `url: undefined` — so a signing failure degrades to a null URL rather than
 * failing the trigger node.
 */
async function loadMessageAttachments(
  messageId: string,
  organizationId: string,
  userId: string | undefined,
  db: Database
): Promise<MessageAttachmentOutput[]> {
  const rows = await db
    .select({ id: schema.Attachment.id })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.entityType, 'MESSAGE'),
        eq(schema.Attachment.entityId, messageId),
        eq(schema.Attachment.organizationId, organizationId)
      )
    )
    .orderBy(schema.Attachment.sort)

  if (rows.length === 0) return []

  // Dynamic import — keeps this trigger node's static import graph free of
  // the storage-service dependency chain, matching `file-context-service.ts`'s
  // `refreshAttachmentUrl` precedent.
  const { AttachmentService } = await import('../../../files/core/attachment-service')
  const attachmentService = new AttachmentService(organizationId, userId, db)
  return Promise.all(
    rows.map(async (row) => {
      const info = await attachmentService.getDownloadInfo(row.id).catch(() => null)
      return {
        name: info?.filename ?? 'attachment',
        size: info?.size !== undefined ? Number(info.size) : 0,
        type: info?.mimeType ?? null,
        url: info?.url ?? null,
      }
    })
  )
}

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

    // `message.to` — derive from the hydrated MessageParticipant join rows
    // (populated by `loadProcessedMessage` for real triggers; empty for the
    // stale test-runner mock, which is fine — an empty recipients list).
    const toRecipients = (context.message.participants || [])
      .filter((p) => p.role === ParticipantRole.TO && p.participant)
      .map((p) => ({
        email: p.participant?.identifier || '',
        name: p.participant?.name || '',
      }))
    contextManager.setNodeVariable(node.nodeId, 'message.to', toRecipients)

    // `message.attachments` — lazy, only queried when the message actually
    // has attachments (see `loadMessageAttachments` above for the URL-
    // resolution fallback behavior).
    const attachments = context.message.hasAttachments
      ? await loadMessageAttachments(
          context.message.id,
          context.organizationId,
          context.userId,
          context.db ?? defaultDb
        )
      : []
    contextManager.setNodeVariable(node.nodeId, 'message.attachments', attachments)

    // Set thread-related variables — use TEST_RECORD_ID as fallback for test/manual mode
    const threadId = context.message.threadId || TEST_RECORD_ID
    const messageId = context.message.id || TEST_RECORD_ID
    contextManager.setVariable('threadId', threadId)

    // Set RELATION output variables using RecordId format (entityDefinitionId:entityInstanceId)
    contextManager.setNodeVariable(node.nodeId, 'thread', toRecordId('thread', threadId))
    contextManager.setNodeVariable(node.nodeId, 'message_ref', toRecordId('message', messageId))

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
        threadId: context.message.threadId,
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
