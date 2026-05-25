// apps/api/src/routes/chat/threads.ts

import { database, schema } from '@auxx/database'
import { initializeOrResumeChatThread, publishVisitorThreadCreated } from '@auxx/lib/chat'
import { ProviderRegistryService } from '@auxx/lib/providers'
import { getRealtimeService, publishThreadCreated } from '@auxx/lib/realtime'
import type { ChatThreadMetadata } from '@auxx/lib/threads/types'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders, loadChatWidgetByChannelId, loadThreadEvents } from './lib'

const log = createScopedLogger('chat-threads-route')

const threadsRoute = new Hono()

const LIST_PAGE_SIZE = 20

threadsRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

threadsRoute.options('/recent', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

threadsRoute.options('/:threadId/messages', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

threadsRoute.options('/:threadId/transcript', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/threads
 *
 * Create a fresh chat thread for the visitor. Always creates — the resume
 * path lives on `POST /api/chat/initialize`. Used by the Home "Send us a
 * message" CTA so every tap lands the visitor in a new conversation.
 */
threadsRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  const chat = c.get('chat')
  const body = await c.req.json().catch(() => ({}))

  const result = await initializeOrResumeChatThread(
    { db: database, organizationId: chat.organizationId },
    {
      channelId: chat.channelId,
      visitorId: chat.sessionId,
      forceNewThread: true,
      visit: {
        url: typeof body.url === 'string' ? body.url : undefined,
        referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
        userAgent: typeof body.userAgent === 'string' ? body.userAgent : undefined,
      },
      visitorName: chat.identify?.name,
      visitorEmail: chat.identify?.email,
      visitorExternalId: chat.identify?.externalId,
    }
  )

  if (result.error) {
    log.error('Failed to create chat thread', {
      channelId: chat.channelId,
      error: result.error.message,
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create thread' } },
      500
    )
  }

  const { thread, isNew } = result.value
  if (isNew) {
    await Promise.all([
      publishThreadCreated(getRealtimeService(), chat.organizationId, {
        threadId: thread.id,
        inboxId: thread.inboxId ?? null,
      }).catch((err) =>
        log.warn('Failed to publish thread:created for new chat thread', {
          threadId: thread.id,
          error: err instanceof Error ? err.message : String(err),
        })
      ),
      publishVisitorThreadCreated(getRealtimeService(), {
        visitorParticipantId: chat.visitorParticipantId,
        threadId: thread.id,
        createdAt: thread.createdAt ?? new Date(),
      }).catch((err) =>
        log.warn('Failed to publish visitor thread-created', {
          threadId: thread.id,
          error: err instanceof Error ? err.message : String(err),
        })
      ),
    ])
  }

  return c.json({
    success: true,
    data: {
      threadId: thread.id,
      pusherChannel: `chat-${result.value.visitorChatSessionId}`,
    },
  })
})

/**
 * GET /api/chat/threads/recent
 *
 * Return the visitor's most recently active thread for the Home "Recent
 * message" card and the "Send us a message" reuse rule. Includes threads
 * with no messages yet so the widget can reuse the empty thread instead of
 * spawning a new one on every tap. `lastMessage` is null when the thread
 * has no messages. Returns `{ thread: null }` when the visitor has no
 * threads on this channel.
 */
threadsRoute.get('/recent', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  const chat = c.get('chat')

  try {
    const threads = await database
      .select()
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.organizationId, chat.organizationId),
          eq(schema.Thread.integrationId, chat.channelId)
        )
      )
      .orderBy(desc(schema.Thread.lastMessageAt), desc(schema.Thread.createdAt))
      .limit(20)

    const recent = threads.find((t) => {
      const meta = (t.metadata ?? {}) as Partial<ChatThreadMetadata>
      return meta.channel === 'chat' && meta.visitorParticipantId === chat.visitorParticipantId
    })

    if (!recent) {
      return c.json({ success: true, data: { thread: null } })
    }

    const [lastMessage] = recent.latestMessageId
      ? await database
          .select({
            textPlain: schema.Message.textPlain,
            textHtml: schema.Message.textHtml,
            isInbound: schema.Message.isInbound,
            sentAt: schema.Message.sentAt,
            createdAt: schema.Message.createdAt,
          })
          .from(schema.Message)
          .where(eq(schema.Message.threadId, recent.id))
          .orderBy(desc(schema.Message.sentAt))
          .limit(1)
      : []

    return c.json({
      success: true,
      data: {
        thread: {
          id: recent.id,
          subject: recent.subject,
          lastMessage: lastMessage
            ? {
                preview: (lastMessage.textPlain ?? lastMessage.textHtml ?? '').slice(0, 160),
                isInbound: lastMessage.isInbound,
                timestamp: lastMessage.sentAt ?? lastMessage.createdAt,
              }
            : null,
        },
      },
    })
  } catch (error) {
    log.error('Failed to load recent chat thread', {
      channelId: chat.channelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load thread' } },
      500
    )
  }
})

