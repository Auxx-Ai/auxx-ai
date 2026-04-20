// packages/lib/src/ai/kopilot/capabilities/mail/tools/get-thread-detail.ts

import { MessageQueryService } from '../../../../../messages'
import { ThreadQueryService } from '../../../../../threads'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_MESSAGES = 20
const MAX_BODY_LENGTH = 500

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

export function createGetThreadDetailTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_thread_detail',
    idempotent: true,
    description:
      'Get full details for a specific thread including metadata and messages. Use this to read the conversation before drafting a reply.',
    parameters: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread ID to get details for',
        },
      },
      required: ['threadId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const threadId = args.threadId as string

      const threadService = new ThreadQueryService(agentDeps.organizationId, db)
      const messageService = new MessageQueryService(agentDeps.organizationId, db)

      // Fetch thread meta and messages in parallel
      const [threadMetas, messageResult] = await Promise.all([
        threadService.getThreadMetaBatch([threadId], agentDeps.userId),
        messageService.getMessagesByThread(threadId),
      ])

      const thread = threadMetas[0]
      if (!thread) {
        return { success: false, output: null, error: `Thread ${threadId} not found` }
      }

      // Take most recent messages, truncate bodies
      const messages = messageResult.messages.slice(-MAX_MESSAGES).map((m) => ({
        id: m.id,
        subject: m.subject,
        snippet: m.snippet,
        textPlain: truncate(m.textPlain, MAX_BODY_LENGTH),
        isInbound: m.isInbound,
        hasAttachments: m.hasAttachments,
        sentAt: m.sentAt,
        participants: m.participants,
      }))

      return {
        success: true,
        output: {
          thread: {
            id: thread.id,
            subject: thread.subject,
            status: thread.status,
            assigneeId: thread.assigneeId,
            lastMessageAt: thread.lastMessageAt,
            messageCount: thread.messageCount,
            isUnread: thread.isUnread,
            tagIds: thread.tagIds,
            integrationId: thread.integrationId,
          },
          messages,
          totalMessages: messageResult.total,
        },
      }
    },
  }
}
