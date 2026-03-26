// packages/lib/src/workflow-engine/nodes/action-nodes/answer.ts

import { schema } from '@auxx/database'
import { IdentifierType, ParticipantRole } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { getDefinitionId, getInstanceId, isRecordId } from '@auxx/types/resource'
import { and, desc, eq } from 'drizzle-orm'
import { MessageSenderService } from '../../../messages/message-sender.service'
import type {
  ParticipantInput,
  SendMessageInput,
} from '../../../messages/types/message-sending.types'
import { ProviderRegistryService } from '../../../providers/provider-registry-service'
import { executeResourceQuery } from '../../../resources/resource-fetcher'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, TEST_RECORD_ID, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Configuration interface for Answer node
 */
interface AnswerNodeData {
  messageType: 'new' | 'reply' | 'replyAll'
  integrationId?: string
  recordId?: string // Format: "entityDefinitionId:id" (e.g. "thread:abc123")
  toIsAuto?: boolean
  ccIsAuto?: boolean
  bccIsAuto?: boolean
  subjectIsAuto?: boolean
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

    // Get messageType (default to 'reply' for backward compatibility)
    const messageType = config.messageType || 'reply'
    const isReply = messageType === 'reply' || messageType === 'replyAll'

    // 2. Resolve variables in text
    const resolvedText = await this.interpolateVariables(config.text, contextManager)

    // 3. Get thread context based on messageType
    let threadId: string | undefined
    let integrationId: string
    let resolvedSubject = ''
    let resolvedTo: string[] = []
    let resolvedCc: string[] = []
    let resolvedBcc: string[] = []

    if (isReply) {
      // Resolve recordId — supports both new format ("thread:abc") and legacy resourceId
      const rawRecordId = config.recordId
      if (!rawRecordId) {
        throw new Error('Reply target (recordId) is required for reply messages')
      }
      const resolvedRecordId = String(await this.resolveVariableValue(rawRecordId, contextManager))

      // Parse recordId to get entity type and instance id
      let resourceType: 'thread' | 'message'
      let resourceInstanceId: string

      if (isRecordId(resolvedRecordId as RecordId)) {
        const defId = getDefinitionId(resolvedRecordId as RecordId)
        resourceInstanceId = getInstanceId(resolvedRecordId as RecordId)
        if (defId === 'thread' || defId === 'message') {
          resourceType = defId
        } else {
          throw new Error(`Unsupported resource type in recordId: ${defId}`)
        }
      } else {
        // Fallback: treat plain ID as thread (backward compatibility)
        resourceType = 'thread'
        resourceInstanceId = resolvedRecordId
      }

      // Check for test sentinel — skip DB lookup and use context.message data
      if (resourceInstanceId === TEST_RECORD_ID) {
        contextManager.log('INFO', node.name, 'Test mode: using trigger message data for reply')
        threadId = undefined
        integrationId = context.message?.integrationId || config.integrationId || 'unknown'
        const baseSubject = context.message?.subject || 'Test message'

        if (config.subjectIsAuto !== false) {
          resolvedSubject = baseSubject.startsWith('Re:') ? baseSubject : `Re: ${baseSubject}`
        } else if (config.subject) {
          resolvedSubject = await this.interpolateVariables(config.subject, contextManager)
        }

        if (config.toIsAuto !== false) {
          resolvedTo = context.message?.from?.identifier ? [context.message.from.identifier] : []
        }

        if (messageType === 'replyAll' && config.ccIsAuto !== false) {
          // Use cc from context.message participants if available
          resolvedCc = []
        }
      } else {
        // Production path: fetch the real resource from DB
        const resource = await this.getResource(
          resourceInstanceId,
          resourceType,
          context.organizationId,
          context.db
        )

        if (!resource) {
          throw new Error(`${resourceType} not found: ${resourceInstanceId}`)
        }

        // Extract threadId and integrationId
        threadId = resourceType === 'thread' ? resource.id : resource.threadId
        integrationId = resource.integrationId

        // Auto-resolve subject
        if (config.subjectIsAuto !== false) {
          resolvedSubject = resource.subject?.startsWith('Re:')
            ? resource.subject
            : `Re: ${resource.subject || 'Your message'}`
        } else if (config.subject) {
          resolvedSubject = await this.interpolateVariables(config.subject, contextManager)
        }

        // Auto-resolve recipients from thread
        if (
          config.toIsAuto !== false ||
          (messageType === 'replyAll' && config.ccIsAuto !== false)
        ) {
          const participants = await this.getThreadParticipants(
            threadId,
            integrationId,
            context.organizationId,
            context.db
          )

          if (config.toIsAuto !== false) {
            resolvedTo = participants.sender ? [participants.sender] : []
          }

          if (messageType === 'replyAll' && config.ccIsAuto !== false) {
            resolvedCc = participants.otherRecipients
          }
        }
      }

      // Manually resolved fields override auto
      if (config.toIsAuto === false) {
        if (!config.to || config.to.length === 0) {
          throw new Error('At least one recipient is required')
        }
        resolvedTo = await this.resolveEmailArray(config.to, config.toModes, contextManager)
      }

      if (config.ccIsAuto === false && config.cc) {
        resolvedCc = await this.resolveEmailArray(config.cc, config.ccModes, contextManager)
      }

      if (config.bccIsAuto === false && config.bcc) {
        resolvedBcc = await this.resolveEmailArray(config.bcc, config.bccModes, contextManager)
      }
    } else {
      // New message
      if (!config.integrationId) {
        throw new Error('Integration ID is required for new messages')
      }
      integrationId = config.integrationId
      threadId = undefined

      if (!config.to || config.to.length === 0) {
        throw new Error('At least one recipient is required')
      }

      resolvedTo = await this.resolveEmailArray(config.to, config.toModes, contextManager)
      resolvedCc = config.cc
        ? await this.resolveEmailArray(config.cc, config.ccModes, contextManager)
        : []
      resolvedBcc = config.bcc
        ? await this.resolveEmailArray(config.bcc, config.bccModes, contextManager)
        : []

      if (!config.subject?.trim()) {
        throw new Error('Subject is required for new messages')
      }
      resolvedSubject = await this.interpolateVariables(config.subject, contextManager)
    }

