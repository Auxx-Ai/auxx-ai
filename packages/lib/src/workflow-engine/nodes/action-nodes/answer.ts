// packages/lib/src/workflow-engine/nodes/action-nodes/answer.ts

import { schema } from '@auxx/database'
import { IdentifierType, ParticipantRole } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { getDefinitionId, getInstanceId, isRecordId } from '@auxx/types/resource'
import { and, desc, eq } from 'drizzle-orm'
import { DraftService } from '../../../drafts/draft-service'
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
  saveAsDraft?: boolean
  /**
   * Per-node send behavior override (mirrors the human-in-the-loop node's Test Mode).
   * - 'default': send in production, dry-run in builder test runs
   * - 'live': always really send, even in test runs
   * - 'dry_run': never send, trace-only
   * - 'draft': persist as a thread draft instead of sending
   */
  test_behavior?: 'default' | 'live' | 'dry_run' | 'draft'
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

        // Look up the latest inbound message once. It backs both the machine-mail refusal
        // backstop (which applies regardless of To auto/manual) and participant auto-resolution
        // (which only runs when To/Cc are auto) — so the query never runs twice.
        const latestInbound = await this.getLatestInboundMessage(threadId, context.db)

        // Hard-tier refusal backstop: never auto-reply into a thread whose latest inbound
        // message is machine-generated mail (bounces/NDRs). This runs before composing or
        // sending on BOTH the auto-To and manual-To paths, and regardless of any
        // trigger-level machine-mail opt-in. You can run a workflow on a bounce; you can't
        // answer one.
        if (latestInbound?.machineMailTier === 'hard') {
          const reason = (latestInbound.metadata as { machineMail?: { reason?: string } } | null)
            ?.machineMail?.reason
          throw new Error(
            `Refusing to auto-reply to machine-generated mail (${reason ?? 'unknown'}) — bounces/NDRs must not be answered`
          )
        }

        // Auto-resolve recipients from thread
        if (
          config.toIsAuto !== false ||
          (messageType === 'replyAll' && config.ccIsAuto !== false)
        ) {
          const participants = latestInbound
            ? await this.getThreadParticipants(latestInbound.id, integrationId, context.db)
            : { sender: null, otherRecipients: [] }

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

    // 5. Determine effective send mode. test_behavior overrides the global debug flag in both
    // directions; 'live' does NOT override a configured saveAsDraft (live means "don't
    // simulate", not "skip the configured draft step").
    const behavior = config.test_behavior ?? 'default'
    const isDebug = contextManager.isDebugMode()
    type SendMode = 'send' | 'dryRun' | 'draft'
    const mode: SendMode =
      behavior === 'dry_run'
        ? 'dryRun'
        : behavior === 'draft'
          ? 'draft'
          : config.saveAsDraft
            ? 'draft'
            : behavior === 'live'
              ? 'send'
              : isDebug
                ? 'dryRun'
                : 'send'
    // Auditability: stamp the override in metadata when a non-default behavior is set
    const testBehaviorMetadata = behavior !== 'default' ? { testBehavior: behavior } : {}

    // Draft path — runs even in dry-run mode (drafts are safe, non-destructive)
    if (mode === 'draft') {
      try {
        const draftService = new DraftService(context.db, context.organizationId, context.userId)

        // resolvedText is plain text (tiptap stringified with \n line breaks).
        // Convert to simple HTML paragraphs for the draft editor (which renders bodyHtml).
        const bodyHtml = resolvedText
          .split('\n')
          .map((line) => `<p>${line || '<br>'}</p>`)
          .join('')

        const draftContent = {
          subject: resolvedSubject || null,
          bodyHtml,
          bodyText: resolvedText,
          recipients: {
            to: resolvedTo.map((email) => ({
              identifier: email,
              identifierType: IdentifierType.EMAIL,
            })),
            cc: resolvedCc.map((email) => ({
              identifier: email,
              identifierType: IdentifierType.EMAIL,
            })),
            bcc: resolvedBcc.map((email) => ({
              identifier: email,
              identifierType: IdentifierType.EMAIL,
            })),
          },
          attachments: [],
        }

        contextManager.log('INFO', node.name, 'Creating draft', {
          messageType,
          integrationId,
          threadId,
          subject: resolvedSubject,
          recipientCount: resolvedTo.length,
        })

        const draft = await draftService.upsert({
          integrationId,
          threadId: threadId || null,
          content: draftContent,
        })

        contextManager.log('INFO', node.name, 'Draft created successfully', {
          draftId: draft.id,
          threadId,
        })

        contextManager.setNodeVariable(node.nodeId, 'sent', false)
        contextManager.setNodeVariable(node.nodeId, 'message_id', draft.id)
        contextManager.setNodeVariable(node.nodeId, 'thread_id', threadId || '')
        contextManager.setNodeVariable(node.nodeId, 'timestamp', new Date().toISOString())
        contextManager.setNodeVariable(node.nodeId, 'integration_id', integrationId)
        contextManager.setNodeVariable(node.nodeId, 'message_type', messageType)
        contextManager.setNodeVariable(node.nodeId, 'is_draft', true)
        contextManager.setNodeVariable(node.nodeId, 'draft_id', draft.id)

        return {
          status: NodeRunningStatus.Succeeded,
          output: {
            sent: false,
            isDraft: true,
            draftId: draft.id,
            threadId: threadId || undefined,
            messageType,
            integrationId,
            subject: resolvedSubject || undefined,
            to: resolvedTo,
            cc: resolvedCc.length > 0 ? resolvedCc : undefined,
            bcc: resolvedBcc.length > 0 ? resolvedBcc : undefined,
            text: resolvedText,
            timestamp: new Date().toISOString(),
            recipientCount: resolvedTo.length + resolvedCc.length + resolvedBcc.length,
          },
          metadata: {
            messageType,
            integrationId,
            saveAsDraft: true,
            ...testBehaviorMetadata,
          },
          outputHandle: 'source',
        }
      } catch (error) {
        contextManager.log('ERROR', node.name, 'Failed to create draft', {
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    } else if (mode === 'dryRun') {
      // Dry run send path (existing behavior)
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
      contextManager.setNodeVariable(node.nodeId, 'is_draft', false)
      contextManager.setNodeVariable(node.nodeId, 'draft_id', '')

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
          timestamp: new Date().toISOString(),
          recipientCount: resolvedTo.length + resolvedCc.length + resolvedBcc.length,
        },
        metadata: {
          messageType,
          integrationId,
          dryRun: true,
          ...testBehaviorMetadata,
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
      contextManager.setNodeVariable(node.nodeId, 'is_draft', false)
      contextManager.setNodeVariable(node.nodeId, 'draft_id', '')

      return {
        status: NodeRunningStatus.Succeeded,
        output: {
          sent: true,
          messageId: result.id,
          threadId: result.threadId,
          messageType,
          integrationId,
          subject: resolvedSubject || undefined,
          to: resolvedTo,
          cc: resolvedCc.length > 0 ? resolvedCc : undefined,
          bcc: resolvedBcc.length > 0 ? resolvedBcc : undefined,
          text: resolvedText,
          timestamp: new Date().toISOString(),
          recipientCount:
            toParticipants.length + (ccParticipants?.length || 0) + (bccParticipants?.length || 0),
        },
        metadata: {
          messageType,
          integrationId,
          dryRun: false,
          ...testBehaviorMetadata,
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
   * Find the latest inbound message in a thread, returning its id, machine-mail tier,
   * and metadata (which carries the detection reason).
   *
   * Selecting these here lets the caller enforce the hard-tier machine-mail refusal
   * backstop without a second query, on both the auto-To and manual-To reply paths.
   */
  private async getLatestInboundMessage(
    threadId: string,
    db: any
  ): Promise<{ id: string; machineMailTier: 'hard' | 'soft' | null; metadata: unknown } | null> {
    const latestMessage = await db
      .select({
        id: schema.Message.id,
        machineMailTier: schema.Message.machineMailTier,
        metadata: schema.Message.metadata,
      })
      .from(schema.Message)
      .where(and(eq(schema.Message.threadId, threadId), eq(schema.Message.isInbound, true)))
      .orderBy(desc(schema.Message.receivedAt))
      .limit(1)

    return latestMessage[0] ?? null
  }

  /**
   * Extract the reply recipients from a message's participants.
   *
   * `sender` prefers the `REPLY_TO` participant and falls back to `FROM` — honoring a
   * sender's explicit Reply-To header (e.g. `support@` on an automated notification). The
   * integration's own email is filtered out of every role, so a Reply-To pointing back at
   * us falls through to `FROM`. The chosen sender is never duplicated into `otherRecipients`.
   */
  private async getThreadParticipants(
    messageId: string,
    integrationId: string,
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
      .where(eq(schema.MessageParticipant.messageId, messageId))

    let fromEmail: string | null = null
    let replyToEmail: string | null = null
    const recipientCandidates: string[] = []

    for (const p of messageParticipants) {
      const identifier = p.identifier
      const email = identifier?.toLowerCase()
      if (!email) continue
      // Skip the integration's own email in every role (also handles a Reply-To that
      // points back at us — it's dropped and sender falls back to FROM).
      if (integrationEmail && email === integrationEmail) continue

      if (p.role === ParticipantRole.REPLY_TO) {
        if (!replyToEmail) replyToEmail = identifier
      } else if (p.role === ParticipantRole.FROM) {
        if (!fromEmail) fromEmail = identifier
      } else if (p.role === ParticipantRole.TO || p.role === ParticipantRole.CC) {
        recipientCandidates.push(identifier)
      }
    }

    // Prefer Reply-To, fall back to From
    const sender = replyToEmail ?? fromEmail

    // Build otherRecipients from TO/CC, deduped and excluding the chosen sender
    const seen = new Set<string>()
    if (sender) seen.add(sender.toLowerCase())
    const otherRecipients: string[] = []
    for (const identifier of recipientCandidates) {
      const email = identifier.toLowerCase()
      if (seen.has(email)) continue
      seen.add(email)
      otherRecipients.push(identifier)
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
