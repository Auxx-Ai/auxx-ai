// packages/lib/src/ai/kopilot/capabilities/mail/tools/reply-to-thread.ts

import { getCachedIntegrationCatalog } from '../../../../../cache/integration-catalog'
import { DraftService } from '../../../../../drafts'
import { MessageQueryService, MessageSenderService } from '../../../../../messages'
import { ParticipantService } from '../../../../../participants'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { type ResolvedRecipient, resolveRecipients } from '../recipient-resolver'
import { stripSignOff } from './strip-sign-off'

interface ReplyArgs {
  threadId: string
  body: string
  mode: 'draft' | 'send'
  to?: string[]
  cc?: string[]
  bcc?: string[]
  attachments?: string[]
}

export function createReplyToThreadTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'reply_to_thread',
    usageNotes:
      'Use `mode: "draft"` to save without sending; `mode: "send"` to send (requires approval). Defaults `to` to the last inbound sender.',
    description:
      "Reply on an existing thread. Works for any channel (email, SMS, WhatsApp, Facebook DM, Instagram DM). Body should not contain a sign-off — for email channels the user's signature is appended automatically.",
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Thread to reply on.' },
        body: {
          type: 'string',
          description: 'Reply body. No sign-offs / signatures — appended automatically for email.',
        },
        mode: {
          type: 'string',
          enum: ['draft', 'send'],
          description:
            '`draft` saves without sending. `send` sends through the channel and requires approval.',
        },
        to: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Override recipients. Each entry: recordId (`entityDefinitionId:instanceId`), participantId (cuid), or raw identifier (email/phone). Defaults to the last inbound sender.',
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Same shape as `to`. Email channels only.',
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Same shape as `to`. Email channels only.',
        },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'File IDs.',
        },
      },
      required: ['threadId', 'body', 'mode'],
      additionalProperties: false,
    },
    requiresApproval: (args) => (args as Partial<ReplyArgs>).mode === 'send',
    summary: (args) => {
      const a = args as Partial<ReplyArgs>
      const verb = a.mode === 'send' ? 'Send reply' : 'Draft reply'
      const body = a.body ?? ''
      return `${verb}: "${body.slice(0, 60)}${body.length > 60 ? '…' : ''}"`
    },
    execute: async (rawArgs, agentDeps) => {
      const args = rawArgs as Partial<ReplyArgs>
      const { db } = getDeps()
      const threadId = args.threadId
      if (!threadId) {
        return { success: false, output: null, error: 'threadId is required' }
      }
      const body = stripSignOff(args.body ?? '')
      const mode = args.mode

      const threadService = new ThreadQueryService(agentDeps.organizationId, db)
      const [threadMeta] = await threadService.getThreadMetaBatch([threadId], agentDeps.userId)
      if (!threadMeta) {
        return { success: false, output: null, error: `Thread ${threadId} not found` }
      }

      const catalog = await getCachedIntegrationCatalog(agentDeps.organizationId)
      const integration = catalog.find((i) => i.integrationId === threadMeta.integrationId)
      if (!integration) {
        return {
          success: false,
          output: null,
          error: `Thread integration ${threadMeta.integrationId} is not in the available catalog`,
        }
      }

      if (integration.channel !== 'email' && (args.cc?.length || args.bcc?.length)) {
        return {
          success: false,
          output: null,
          error: `cc/bcc are not supported on ${integration.platform} (messaging channel)`,
        }
      }

      let resolved: ResolvedRecipient[] = []
      if (args.to?.length || args.cc?.length || args.bcc?.length) {
        const result = await resolveRecipients(
          { to: args.to, cc: args.cc, bcc: args.bcc },
          integration,
          { ...agentDeps, db }
        )
        if (!result.ok) {
          return { success: false, output: null, error: result.error.message }
        }
        resolved = result.value
      } else {
        // Default to last inbound sender for replies.
        const messageService = new MessageQueryService(agentDeps.organizationId, db)
        const { messages } = await messageService.getMessagesByThread(threadId)
        const lastInbound = [...messages].reverse().find((m) => m.isInbound)
        const fromEntry = lastInbound?.participants.find((p) => p.startsWith('from:'))
        const fromParticipantId = fromEntry?.replace('from:', '')
        if (fromParticipantId) {
          const participantService = new ParticipantService(agentDeps.organizationId, db)
          const [participant] = await participantService.getParticipantMetaBatch([
            fromParticipantId,
          ])
          if (participant?.identifier) {
            resolved = [
              {
                participantId: participant.id,
                identifier: participant.identifier,
                identifierType: participant.identifierType,
                role: 'to',
                displayName: participant.displayName ?? participant.name ?? participant.identifier,
              },
            ]
          }
        }
      }

      const toIds = resolved.filter((r) => r.role === 'to')
      const ccIds = resolved.filter((r) => r.role === 'cc')
      const bccIds = resolved.filter((r) => r.role === 'bcc')

      if (toIds.length === 0 && mode === 'send') {
        return {
          success: false,
          output: null,
          error: 'At least one recipient is required to send a reply',
        }
      }

      if (mode === 'draft') {
        const draftService = new DraftService(db, agentDeps.organizationId, agentDeps.userId)
        const draft = await draftService.upsert({
          integrationId: threadMeta.integrationId,
          threadId,
          inReplyToMessageId: threadMeta.latestMessageId,
          content: {
            bodyHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
            bodyText: body,
            recipients: {
              to: toIds.map((r) => ({
                identifier: r.identifier,
                identifierType: r.identifierType,
              })),
              cc: ccIds.map((r) => ({
                identifier: r.identifier,
                identifierType: r.identifierType,
              })),
              bcc: bccIds.map((r) => ({
                identifier: r.identifier,
                identifierType: r.identifierType,
              })),
            },
            attachments: [],
          },
        })
        const subject = threadMeta.subject ? `Re: ${threadMeta.subject}` : undefined
        return {
          success: true,
          output: {
            draftId: draft.id,
            threadId,
            body,
            mode: 'draft',
            resolvedRecipients: resolved,
            status: 'draft_saved',
          },
          blocks: [
            {
              type: 'draft-preview',
              data: {
                draftId: draft.id,
                threadId,
                to: toIds.map((r) => r.displayName ?? r.identifier),
                cc: ccIds.length ? ccIds.map((r) => r.displayName ?? r.identifier) : undefined,
                body,
                subject,
              },
            },
          ],
        }
      }

      const senderService = new MessageSenderService(agentDeps.organizationId, undefined, db)
      const result = await senderService.sendMessage({
        userId: agentDeps.userId,
        organizationId: agentDeps.organizationId,
        integrationId: threadMeta.integrationId,
        threadId,
        subject: threadMeta.subject ? `Re: ${threadMeta.subject}` : '',
        textHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
        textPlain: body,
        to: toIds.map((r) => ({
          identifier: r.identifier,
          identifierType: r.identifierType,
          name: r.displayName,
        })),
        cc: ccIds.length
          ? ccIds.map((r) => ({
              identifier: r.identifier,
              identifierType: r.identifierType,
              name: r.displayName,
            }))
          : undefined,
        bcc: bccIds.length
          ? bccIds.map((r) => ({
              identifier: r.identifier,
              identifierType: r.identifierType,
              name: r.displayName,
            }))
          : undefined,
      })

      const recipientSummary = toIds.map((r) => r.displayName ?? r.identifier).join(', ')
      return {
        success: true,
        output: {
          messageId: result.id,
          threadId: result.threadId,
          mode: 'send',
          resolvedRecipients: resolved,
          status: result.sendStatus,
        },
        blocks: [
          {
            type: 'action-result',
            data: {
              action: 'reply_to_thread',
              success: true,
              summary: `Reply sent to ${recipientSummary}`,
              messageId: result.id,
              threadId: result.threadId,
            },
          },
        ],
      }
    },
  }
}