    // Ensure we have at least one recipient
    if (resolvedTo.length === 0) {
      throw new Error('No recipients resolved — at least one To address is required')
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

    // 5. Check debug mode — skip actual send in test runs
    const isDryRun = contextManager.isDebugMode()

    if (isDryRun) {
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

      const fakeMessageId = `dry-run-${node.nodeId}-${Date.now()}`
      const fakeThreadId = threadId || `dry-run-thread-${Date.now()}`

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
          dryRun: true,
          messageId: fakeMessageId,
          threadId: fakeThreadId,
          messageType,
          integrationId,
          subject: resolvedSubject || undefined,
          to: resolvedTo,
          cc: resolvedCc.length > 0 ? resolvedCc : undefined,
          bcc: resolvedBcc.length > 0 ? resolvedBcc : undefined,
          text: resolvedText,
        },
        outputHandle: 'source',
      }
    }

    // 6. Send message via MessageSenderService
    try {
      const providerRegistry = new ProviderRegistryService(context.organizationId)
      const messageSender = new MessageSenderService(
        context.organizationId,
        providerRegistry,
        context.db
      )

      const sendInput: SendMessageInput = {
        userId: context.userId,
        organizationId: context.organizationId,
        integrationId,
        threadId,
        subject: resolvedSubject,
        textPlain: resolvedText,
        textHtml: undefined,
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
      const isConstant = modes?.[i] ?? false

      if (isConstant) {
        resolved.push(email)
      } else {
        const resolvedEmail = await this.interpolateVariables(email, contextManager)

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
   * Get thread participants for auto-resolving recipients.
   * Finds the latest inbound message in the thread and extracts sender + other recipients,
   * filtering out the integration's own email address.
   */
  private async getThreadParticipants(
    threadId: string,
    integrationId: string,
    organizationId: string,
    db: any
  ): Promise<{
    sender: string | null
    otherRecipients: string[]
  }> {
    // Get the integration's email to filter it out from recipients
    const integration = await db
      .select({ email: schema.Integration.email })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    const integrationEmail = integration[0]?.email?.toLowerCase()

    // Get the latest inbound message in this thread
    const latestMessage = await db
      .select({ id: schema.Message.id })
      .from(schema.Message)
      .where(and(eq(schema.Message.threadId, threadId), eq(schema.Message.isInbound, true)))
      .orderBy(desc(schema.Message.receivedAt))
      .limit(1)

    if (!latestMessage[0]) {
      return { sender: null, otherRecipients: [] }
    }

    // Get all participants on this message with their roles
    const messageParticipants = await db
      .select({
        role: schema.MessageParticipant.role,
        identifier: schema.Participant.identifier,
      })
      .from(schema.MessageParticipant)
      .innerJoin(
        schema.Participant,
        eq(schema.MessageParticipant.participantId, schema.Participant.id)
      )
      .where(eq(schema.MessageParticipant.messageId, latestMessage[0].id))

    let sender: string | null = null
    const otherRecipients: string[] = []
    const seen = new Set<string>()

    for (const p of messageParticipants) {
      const email = p.identifier?.toLowerCase()
      if (!email || seen.has(email)) continue
      // Skip the integration's own email
      if (integrationEmail && email === integrationEmail) continue
      seen.add(email)

      if (p.role === ParticipantRole.FROM) {
        sender = p.identifier
      } else if (p.role === ParticipantRole.TO || p.role === ParticipantRole.CC) {
        otherRecipients.push(p.identifier)
      }
    }

    return { sender, otherRecipients }
  }

  /**
   * Extract variables from all fields that support variable references
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as AnswerNodeData
    const variables = new Set<string>()

    if (config.text) {
      this.extractVariableIds(config.text).forEach((v) => variables.add(v))
    }

    if (config.subject && config.subjectIsAuto === false) {
      this.extractVariableIds(config.subject).forEach((v) => variables.add(v))
    }

    if (config.recordId) {
      this.extractVariableIds(config.recordId).forEach((v) => variables.add(v))
    }

    const extractFromEmailArray = (emails: string[] | undefined, modes: boolean[] | undefined) => {
      if (!emails) return
      emails.forEach((email, i) => {
        const isConstant = modes?.[i] ?? true
        if (!isConstant) {
          this.extractVariableIds(email).forEach((v) => variables.add(v))
        }
      })
    }

    if (config.toIsAuto === false) {
      extractFromEmailArray(config.to, config.toModes)
    }
    if (config.ccIsAuto === false) {
      extractFromEmailArray(config.cc, config.ccModes)
    }
    if (config.bccIsAuto === false) {
      extractFromEmailArray(config.bcc, config.bccModes)
    }

    return Array.from(variables)
  }

  /**
   * Validate node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as AnswerNodeData

    if (!config.text?.trim()) {
      errors.push('Message text is required')
    }

    const messageType = config.messageType || 'reply'
    const isReply = messageType === 'reply' || messageType === 'replyAll'

    if (messageType === 'new') {
      if (!config.integrationId) {
        errors.push('Integration is required for new messages')
      }
      if (!config.subject?.trim()) {
        errors.push('Subject is required for new messages')
      }
      if (!config.to || config.to.length === 0) {
        errors.push('At least one recipient is required')
      }
    } else if (isReply) {
      if (!config.recordId) {
        errors.push('Reply target (recordId) is required for replies')
      }
      // To only required when not auto-resolved
      if (config.toIsAuto === false && (!config.to || config.to.length === 0)) {
        errors.push('At least one recipient is required when To is in manual mode')
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
