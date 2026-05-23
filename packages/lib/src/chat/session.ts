// packages/lib/src/chat/session.ts

import { schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import type { ThreadEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { Result, type TypedResult } from '../result'
import type { ChatThreadMetadata } from '../threads/types'
import { formatVisitorLabel, formatVisitorThreadSubject } from './labels'
import { patchChatThreadMetadata } from './metadata'
import type { ServiceContext, VisitInfo } from './types'
import { findOrCreateVisitorParticipant } from './visitor-identity'

const logger = createScopedLogger('chat-session')

export interface InitializeChatThreadInput {
  channelId: string
  visitorId: string
  visit?: VisitInfo
  visitorName?: string
  visitorEmail?: string
  /** Embedder-supplied external id (unverified in v1). Stored as `claimedExternalId`. */
  visitorExternalId?: string
  /**
   * When true, skip the resume-existing-thread lookup and always create a
   * fresh thread. Used by the Home "Send us a message" CTA so each tap lands
   * in a new conversation.
   */
  forceNewThread?: boolean
  /**
   * When set, resume this specific thread (after verifying ownership) instead
   * of falling back to "most recent open thread for this visitor." Used when
   * the visitor opens a specific past conversation from the Messages tab so
   * `initialize` doesn't silently swap them onto a different thread.
   */
  resumeThreadId?: string
}

export interface InitializeChatThreadResult {
  thread: ThreadEntity
  isNew: boolean
  /** The id the embedded widget uses for its `private-chat-${id}` subscription. */
  visitorChatSessionId: string
}

/**
 * Find an existing open chat thread for this visitor or create a new one.
 *
 * Resume rules: most recent Thread for the org+channel where the visitor's
 * participant is on `Thread.metadata.visitorParticipantId` AND status is OPEN
 * or WAITING. Closed/archived threads start a fresh thread.
 *
 * On create: writes `Thread.metadata.visit` and inserts a `ThreadParticipant`
 * row for the visitor so downstream code that joins on ThreadParticipant
 * (notification fan-out, agent inbox queries) sees them.
 */
export async function initializeOrResumeChatThread(
  ctx: ServiceContext,
  input: InitializeChatThreadInput
): Promise<TypedResult<InitializeChatThreadResult, Error>> {
  if (!input.channelId || !input.visitorId) {
    return Result.error(new BadRequestError('channelId and visitorId are required'))
  }

  try {
    const [integration] = await ctx.db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        organizationId: schema.Integration.organizationId,
        enabled: schema.Integration.enabled,
      })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, input.channelId))
      .limit(1)
    if (!integration || integration.provider !== 'chat') {
      return Result.error(new NotFoundError('Chat channel not found'))
    }
    if (integration.organizationId !== ctx.organizationId) {
      return Result.error(new ForbiddenError('Channel does not belong to org'))
    }
    if (!integration.enabled) {
      return Result.error(new ForbiddenError('Chat channel is disabled'))
    }

    const visitorResult = await findOrCreateVisitorParticipant(ctx, input.visitorId, {
      displayName: input.visitorName,
    })
    if (visitorResult.error) return Result.error(visitorResult.error)
    const visitor = visitorResult.value

    // Visitor explicitly asked to resume a specific thread (e.g. tapped a row
    // in the Messages tab). Verify ownership + that it lives on this channel,
    // then resume; otherwise reject — don't silently swap them onto a
    // different thread.
    if (input.resumeThreadId) {
      const [requested] = await ctx.db
        .select()
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, input.resumeThreadId),
            eq(schema.Thread.organizationId, ctx.organizationId),
            eq(schema.Thread.integrationId, integration.id)
          )
        )
        .limit(1)
      if (!requested) {
        return Result.error(new NotFoundError('Chat thread not found'))
      }
      const meta = (requested.metadata ?? {}) as Partial<ChatThreadMetadata>
      if (meta.channel !== 'chat' || meta.visitorParticipantId !== visitor.id) {
        return Result.error(new ForbiddenError('Chat thread does not belong to this visitor'))
      }
      logger.info('Resumed requested chat thread', {
        threadId: requested.id,
        visitorId: input.visitorId,
      })
      return Result.ok({
        thread: requested,
        isNew: false,
        visitorChatSessionId: requested.id,
      })
    }

    // Try to resume an open thread for this visitor on this channel.
    const candidateThreads = input.forceNewThread
      ? []
      : await ctx.db
          .select()
          .from(schema.Thread)
          .where(
            and(
              eq(schema.Thread.organizationId, ctx.organizationId),
              eq(schema.Thread.integrationId, integration.id),
              eq(schema.Thread.status, ThreadStatus.OPEN)
            )
          )
          .orderBy(desc(schema.Thread.lastMessageAt))
          .limit(20)

    const resumable = candidateThreads.find((t) => {
      const meta = (t.metadata ?? {}) as Partial<ChatThreadMetadata>
      return meta.channel === 'chat' && meta.visitorParticipantId === visitor.id
    })

    if (resumable) {
      // Patch metadata with the latest visit info / claimed identity.
      if (input.visit || input.visitorName || input.visitorEmail || input.visitorExternalId) {
        await patchChatThreadMetadata(ctx, resumable.id, {
          visit: input.visit,
          claimedVisitorEmail: input.visitorEmail,
          claimedVisitorName: input.visitorName,
          claimedExternalId: input.visitorExternalId,
        })
      }
      logger.info('Resumed chat thread', {
        threadId: resumable.id,
        visitorId: input.visitorId,
      })
      return Result.ok({
        thread: resumable,
        isNew: false,
        visitorChatSessionId: resumable.id,
      })
    }

    // Create a new thread.
    const now = new Date()
    const visitorLabel = formatVisitorLabel(visitor.identifier)
    const metadata: ChatThreadMetadata = {
      channel: 'chat',
      channelId: integration.id,
      visitorParticipantId: visitor.id,
      visit: input.visit,
      claimedVisitorEmail: input.visitorEmail,
      claimedVisitorName: input.visitorName,
      claimedExternalId: input.visitorExternalId,
      visitorLabel,
    }

    // Subject: friendlier `Chat #354b` when the visitor is still anonymous;
    // upgrade to `Chat with <claimed-name>` once the visitor identifies.
    const subject = input.visitorName
      ? `Chat with ${input.visitorName}`
      : formatVisitorThreadSubject(visitor.identifier)

    const [thread] = await ctx.db
      .insert(schema.Thread)
      .values({
        subject,
        organizationId: ctx.organizationId,
        integrationId: integration.id,
        status: ThreadStatus.OPEN,
        firstMessageAt: now,
        lastMessageAt: now,
        metadata,
      } as any)
      .returning()

    if (!thread) {
      return Result.error(new Error('Failed to create chat thread'))
    }

    // Visitor ThreadParticipant — keeps notification / inbox join code happy.
    await ctx.db
      .insert(schema.ThreadParticipant)
      .values({
        threadId: thread.id,
        email: visitor.identifier,
        name: visitor.name ?? null,
        isInternal: false,
        messageCount: 0,
        firstMessageAt: now,
        lastMessageAt: now,
      })
      .onConflictDoNothing()

    logger.info('Created new chat thread', {
      threadId: thread.id,
      visitorId: input.visitorId,
      channelId: integration.id,
    })

    return Result.ok({
      thread,
      isNew: true,
      visitorChatSessionId: thread.id,
    })
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