/**
 * GET /api/chat/threads/:threadId/messages
 *
 * Returns the message history for the visitor's current thread. Ownership is
 * enforced by joining on org id from the passport — a leaked passport from one
 * org can never read another org's threads.
 */
threadsRoute.get('/:threadId/messages', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const threadId = c.req.param('threadId')

  try {
    const [thread] = await database
      .select({ id: schema.Thread.id })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.id, threadId),
          eq(schema.Thread.organizationId, chat.organizationId),
          eq(schema.Thread.integrationId, chat.channelId)
        )
      )
      .limit(1)
    if (!thread) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Thread not found' } },
        404
      )
    }

    const rows = await database
      .select({
        id: schema.Message.id,
        threadId: schema.Message.threadId,
        textPlain: schema.Message.textPlain,
        textHtml: schema.Message.textHtml,
        isInbound: schema.Message.isInbound,
        sentAt: schema.Message.sentAt,
        createdAt: schema.Message.createdAt,
      })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, threadId))
      .orderBy(asc(schema.Message.sentAt))

    const messages = rows.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      content: m.textPlain ?? m.textHtml ?? '',
      sender: m.isInbound ? 'USER' : 'AGENT',
      timestamp: m.sentAt ?? m.createdAt,
      status: 'DELIVERED',
    }))

    // Hydrate the thread's lifecycle events so the widget can interleave
    // centered system lines with the message transcript on reload.
    const threadEvents = await loadThreadEvents(chat.organizationId, threadId)

    return c.json({ success: true, data: { messages, threadEvents, nextCursor: null } })
  } catch (error) {
    log.error('Failed to load chat history', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load history' } },
      500
    )
  }
})

/**
 * POST /api/chat/threads/:threadId/messages
 *
 * Visitor sends a chat message. Body:
 * `{ content, clientMessageId?, attachmentIds? }`. `threadId` comes from the URL.
 *
 * Resolves `ChatProvider` from the provider registry and calls
 * `receiveMessage` — that path writes the Message row, attaches files, bumps
 * the Thread, publishes realtime, and enqueues an agent run if configured.
 */
threadsRoute.post('/:threadId/messages', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const threadId = c.req.param('threadId')
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: string
    clientMessageId?: string
    attachmentIds?: string[]
  }

  if (!body.content) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'content is required' } },
      400
    )
  }

  try {
    const registry = new ProviderRegistryService(chat.organizationId)
    const provider = (await registry.getProvider(chat.channelId)) as any
    if (typeof provider.receiveMessage !== 'function') {
      return c.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Channel does not support inbound messages' },
        },
        500
      )
    }

    const result = await provider.receiveMessage({
      threadId,
      fromParticipantId: chat.visitorParticipantId,
      content: body.content,
      clientMessageId: body.clientMessageId,
      attachmentIds: body.attachmentIds,
    })

    return c.json({
      success: true,
      data: {
        messageId: result.messageId,
        threadId: result.threadId,
        status: 'delivered',
        createdAt: new Date(),
      },
    })
  } catch (error) {
    log.error('Failed to send chat message', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send message' } },
      500
    )
  }
})

