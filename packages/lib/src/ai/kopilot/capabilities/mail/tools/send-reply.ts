// packages/lib/src/ai/kopilot/capabilities/mail/tools/send-reply.ts

import { DraftService } from '../../../../../drafts'
import { MessageSenderService } from '../../../../../messages'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { stripSignOff } from './strip-sign-off'

export function createSendReplyTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'send_reply',
    description:
      "Send a reply message on a thread. APPROVAL: The platform automatically pauses and shows an approval card when you call this tool. Do NOT ask the user in text first — just call the tool. The user's email signature is appended automatically — never include one in the body.",
    parameters: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread to reply to',
        },
        body: {
          type: 'string',
          description:
            'Reply body text. Do NOT include any sign-off, closing, or signature (no "Best regards", "Thanks", "Sincerely", or name). The system appends the user\'s email signature automatically.',
        },
        toRecipients: {
          type: 'array',
          items: { type: 'string' },
          description: 'TO email addresses',
        },
      },
      required: ['threadId', 'body'],
      additionalProperties: false,
    },
    requiresApproval: true,
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const threadId = args.threadId as string
      const body = stripSignOff(args.body as string)
      const toRecipients = args.toRecipients as string[] | undefined
      const saveAsDraft = args.saveAsDraft as boolean | undefined

      // Get thread meta for integration and subject
      const threadService = new ThreadQueryService(agentDeps.organizationId, db)
      const [threadMeta] = await threadService.getThreadMetaBatch([threadId], agentDeps.userId)

      if (!threadMeta) {
        return { success: false, output: null, error: `Thread ${threadId} not found` }
      }

      if (!toRecipients || toRecipients.length === 0) {
        return {
          success: false,
          output: null,
          error: 'At least one recipient is required to send a reply',
        }
      }

      // Save as draft instead of sending (via inputAmendment)
      if (saveAsDraft) {
        const draftService = new DraftService(db, agentDeps.organizationId, agentDeps.userId)
        const draft = await draftService.upsert({
          integrationId: threadMeta.integrationId,
          threadId,
          inReplyToMessageId: threadMeta.latestMessageId,
          content: {
            bodyHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
            bodyText: body,
            recipients: {
              to: toRecipients.map((email) => ({
                identifier: email,
                identifierType: 'EMAIL' as const,
              })),
              cc: [],
              bcc: [],
            },
            attachments: [],
          },
        })
        return {
          success: true,
          output: { draftId: draft.id, threadId, status: 'saved_as_draft' },
        }
      }

      const senderService = new MessageSenderService(agentDeps.organizationId, undefined, db)

      const result = await senderService.sendMessage({
        userId: agentDeps.userId,
        organizationId: agentDeps.organizationId,
        integrationId: threadMeta.integrationId,
        threadId,
        subject: `Re: ${threadMeta.subject}`,
        textHtml: `<p>${body.replace(/\n/g, '</p><p>')}</p>`,
        textPlain: body,
        to: toRecipients.map((email) => ({
          identifier: email,
          identifierType: 'EMAIL' as const,
        })),
      })

      return {
        success: true,
        output: {
          messageId: result.id,
          threadId: result.threadId,
          status: result.sendStatus,
        },
      }
    },
  }
}
