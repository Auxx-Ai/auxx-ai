// apps/api/src/routes/chat/initialize.ts

import type { ChatIdentifyClaim } from '@auxx/credentials/passport'
import { issueChatPassport } from '@auxx/credentials/passport'
import { database, schema } from '@auxx/database'
import { initializeOrResumeChatThread, publishVisitorThreadCreated } from '@auxx/lib/chat'
import { publisher } from '@auxx/lib/events'
import { getRealtimeService, publishThreadCreated } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { parseIdentifyPayload } from './identify'
import { applyChatCorsHeaders, loadChatAttachmentsForMessages, loadThreadEvents } from './lib'

const log = createScopedLogger('chat-initialize-route')

/** Most recent page of messages returned on initialize. Older pages load via
 * `GET /api/chat/threads/:threadId/messages?cursor=…` as the visitor scrolls. */
const INITIAL_MESSAGE_PAGE = 50

const initializeRoute = new Hono()

initializeRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/initialize
 *
 * Bootstrap or resume the chat thread for the authenticated visitor.
 * Body: `{ url?, referrer?, userAgent?, visitorName?, visitorEmail?, identify? }`.
 *
 * Returns `{ threadId, visitorId, isNewSession, messages, pusherChannel, visitorPusherChannel }`.
 * `visitorPusherChannel` is keyed by the visitor's Participant id and carries
 * cross-thread updates (new thread, message on a backgrounded thread).
 *
 * If `identify` is present the passport is re-issued with the claim merged in
 * and returned as `passport.token` so the widget can refresh its stored copy.
 */
initializeRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const body = await c.req.json().catch(() => ({}))
  const identify = parseIdentifyPayload(body.identify) ?? chat.identify

  try {
    const result = await initializeOrResumeChatThread(
      { db: database, organizationId: chat.organizationId },
      {
        channelId: chat.channelId,
        visitorId: chat.sessionId,
        resumeThreadId: typeof body.threadId === 'string' ? body.threadId : undefined,
        visit: {
          url: typeof body.url === 'string' ? body.url : undefined,
          referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
          userAgent: typeof body.userAgent === 'string' ? body.userAgent : undefined,
          ipAddress:
            c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
            c.req.header('x-real-ip') ||
            undefined,
        },
        visitorName:
          identify?.name ?? (typeof body.visitorName === 'string' ? body.visitorName : undefined),
        visitorEmail:
          identify?.email ??
          (typeof body.visitorEmail === 'string' ? body.visitorEmail : undefined),
        visitorExternalId: identify?.externalId,
      }
    )

    if (result.error) {
      log.error('Failed to initialize chat thread', {
        channelId: chat.channelId,
        error: result.error.message,
      })
      return c.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to initialize chat session' },
        },
        500
      )
    }

    const { thread, isNew, visitorChatSessionId } = result.value

    if (isNew) {
      // New chat thread — fan out so the admin's mail-thread list picks it up
      // live, and the visitor's Messages tab (cross-thread channel) bumps to
      // include it without a refetch.
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

    // Load the most recent page of messages on resume so the widget can
    // rehydrate. Older messages page in via `getHistory` on scroll.
    const recentRows = isNew
      ? []
      : await database
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
          .where(eq(schema.Message.threadId, thread.id))
          .orderBy(desc(schema.Message.sentAt))
          .limit(INITIAL_MESSAGE_PAGE)

    // Flip back to chronological for render. The widget appends bubbles top-
    // to-bottom; reversing in JS keeps the SQL plan simple (uses the existing
    // sentAt desc index).
    const rows = recentRows.slice().reverse()

    const attachmentsByMessage =
      rows.length > 0
        ? await loadChatAttachmentsForMessages(
            chat.organizationId,
            rows.map((r) => r.id)
          )
        : new Map()

    const messages = rows.map((m) => {
      const attachments = attachmentsByMessage.get(m.id)
      return {
        id: m.id,
        threadId: m.threadId,
        content: m.textPlain ?? m.textHtml ?? '',
        sender: m.isInbound ? 'USER' : 'AGENT',
        createdAt: m.sentAt ?? m.createdAt,
        status: 'DELIVERED',
        ...(attachments?.length ? { attachments } : {}),
      }
    })

    // Hydrate thread lifecycle events so the widget can render centered
    // system lines (taken_over / returned_to_ai / archived / reopened / …)
    // alongside the persisted message transcript.
    const threadEvents = isNew ? [] : await loadThreadEvents(chat.organizationId, thread.id)

    // If the visitor identified during this initialize (new claim with an
    // email) and we have an active thread, emit the lifecycle event so the
    // admin sees a centered system line in the conversation.
    if (identify?.email && hasNewIdentify(chat.identify, identify) && thread?.id) {
      await publisher.publishLater({
        type: 'thread:visitor:identified',
        data: {
          threadId: thread.id,
          organizationId: chat.organizationId,
          visitorEmail: identify.email,
          participantId: chat.visitorParticipantId,
        },
      })
    }

    let passport: { token: string; expiresIn: string } | undefined
    if (identify && hasNewIdentify(chat.identify, identify)) {
      const issued = await issueChatPassport({
        visitorParticipantId: chat.visitorParticipantId,
        channelId: chat.channelId,
        organizationId: chat.organizationId,
        sessionId: chat.sessionId,
        identify,
      })
      if (issued.isOk()) {
        passport = { token: issued.value.token, expiresIn: issued.value.expiresIn }
      } else {
        log.warn('Failed to re-issue chat passport with identify claim', {
          channelId: chat.channelId,
          error: issued.error.message,
        })
      }
    }

    // `recentRows` has the newest page in descending order; if we filled the
    // page, expose the oldest entry's timestamp as the cursor so the widget
    // can request older messages on scroll up.
    const nextCursor =
      recentRows.length === INITIAL_MESSAGE_PAGE
        ? (recentRows[recentRows.length - 1]?.sentAt?.toISOString() ?? null)
        : null

    return c.json({
      success: true,
      data: {
        threadId: thread.id,
        visitorId: chat.sessionId,
        isNewSession: isNew,
        messages,
        nextCursor,
        threadEvents,
        pusherChannel: `chat-${visitorChatSessionId}`,
        threadPusherChannel: `private-thread-${thread.id}`,
        visitorPusherChannel: `private-visitor-${chat.visitorParticipantId}`,
        ...(passport ? { passport } : {}),
      },
    })
  } catch (error) {
    log.error('Failed to initialize chat session', {
      channelId: chat.channelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to initialize chat session',
        },
      },
      500
    )
  }
})

/** Skip the passport re-issue when the new claim matches what's already encoded. */
function hasNewIdentify(current: ChatIdentifyClaim | undefined, next: ChatIdentifyClaim): boolean {
  if (!current) return true
  return (
    current.name !== next.name ||
    current.email !== next.email ||
    current.externalId !== next.externalId
  )
}

export default initializeRoute
