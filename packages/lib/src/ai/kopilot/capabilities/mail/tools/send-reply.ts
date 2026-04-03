// packages/lib/src/ai/kopilot/capabilities/mail/tools/send-reply.ts

import { MessageSenderService } from '../../../../../messages'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createSendReplyTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'send_reply',
    description:
      "Send a reply message on a thread. This action requires human approval before execution. The message will be sent via the thread's email integration.",
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
      const body = args.body as string
      const toRecipients = args.toRecipients as string[] | undefined

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
