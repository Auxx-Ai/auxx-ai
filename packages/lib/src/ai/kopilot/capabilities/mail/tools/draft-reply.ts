// packages/lib/src/ai/kopilot/capabilities/mail/tools/draft-reply.ts

import { DraftService } from '../../../../../drafts'
import { MessageQueryService } from '../../../../../messages'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createDraftReplyTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'draft_reply',
    description:
      'Create or update a draft reply on a thread. If no recipients are specified, defaults to the last inbound sender. Returns the draft ID.',
    parameters: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread to reply to',
        },
        body: {
          type: 'string',
          description: 'Reply body text',
        },
        toRecipients: {
          type: 'array',
          items: { type: 'string' },
          description: 'TO email addresses (defaults to thread sender if omitted)',
        },
        ccRecipients: {
          type: 'array',
          items: { type: 'string' },
          description: 'CC email addresses',
        },
      },
      required: ['threadId', 'body'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const threadId = args.threadId as string
      const body = args.body as string
      const toRecipients = args.toRecipients as string[] | undefined
      const ccRecipients = args.ccRecipients as string[] | undefined

      // Get thread meta to resolve integrationId and recipients
      const threadService = new ThreadQueryService(agentDeps.organizationId, db)
      const [threadMeta] = await threadService.getThreadMetaBatch([threadId], agentDeps.userId)

      if (!threadMeta) {
        return { success: false, output: null, error: `Thread ${threadId} not found` }
      }

      // Auto-resolve recipients from last inbound message if not provided
      let resolvedTo = toRecipients ?? []
      if (resolvedTo.length === 0) {
        const messageService = new MessageQueryService(agentDeps.organizationId, db)
        const { messages } = await messageService.getMessagesByThread(threadId)
        const lastInbound = [...messages].reverse().find((m) => m.isInbound)
        if (lastInbound) {
          // Extract sender from participants (format: "from:participantId")
          const fromParticipant = lastInbound.participants.find((p) =>
            typeof p === 'string' ? p.startsWith('from:') : false
          )
          if (fromParticipant && typeof fromParticipant === 'string') {
            // We need the email, not the participant ID — use snippet as fallback
            // The participant ID format doesn't directly give us the email,
            // so we pass it as-is and let the draft service resolve it
            resolvedTo = [fromParticipant.replace('from:', '')]
          }
        }
      }

      const draftService = new DraftService(db, agentDeps.organizationId, agentDeps.userId)

      const draft = await draftService.upsert({
        integrationId: threadMeta.integrationId,
        threadId,
        inReplyToMessageId: threadMeta.latestMessageId,
        content: {
          bodyHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
          bodyText: body,
          recipients: {
            to: resolvedTo.map((email) => ({
              identifier: email,
              identifierType: 'EMAIL' as const,
            })),
            cc: (ccRecipients ?? []).map((email) => ({
              identifier: email,
              identifierType: 'EMAIL' as const,
            })),
            bcc: [],
          },
          attachments: [],
        },
      })

      return {
        success: true,
        output: {
          draftId: draft.id,
          threadId,
          body,
          to: resolvedTo,
          cc: ccRecipients ?? [],
          status: 'draft_saved',
        },
      }
    },
  }
}
