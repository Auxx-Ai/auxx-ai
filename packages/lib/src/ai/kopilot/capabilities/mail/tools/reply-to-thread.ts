// packages/lib/src/ai/kopilot/capabilities/mail/tools/reply-to-thread.ts

import { z } from 'zod'
import { getCachedIntegrationCatalog } from '../../../../../cache/integration-catalog'
import { DraftService } from '../../../../../drafts'
import { MessageQueryService, MessageSenderService } from '../../../../../messages'
import { ParticipantService } from '../../../../../participants'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { EmailWriteDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { type ResolvedRecipient, resolveRecipients } from '../recipient-resolver'
import { stripSignOff } from './strip-sign-off'

interface ReplyArgs {
  threadId: string
  body: string
  /** Resolved at approval time via the approval card's `inputAmendment.mode`. */
  mode?: 'draft' | 'send'
  to?: string[]
  cc?: string[]
  bcc?: string[]
  attachments?: string[]
}

const ReplyAmendmentSchema = z.object({
  mode: z.enum(['draft', 'send']),
  body: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
})

export function createReplyToThreadTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'reply_to_thread',
    requiresApproval: true,
    inputAmendmentSchema: ReplyAmendmentSchema,
    outputDigestSchema: EmailWriteDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        threadId?: string
        draftId?: string
        messageId?: string
        mode?: 'draft' | 'send'
        status?: string
        body?: string
        resolvedRecipients?: Array<{ displayName?: string; identifier?: string }>
      }
      return {
        threadId: out.threadId,
        draftId: out.draftId,
        messageId: out.messageId,
        mode: out.mode === 'send' ? 'send' : 'draft',
        status: out.status,
        recipients: Array.isArray(out.resolvedRecipients)
          ? out.resolvedRecipients.map((r) => r.displayName ?? r.identifier ?? '').filter(Boolean)
          : undefined,
        body: out.body,
      }
    },
    usageNotes:
      'Always pauses for approval; the user picks Save as Draft or Send in the approval card. Defaults `to` to the last inbound sender.',
    description:
      "Reply on an existing thread. Works for any channel (email, SMS, WhatsApp, Facebook DM, Instagram DM). Body should not contain a sign-off — for email channels the user's signature is appended automatically. The user picks save-as-draft vs send in the approval card; do NOT pass a `mode` argument.",
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Thread to reply on.' },
        body: {
          type: 'string',
          description: 'Reply body. No sign-offs / signatures — appended automatically for email.',
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
      required: ['threadId', 'body'],
      additionalProperties: false,
    },
    summary: (args) => {
      const body = (args as Partial<ReplyArgs>).body ?? ''
      return `Reply: "${body.slice(0, 60)}${body.length > 60 ? '…' : ''}"`
    },
    execute: async (rawArgs, agentDeps) => {
      const args = rawArgs as Partial<ReplyArgs>
      const { db } = getDeps()
      const threadId = args.threadId
      if (!threadId) {
        return { success: false, output: null, error: 'threadId is required' }
      }
      const body = stripSignOff(args.body ?? '')
      // Mode is set by the approval card's input amendment; default to draft if
      // somehow missing (e.g. tool invoked through a non-pause path in tests).
      const mode: 'draft' | 'send' = args.mode === 'send' ? 'send' : 'draft'

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
            subject,
            body,
            mode: 'draft',
            resolvedRecipients: resolved,
            status: 'draft_saved',
          },
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

      return {
        success: true,
        output: {
          messageId: result.id,
          threadId: result.threadId,
          subject: threadMeta.subject ? `Re: ${threadMeta.subject}` : undefined,
          body,
          mode: 'send',
          resolvedRecipients: resolved,
          status: result.sendStatus,
        },
      }
    },
  }
}