/**
 * GET /api/chat/threads
 *
 * List the visitor's threads on this channel, ordered by `lastMessageAt`
 * descending. Cursor pagination keyed by `lastMessageAt|id` so duplicates
 * across pages stay stable when timestamps collide.
 *
 * Query: `?cursor=<iso>__<id>&limit=20`
 */
threadsRoute.get('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const cursor = c.req.query('cursor') ?? null
  const limitRaw = Number(c.req.query('limit') ?? LIST_PAGE_SIZE)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : LIST_PAGE_SIZE

  try {
    const cursorParts = cursor ? parseCursor(cursor) : null

    // We can't filter on metadata.visitorParticipantId at SQL-time without a
    // jsonb index, so we over-fetch by 4x and filter in-memory. Visitor thread
    // counts on a single channel are bounded enough that this is cheap.
    const fetchLimit = limit * 4
    const baseConditions = [
      eq(schema.Thread.organizationId, chat.organizationId),
      eq(schema.Thread.integrationId, chat.channelId),
      // Skip empty threads — the widget previously created threads eagerly on
      // every Home "Send us a message" tap, leaving rows with no messages that
      // showed up as "No messages yet, Support" in the Messages tab.
      isNotNull(schema.Thread.latestMessageId),
    ]

    const conditions = cursorParts
      ? [
          ...baseConditions,
          or(
            lt(schema.Thread.lastMessageAt, cursorParts.lastMessageAt),
            and(
              eq(schema.Thread.lastMessageAt, cursorParts.lastMessageAt),
              lt(schema.Thread.id, cursorParts.id)
            )
          )!,
        ]
      : baseConditions

    const rows = await database
      .select({
        id: schema.Thread.id,
        subject: schema.Thread.subject,
        lastMessageAt: schema.Thread.lastMessageAt,
        latestMessageId: schema.Thread.latestMessageId,
        metadata: schema.Thread.metadata,
        assigneeId: schema.Thread.assigneeId,
        assigneeName: schema.User.name,
        assigneeImage: schema.User.image,
      })
      .from(schema.Thread)
      .leftJoin(schema.User, eq(schema.User.id, schema.Thread.assigneeId))
      .where(and(...conditions))
      .orderBy(desc(schema.Thread.lastMessageAt), desc(schema.Thread.id))
      .limit(fetchLimit)

    const mine = rows.filter((t) => {
      const meta = (t.metadata ?? {}) as Partial<ChatThreadMetadata>
      return meta.channel === 'chat' && meta.visitorParticipantId === chat.visitorParticipantId
    })

    const page = mine.slice(0, limit)
    const nextThread = mine.length > limit ? mine[limit] : null

    // Fetch latest message snippet for each thread (small N, no N+1 concern).
    const messageIds = page.map((t) => t.latestMessageId).filter((id): id is string => !!id)
    const lastMessages = messageIds.length
      ? await database
          .select({
            id: schema.Message.id,
            threadId: schema.Message.threadId,
            textPlain: schema.Message.textPlain,
            textHtml: schema.Message.textHtml,
            isInbound: schema.Message.isInbound,
            sentAt: schema.Message.sentAt,
            createdAt: schema.Message.createdAt,
          })
          .from(schema.Message)
          .where(
            sql`${schema.Message.id} = ANY(ARRAY[${sql.join(
              messageIds.map((id) => sql`${id}`),
              sql`, `
            )}]::text[])`
          )
      : []
    const lastByThread = new Map(lastMessages.map((m) => [m.threadId, m]))

    const items = page.map((t) => {
      const last = lastByThread.get(t.id)
      const snippet = last ? (last.textPlain ?? last.textHtml ?? '').slice(0, 160) : ''
      const sentAt = last?.sentAt ?? last?.createdAt ?? t.lastMessageAt ?? new Date()
      return {
        id: t.id,
        agent: t.assigneeId
          ? { id: t.assigneeId, name: t.assigneeName ?? 'Support', avatarUrl: t.assigneeImage }
          : null,
        lastMessage: {
          snippet,
          sentAt,
          isInbound: last?.isInbound ?? false,
        },
        updatedAt: t.lastMessageAt ?? t.id,
      }
    })

    const nextCursor = nextThread?.lastMessageAt
      ? `${nextThread.lastMessageAt.toISOString()}__${nextThread.id}`
      : null

    return c.json({ success: true, data: { items, nextCursor } })
  } catch (error) {
    log.error('Failed to list chat threads', {
      channelId: chat.channelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list threads' } },
      500
    )
  }
})

