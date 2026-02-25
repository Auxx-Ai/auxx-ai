// packages/lib/src/workflow-engine/nodes/action-nodes/answer.ts

import { schema } from '@auxx/database'
import { IdentifierType } from '@auxx/database/enums'
import { eq } from 'drizzle-orm'
import { MessageSenderService } from '../../../messages/message-sender.service'
import type {
  ParticipantInput,
  SendMessageInput,
} from '../../../messages/types/message-sending.types'
import { ProviderRegistryService } from '../../../providers/provider-registry-service'
import { executeResourceQuery } from '../../../resources/resource-fetcher'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Configuration interface for Answer node
 */
interface AnswerNodeData {
  messageType: 'new' | 'reply'
  integrationId?: string
  resourceType?: 'thread' | 'message'
  resourceId?: string
  to?: string[]
  toModes?: boolean[]
  cc?: string[]
  ccModes?: boolean[]
  bcc?: string[]
  bccModes?: boolean[]
  text: string
  subject?: string
  attachments?: Array<{ name: string; url: string }>
  attachmentFiles?: string[]
  attachmentFilesModes?: boolean[]
}

/**
 * Answer node that sends email responses (new messages or replies)
 */
export class AnswerProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.ANSWER

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as AnswerNodeData
    const context = contextManager.getContext()

    // 1. Validate required fields
    if (!config.text) {
      throw new Error('Message text is required')
    }

    if (!config.to || config.to.length === 0) {
      throw new Error('At least one recipient is required')
    }

    // Get messageType (default to 'reply' for backward compatibility)
    const messageType = config.messageType || 'reply'

    // 2. Resolve variables in all fields
    const resolvedText = await this.interpolateVariables(config.text, contextManager)

    // Resolve subject
    let resolvedSubject: string
    if (config.subject) {
      resolvedSubject = await this.interpolateVariables(config.subject, contextManager)
    } else if (messageType === 'new') {
      throw new Error('Subject is required for new messages')
    } else {
      resolvedSubject = '' // Will be set from thread
    }

    // Resolve resourceId for replies
    let resolvedResourceId: string | undefined
    if (messageType === 'reply') {
      if (!config.resourceId) {
        throw new Error('Resource ID is required for reply messages')
      }
      resolvedResourceId = await this.interpolateVariables(config.resourceId, contextManager)
    }

    // Resolve email recipients
    const resolvedTo = await this.resolveEmailArray(config.to, config.toModes, contextManager)
    const resolvedCc = config.cc
      ? await this.resolveEmailArray(config.cc, config.ccModes, contextManager)
      : []
    const resolvedBcc = config.bcc
      ? await this.resolveEmailArray(config.bcc, config.bccModes, contextManager)
      : []

    // 3. Get thread context based on messageType
    let threadId: string | undefined
    let integrationId: string

    if (messageType === 'reply') {
      if (!config.resourceType) {
        throw new Error('Resource type is required for reply messages')
      }

      // Fetch the specific resource type directly (no guessing!)
      const resource = await this.getResource(
        resolvedResourceId!,
        config.resourceType,
        context.organizationId,
        context.db
      )

      if (!resource) {
        throw new Error(`${config.resourceType} not found: ${resolvedResourceId}`)
      }

      // Extract threadId and integrationId based on type
      threadId = config.resourceType === 'thread' ? resource.id : resource.threadId
      integrationId = resource.integrationId

      // If no subject provided, use thread subject with "Re:" prefix
      if (!config.subject) {
        resolvedSubject = resource.subject?.startsWith('Re:')
          ? resource.subject
          : `Re: ${resource.subject || 'Your message'}`
      }
    } else {
      // New message
      if (!config.integrationId) {
        throw new Error('Integration ID is required for new messages')
      }
      integrationId = config.integrationId
      threadId = undefined // Will be created by MessageSenderService
    }

    // 4. Process recipients - convert email strings to ParticipantInput format
    const toParticipants: ParticipantInput[] = resolvedTo.map((email) => ({
      identifier: email,
      identifierType: IdentifierType.EMAIL,
      name: undefined,
    }))

    const ccParticipants: ParticipantInput[] | undefined =
      resolvedCc.length > 0
        ? resolvedCc.map((email) => ({
            identifier: email,
            identifierType: IdentifierType.EMAIL,
            name: undefined,
          }))
        : undefined

    const bccParticipants: ParticipantInput[] | undefined =
      resolvedBcc.length > 0
        ? resolvedBcc.map((email) => ({
            identifier: email,
            identifierType: IdentifierType.EMAIL,
            name: undefined,
          }))
        : undefined

    // 5. Check dry run mode
    const isDryRun = contextManager.getOptions()?.dryRun

    if (isDryRun) {
      // Dry run: Log and skip actual sending
      contextManager.log('INFO', node.name, 'DryRun: Skipping message send', {
        messageType,
        integrationId,
        threadId,
        subject: resolvedSubject,
        toCount: toParticipants.length,
        ccCount: ccParticipants?.length || 0,
        bccCount: bccParticipants?.length || 0,
        textLength: resolvedText.length,
      })

      // Generate fake IDs for dry run
      const fakeMessageId = `dry-run-${node.nodeId}-${Date.now()}`
      const fakeThreadId = threadId || `dry-run-thread-${Date.now()}`

      // Set output variables
      contextManager.setNodeVariable(node.nodeId, 'sent', true)
      contextManager.setNodeVariable(node.nodeId, 'message_id', fakeMessageId)
      contextManager.setNodeVariable(node.nodeId, 'thread_id', fakeThreadId)
      contextManager.setNodeVariable(node.nodeId, 'timestamp', new Date().toISOString())
      contextManager.setNodeVariable(node.nodeId, 'integration_id', integrationId)
      contextManager.setNodeVariable(node.nodeId, 'message_type', messageType)

      return {
        status: NodeRunningStatus.Succeeded,
        output: {
          sent: true,
          messageId: fakeMessageId,
          threadId: fakeThreadId,
          dryRun: true,
        },
        outputHandle: 'source',
      }
    }

    // 6. Send message via MessageSenderService
    try {
      // Initialize MessageSenderService
      const providerRegistry = new ProviderRegistryService(context.organizationId)
      const messageSender = new MessageSenderService(
        context.organizationId,
        providerRegistry,
        context.db
      )

      // Prepare SendMessageInput
      const sendInput: SendMessageInput = {
        userId: context.userId,
        organizationId: context.organizationId,
        integrationId,
        threadId, // undefined for new messages
        subject: resolvedSubject,
        textPlain: resolvedText,
        textHtml: undefined, // Could convert markdown to HTML in future
        to: toParticipants,
        cc: ccParticipants,
        bcc: bccParticipants,
        signatureId: undefined,
        draftMessageId: undefined,
      }

      contextManager.log('INFO', node.name, 'Sending message', {
        messageType,
        integrationId,
        threadId,
        subject: resolvedSubject,
        recipientCount: toParticipants.length,
      })

      // Send message
      const result = await messageSender.sendMessage(sendInput)

      contextManager.log('INFO', node.name, 'Message sent successfully', {
        messageId: result.id,
        threadId: result.threadId,
      })

      // 7. Set output variables for downstream nodes
      contextManager.setNodeVariable(node.nodeId, 'sent', true)
      contextManager.setNodeVariable(node.nodeId, 'message_id', result.id)
      contextManager.setNodeVariable(node.nodeId, 'thread_id', result.threadId)
      contextManager.setNodeVariable(node.nodeId, 'timestamp', new Date().toISOString())
      contextManager.setNodeVariable(node.nodeId, 'integration_id', integrationId)
      contextManager.setNodeVariable(node.nodeId, 'message_type', messageType)

      return {
        status: NodeRunningStatus.Succeeded,
        output: {
          sent: true,
          messageId: result.id,
          threadId: result.threadId,
          timestamp: new Date().toISOString(),
          recipientCount:
            toParticipants.length + (ccParticipants?.length || 0) + (bccParticipants?.length || 0),
        },
        metadata: {
          messageType,
          integrationId,
          dryRun: false,
        },
        outputHandle: 'source',
      }
    } catch (error) {
      contextManager.log('ERROR', node.name, 'Failed to send message', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Resolve an array of email addresses, handling both constants and variables
   */
  private async resolveEmailArray(
    emails: string[],
    modes: boolean[] | undefined,
    contextManager: ExecutionContextManager
  ): Promise<string[]> {
    const resolved: string[] = []

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i]
      const isConstant = modes?.[i] ?? false // Default to variable mode

      if (isConstant) {
        // Constant mode: email is a literal string
        resolved.push(email)
      } else {
        // Variable mode: email is a variable reference like {{variableId}}
        const resolvedEmail = await this.interpolateVariables(email, contextManager)

        // Validate that it's a valid email
        if (!this.isValidEmail(resolvedEmail)) {
          throw new Error(`Invalid email address: ${resolvedEmail}`)
        }

        resolved.push(resolvedEmail)
      }
    }

    return resolved
  }

  /**
   * Basic email validation
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  /**
   * Fetch specific resource type from database
   * No guessing - we know the type from frontend selection!
   */
  private async getResource(
    resourceId: string,
    resourceType: 'thread' | 'message',
    organizationId: string,
    db: any
  ): Promise<{
    id: string
    threadId: string
    integrationId: string
    subject?: string | null
  } | null> {
    if (resourceType === 'thread') {
      const thread = await executeResourceQuery(
        'thread',
        organizationId,
        {
          where: eq(schema.Thread.id, resourceId),
          limit: 1,
        },
        'findOne'
      )

      if (!thread) return null

      return {
        id: thread.id,
        threadId: thread.id,
        integrationId: thread.integrationId,
        subject: thread.subject,
      }
    } else {
      // resourceType === 'message'
      const message = await executeResourceQuery(
        'message',
        organizationId,
        {
          where: eq(schema.Message.id, resourceId),
          limit: 1,
        },
        'findOne'
      )

      if (!message) return null

      return {
        id: message.id,
        threadId: message.threadId,
        integrationId: message.integrationId,
        subject: message.subject,
      }
    }
  }

  /**
   * Extract variables from all fields that support variable references
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as AnswerNodeData
    const variables = new Set<string>()

    // Extract from text
    if (config.text) {
      this.extractVariableIds(config.text).forEach((v) => variables.add(v))
    }

    // Extract from subject
    if (config.subject) {
      this.extractVariableIds(config.subject).forEach((v) => variables.add(v))
    }

    // Extract from resourceId (for replies)
    if (config.resourceId) {
      this.extractVariableIds(config.resourceId).forEach((v) => variables.add(v))
    }

    // Extract from email arrays
    const extractFromEmailArray = (emails: string[] | undefined, modes: boolean[] | undefined) => {
      if (!emails) return
      emails.forEach((email, i) => {
        const isConstant = modes?.[i] ?? true
        if (!isConstant) {
          // Only extract if in variable mode
          this.extractVariableIds(email).forEach((v) => variables.add(v))
        }
      })
    }

    extractFromEmailArray(config.to, config.toModes)
    extractFromEmailArray(config.cc, config.ccModes)
    extractFromEmailArray(config.bcc, config.bccModes)

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as AnswerNodeData

    // Validate text content
    if (!config.text?.trim()) {
      errors.push('Message text is required')
    }

    // Validate recipients
    if (!config.to || config.to.length === 0) {
      errors.push('At least one recipient is required')
    }

    // Validate messageType-specific requirements
    const messageType = config.messageType || 'reply'

    if (messageType === 'new') {
      if (!config.integrationId) {
        errors.push('Integration is required for new messages')
      }
      if (!config.subject?.trim()) {
        errors.push('Subject is required for new messages')
      }
    } else if (messageType === 'reply') {
      if (!config.resourceId) {
        errors.push('Resource ID (thread or message) is required for replies')
      }
      if (!config.resourceType) {
        errors.push('Resource type (thread or message) is required for replies')
      }
    }

    // Validate email arrays have matching modes arrays
    if (config.to && config.toModes && config.to.length !== config.toModes.length) {
      warnings.push('To addresses and modes array length mismatch')
    }

    if (config.cc && config.ccModes && config.cc.length !== config.ccModes.length) {
      warnings.push('CC addresses and modes array length mismatch')
    }

    if (config.bcc && config.bccModes && config.bcc.length !== config.bccModes.length) {
      warnings.push('BCC addresses and modes array length mismatch')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
