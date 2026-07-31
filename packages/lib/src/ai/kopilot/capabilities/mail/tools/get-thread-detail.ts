// packages/lib/src/ai/kopilot/capabilities/mail/tools/get-thread-detail.ts

import { parseRecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { getCachedUserInstanceGrants } from '../../../../../cache'
import { NotFoundError } from '../../../../../errors'
import { MessageQueryService } from '../../../../../messages'
import { TagService } from '../../../../../tags'
import { ThreadQueryService } from '../../../../../threads'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/** Full success output of `get_thread_detail` — thread metadata plus recent messages. */
const GetThreadDetailOutput = z.object({
  thread: z.object({
    id: z.string(),
    subject: z.string(),
    status: z.string(),
    assigneeId: z.string().nullable(),
    lastMessageAt: z.string(),
    messageCount: z.number(),
    isUnread: z.boolean(),
    tagIds: z.array(z.string()),
    tags: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        emoji: z.string().nullable(),
      })
    ),
    integrationId: z.string(),
  }),
  messages: z.array(
    z.object({
      id: z.string(),
      subject: z.string().nullable(),
      snippet: z.string().nullable(),
      textPlain: z.string(),
      isInbound: z.boolean(),
      hasAttachments: z.boolean(),
      sentAt: z.string().nullable(),
      participants: z.array(z.string()),
    })
  ),
  totalMessages: z.number(),
})

const MAX_MESSAGES = 20
const MAX_BODY_LENGTH = 500

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

export function createGetThreadDetailTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_thread_detail',
    permission: {
      target: 'unmodeled',
      domain: 'mail',
      level: 'view',
      enforcement: 'enforced',
      note: 'Thread + message services both viewer-scoped; an invisible thread reads as not-found.',
    },
    displayName: 'Read thread',
    toolsetSlug: 'auxx:mail:threads',
    idempotent: true,
    outputSchema: GetThreadDetailOutput,
    exampleOutput: {
      thread: {
        id: 'thread_8fK2pQ',
        subject: 'Where is my order #1042?',
        status: 'OPEN',
        assigneeId: null,
        lastMessageAt: '2026-06-05T14:22:00.000Z',
        messageCount: 2,
        isUnread: true,
        tagIds: ['tag_shipping'],
        tags: [{ id: 'tag_shipping', name: 'Shipping', color: 'blue', emoji: null }],
        integrationId: 'gmail_AbC123',
      },
      messages: [
        {
          id: 'msg_01',
          subject: 'Where is my order #1042?',
          snippet: "Hi, I ordered last week and haven't received any shipping update…",
          textPlain:
            "Hi, I ordered last week and haven't received any shipping update yet. Order number is 1042. Can you tell me when it will arrive?",
          isInbound: true,
          hasAttachments: false,
          sentAt: '2026-06-05T13:40:00.000Z',
          participants: ['jane@example.com', 'support@store.com'],
        },
        {
          id: 'msg_02',
          subject: 'Re: Where is my order #1042?',
          snippet: 'Thanks for reaching out — let me check on that for you…',
          textPlain:
            'Thanks for reaching out — let me check on that for you and get back with a tracking update shortly.',
          isInbound: false,
          hasAttachments: false,
          sentAt: '2026-06-05T14:22:00.000Z',
          participants: ['support@store.com', 'jane@example.com'],
        },
      ],
      totalMessages: 2,
    } satisfies z.output<typeof GetThreadDetailOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        thread?: { id?: string; subject?: string | null; lastMessageAt?: string | null }
        totalMessages?: number
      }
      return {
        threadId: String(out.thread?.id ?? ''),
        subject: out.thread?.subject ?? null,
        messageCount: typeof out.totalMessages === 'number' ? out.totalMessages : 0,
        lastMessageAt:
          typeof out.thread?.lastMessageAt === 'string' ? out.thread.lastMessageAt : null,
      }
    },
    usageNotes:
      "Returns a single thread's messages. Use after `find_threads` to read a conversation before drafting a reply.",
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
    validateInputs: async (args) => {
      const threadId = parseStringArg(args.threadId, {
        name: 'threadId',
        required: true,
        max: 200,
        stripPrefix: 'thread:',
      })
      if (!threadId.ok) return { ok: false, error: threadId.error }
      return { ok: true, args: { ...args, threadId: threadId.value } }
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const threadId = args.threadId as string

      // Kopilot reads mail as the invoking user (§8.1) — never SYSTEM.
      const viewer = await getCachedUserInstanceGrants(agentDeps.userId, agentDeps.organizationId)
      const threadService = new ThreadQueryService(agentDeps.organizationId, db, viewer)
      const messageService = new MessageQueryService(agentDeps.organizationId, db, viewer)

      // Fetch thread meta and messages in parallel. An invisible thread reads
      // as nonexistent (§5.2) — the meta batch drops it and the message read
      // 404s; both collapse into the same not-found reply below.
      const [threadMetas, messageResult] = await Promise.all([
        threadService.getThreadMetaBatch([threadId], agentDeps.userId),
        messageService.getMessagesByThread(threadId).catch((error) => {
          if (error instanceof NotFoundError) return { messages: [], total: 0 }
          throw error
        }),
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

      // tagIds on ThreadMeta are RecordIds ("entityDefId:instanceId") — parse to
      // raw instance IDs since update_thread expects those, and resolve names.
      const tagInstanceIds = thread.tagIds.map((rid) => parseRecordId(rid).entityInstanceId)
      let tags: Array<{ id: string; name: string; color: string; emoji: string | null }> = []
      if (tagInstanceIds.length > 0) {
        const tagService = new TagService(agentDeps.organizationId, agentDeps.userId, db)
        const allTags = await tagService.getAllTags()
        const byId = new Map(allTags.map((t) => [t.id, t]))
        tags = tagInstanceIds.map((id) => {
          const tag = byId.get(id)
          return tag
            ? { id: tag.id, name: tag.title, color: tag.tag_color, emoji: tag.tag_emoji }
            : { id, name: id, color: 'gray', emoji: null }
        })
      }

      return {
        success: true,
        output: {
          thread: {
            id: thread.id,
            subject: thread.subject,
            status: thread.status,
            assigneeId: thread.assigneeId,
            // `ThreadMeta.lastMessageAt` is already an ISO string.
            lastMessageAt: thread.lastMessageAt,
            messageCount: thread.messageCount,
            isUnread: thread.isUnread,
            tagIds: tagInstanceIds,
            tags,
            integrationId: thread.integrationId,
          },
          messages,
          totalMessages: messageResult.total,
        },
      }
    },
  }
}
