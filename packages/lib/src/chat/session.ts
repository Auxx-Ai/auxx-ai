// packages/lib/src/chat/session.ts

import { schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import type { ThreadEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, or } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { Result, type TypedResult } from '../result'
import type { ChatThreadMetadata } from '../threads/types'
import { formatVisitorThreadSubject } from './labels'
import { patchChatThreadMetadata } from './metadata'
import type { ServiceContext, VisitInfo } from './types'
import { findOrCreateVisitorParticipant } from './visitor-identity'
import { buildVisitorThreadOwnership } from './visitor-thread-ownership'

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
   * Verified Contact `EntityInstance.id` from the passport (set when the
   * caller's JWT was verified at mint). When present, the resume lookup also
   * matches threads whose inbound Participant has
   * `entityInstanceId = contactId` — that's what lets Alice's thread follow
   * her identity across devices / cleared cookies / new sessions.
   */
  contactId?: string
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
      const requestedOwnership = buildVisitorThreadOwnership({
        db: ctx.db,
        visitorParticipantId: visitor.id,
        contactId: input.contactId,
      })
      const [requested] = await ctx.db
        .select()
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, input.resumeThreadId),
            eq(schema.Thread.organizationId, ctx.organizationId),
            eq(schema.Thread.integrationId, integration.id),
            requestedOwnership
          )
        )
        .limit(1)
      if (!requested) {
        return Result.error(new ForbiddenError('Chat thread does not belong to this visitor'))
      }
      const meta = (requested.metadata ?? {}) as Partial<ChatThreadMetadata>
      if (meta.channel !== 'chat') {
        return Result.error(new NotFoundError('Chat thread not found'))
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

    // Try to resume an open thread for this visitor on this channel. Use
    // `Message.fromId` as the linkage rather than scanning the most recent 20
    // threads and filtering on `Thread.metadata->>visitorParticipantId`:
    //
    //   1. Correctness — on a busy public widget, 20 newer threads from other
    //      visitors mask this visitor's own thread, so we'd silently spawn a
    //      new one instead of resuming.
    //   2. Performance — `Message.fromId` is already indexed; this is a
    //      single indexed lookup vs. fetching 20 rows to keep at most 1.
    //
    // Empty-thread edge case: a brand-new thread the visitor hasn't sent into
    // yet won't match here. That's fine — `resumeThreadId` already handles
    // explicit reopen above, and a thread with zero messages has nothing to
    // resume into.
    // When the passport carries a verified `contactId`, broaden the join to
    // include any Participant linked to the same Contact — that's how Alice's
    // thread resumes on a fresh device where her new session Participant has
    // a different id but shares `entityInstanceId`.
    const fromMatch = input.contactId
      ? or(
          eq(schema.Message.fromId, visitor.id),
          eq(schema.Participant.entityInstanceId, input.contactId)
        )
      : eq(schema.Message.fromId, visitor.id)
    const candidateThreads = input.forceNewThread
      ? []
      : await ctx.db
          .selectDistinct({ thread: schema.Thread })
          .from(schema.Thread)
          .innerJoin(
            schema.Message,
            and(eq(schema.Message.threadId, schema.Thread.id), eq(schema.Message.isInbound, true))
          )
          .innerJoin(schema.Participant, eq(schema.Participant.id, schema.Message.fromId))
          .where(
            and(
              eq(schema.Thread.organizationId, ctx.organizationId),
              eq(schema.Thread.integrationId, integration.id),
              eq(schema.Thread.status, ThreadStatus.OPEN),
              fromMatch
            )
          )
          .orderBy(desc(schema.Thread.lastMessageAt))
          .limit(1)

    const resumable = candidateThreads[0]?.thread

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
    // Mirror the Participant's displayName onto the thread so the sidebar can
    // render the friendly handle ("Cyan Turtle from Inglewood") without an
    // extra Participant fetch. Falls back to identifier on the rare chance a
    // displayName isn't set.
    const visitorLabel = visitor.displayName ?? visitor.name ?? visitor.identifier
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