/**
 * POST /api/chat/threads/:threadId/transcript
 *
 * Render the thread's messages as a sanitized HTML document for download.
 * Gated by ChatWidget.allowDownloadTranscript.
 */
threadsRoute.post('/:threadId/transcript', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const threadId = c.req.param('threadId')

  try {
    const widget = await loadChatWidgetByChannelId(chat.channelId)
    if (!widget || !widget.allowDownloadTranscript) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Transcript download disabled' } },
        403
      )
    }

    const [thread] = await database
      .select({
        id: schema.Thread.id,
        subject: schema.Thread.subject,
        metadata: schema.Thread.metadata,
      })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.id, threadId),
          eq(schema.Thread.organizationId, chat.organizationId),
          eq(schema.Thread.integrationId, chat.channelId)
        )
      )
      .limit(1)
    if (!thread) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Thread not found' } },
        404
      )
    }
    const meta = (thread.metadata ?? {}) as Partial<ChatThreadMetadata>
    if (meta.visitorParticipantId !== chat.visitorParticipantId) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Not your thread' } },
        403
      )
    }

    const rows = await database
      .select({
        id: schema.Message.id,
        textPlain: schema.Message.textPlain,
        textHtml: schema.Message.textHtml,
        isInbound: schema.Message.isInbound,
        sentAt: schema.Message.sentAt,
        createdAt: schema.Message.createdAt,
      })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, threadId))
      .orderBy(asc(schema.Message.sentAt))

    const html = renderTranscriptHtml({
      subject: thread.subject ?? 'Conversation',
      messages: rows.map((m) => ({
        body: m.textPlain ?? stripHtml(m.textHtml ?? ''),
        isInbound: m.isInbound,
        sentAt: m.sentAt ?? m.createdAt,
      })),
    })

    return c.json({ success: true, data: { html, filename: `transcript-${threadId}.html` } })
  } catch (error) {
    log.error('Failed to render chat transcript', {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to render transcript' } },
      500
    )
  }
})

function parseCursor(cursor: string): { lastMessageAt: Date; id: string } | null {
  const [iso, id] = cursor.split('__')
  if (!iso || !id) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return { lastMessageAt: d, id }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

function renderTranscriptHtml(args: {
  subject: string
  messages: { body: string; isInbound: boolean; sentAt: Date }[]
}): string {
  const rows = args.messages
    .map((m) => {
      const who = m.isInbound ? 'You' : 'Support'
      const at = new Date(m.sentAt).toISOString()
      return `<div class="row ${m.isInbound ? 'in' : 'out'}"><div class="meta">${escapeHtml(
        who
      )} · ${escapeHtml(at)}</div><div class="body">${escapeHtml(m.body)}</div></div>`
    })
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(args.subject)}</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px; color: #111; }
  h1 { font-size: 18px; }
  .row { margin: 12px 0; padding: 12px; border-radius: 10px; }
  .row.in { background: #f3f4f6; }
  .row.out { background: #eef2ff; }
  .meta { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  .body { white-space: pre-wrap; }
</style></head>
<body><h1>${escapeHtml(args.subject)}</h1>${rows}</body></html>`
}

export default threadsRoute
