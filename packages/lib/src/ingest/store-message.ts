// packages/lib/src/ingest/store-message.ts

import { schema } from '@auxx/database'
import { ParticipantRole as ParticipantRoleEnum, ThreadStatus } from '@auxx/database/enums'
import type {
  ParticipantEntity as Participant,
  ParticipantRole,
  ThreadStatus as ThreadStatusValue,
} from '@auxx/database/types'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { touchActivityForThreadLinks } from '../entity-instances/activity'
import { publisher } from '../events/publisher'
import type { MessageReceivedEvent } from '../events/types'
import { toInboxRecordId } from '../inbox-record-ids'
import {
  getRealtimeService,
  publishMessageCreated,
  publishThreadCreated,
  publishThreadUpdated,
} from '../realtime'
import { applyMailCountDeltas } from '../threads/mail-counts'
import type { IngestContext } from './context'
import { detectMachineMail } from './filtering/machine-mail'
import { shouldIgnoreMessage } from './filtering/should-ignore'
import { storeIgnoredMessage } from './filtering/store-ignored'
import { isPersonalInbox } from './inbox-meta'
import { findOrCreateParticipantRecord } from './participants/find-or-create'
import { determineIdentifierType, normalizeIdentifier } from './participants/normalize'
import { extractInternetMessageId } from './reconciliation/extract-internet-message-id'
import { reconcileMessage } from './reconciliation/reconcile-message'
import { updateThreadMetadataEfficient } from './threads/update-metadata'
import type { IntegrationSettings, MessageData, ParticipantInputData } from './types'

/**
 * Map Gmail labels to a thread status for personal channels (Gmail parity).
 * `INBOX` → OPEN; sent-only / archived / label-only mail → ARCHIVED (our "Done"
 * state); TRASH/SPAM map straight through. Shared inboxes never call this — they
 * keep everything-open helpdesk semantics.
 */
function deriveThreadStatusFromLabels(labelIds: string[]): ThreadStatusValue {
  if (labelIds.includes('TRASH')) return ThreadStatus.TRASH
  if (labelIds.includes('SPAM')) return ThreadStatus.SPAM
  return labelIds.includes('INBOX') ? ThreadStatus.OPEN : ThreadStatus.ARCHIVED
}

/**
 * Store a single inbound/outbound message with full ingest pipeline:
 * reconciliation → participants → thread upsert → message upsert →
 * message-participant links → thread metadata update.
 *
 * Returns the new or matched message id and whether it was newly inserted.
 * Mirrors the legacy `MessageStorageService.storeMessage` semantics byte-for-byte.
 */
export async function storeMessage(
  ctx: IngestContext,
  messageData: MessageData
): Promise<{ messageId: string; isNew: boolean }> {
  if (!messageData.from?.identifier) {
    throw new Error(
      `Message externalId ${messageData.externalId} is missing required sender identifier.`
    )
  }

  try {
    // Priority reconciliation by Internet Message-ID. Avoids duplicate threads/messages
    // when the same message arrives via two paths (e.g. local sent + provider pull).
    const existingByMsgId = messageData.internetMessageId
      ? (
          await ctx.db
            .select({
              id: schema.Message.id,
              threadId: schema.Message.threadId,
              externalId: schema.Message.externalId,
              textPlain: schema.Message.textPlain,
              textHtml: schema.Message.textHtml,
              metadata: schema.Message.metadata,
            })
            .from(schema.Message)
            .where(
              and(
                eq(schema.Message.organizationId, messageData.organizationId),
                eq(schema.Message.internetMessageId, messageData.internetMessageId)
              )
            )
            .limit(1)
        )?.[0]
      : null

    if (existingByMsgId) {
      ctx.logger.info('Reconciling message by internetMessageId', {
        messageId: existingByMsgId.id,
        internetMessageId: messageData.internetMessageId,
        incomingExternalId: messageData.externalId,
      })

      // Preserve the machine-mail flag through this wholesale metadata overwrite:
      // it was computed from headers at first insert (inbound path) and the
      // incoming reconcile payload — a provider re-pull or outbound echo — won't
      // carry it. Losing it here would silently un-gate the consumers downstream.
      const existingMachineMail = (existingByMsgId.metadata as any)?.machineMail
      const incomingMetadata = (messageData.metadata ?? {}) as Record<string, unknown>
      const reconciledMetadata =
        existingMachineMail && incomingMetadata.machineMail === undefined
          ? { ...incomingMetadata, machineMail: existingMachineMail }
          : incomingMetadata

      await ctx.db
        .update(schema.Message)
        .set({
          externalId: messageData.externalId,
          externalThreadId: messageData.externalThreadId,
          textPlain: existingByMsgId.textPlain ?? messageData.textPlain,
          textHtml: messageData.htmlBodyStorageLocationId
            ? null
            : (existingByMsgId.textHtml ?? messageData.textHtml),
          snippet: messageData.snippet ?? null,
          htmlBodyStorageLocationId: messageData.htmlBodyStorageLocationId ?? undefined,
          hasAttachments: messageData.hasAttachments,
          metadata: reconciledMetadata,
          receivedAt: messageData.receivedAt,
          sentAt: messageData.sentAt,
          historyId: messageData.historyId ? Number(messageData.historyId) : null,
          isInbound: messageData.isInbound,
          updatedAt: new Date(),
        })
        .where(eq(schema.Message.id, existingByMsgId.id))

      if (messageData.externalThreadId && existingByMsgId.threadId) {
        const [thread] = await ctx.db
          .select({ externalId: schema.Thread.externalId })
          .from(schema.Thread)
          .where(eq(schema.Thread.id, existingByMsgId.threadId))
          .limit(1)

        if (
          thread &&
          (!thread.externalId ||
            thread.externalId.startsWith('new_') ||
            thread.externalId.startsWith('pending_'))
        ) {
          await ctx.db
            .update(schema.Thread)
            .set({ externalId: messageData.externalThreadId })
            .where(eq(schema.Thread.id, existingByMsgId.threadId))

          ctx.logger.info('Updated thread with real externalId', {
            threadId: existingByMsgId.threadId,
            externalId: messageData.externalThreadId,
          })
        }
      }

      await updateThreadMetadataEfficient(ctx, existingByMsgId.threadId)
      return { messageId: existingByMsgId.id, isNew: false }
    }

    const existingMessage = await reconcileMessage(ctx, messageData)
    if (existingMessage) {
      ctx.logger.info('Message reconciled with existing record via MessageReconcilerService', {
        messageId: existingMessage.id,
        externalId: messageData.externalId,
      })

      if (existingMessage.threadId && messageData.externalThreadId) {
        const [thread] = await ctx.db
          .select({ externalId: schema.Thread.externalId })
          .from(schema.Thread)
          .where(eq(schema.Thread.id, existingMessage.threadId))
          .limit(1)

        const ext = thread?.externalId
        if (
          !ext ||
          ext.startsWith('new_') ||
          ext.startsWith('pending_') ||
          ext.startsWith('draft_') ||
          (ext.includes('-') && ext.length === 36)
        ) {
          await ctx.db
            .update(schema.Thread)
            .set({ externalId: messageData.externalThreadId })
            .where(eq(schema.Thread.id, existingMessage.threadId))

          ctx.logger.info('Promoted thread externalId from placeholder during reconciliation', {
            threadId: existingMessage.threadId,
            oldExternalId: ext,
            newExternalId: messageData.externalThreadId,
          })
        }
      }

      if (existingMessage.threadId) {
        await updateThreadMetadataEfficient(ctx, existingMessage.threadId)
      }

      return { messageId: existingMessage.id, isNew: false }
    }

    ctx.logger.info('Storing new message (Schema: Msg->Participant)', {
      externalId: messageData.externalId,
      integrationId: messageData.integrationId,
    })

    if (!ctx.integrationSettings && messageData.integrationId) {
      const [integration] = await ctx.db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, messageData.integrationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      ctx.integrationSettings =
        ((integration?.metadata as any)?.settings as IntegrationSettings | undefined) ?? undefined
    }

    if (shouldIgnoreMessage(ctx, messageData)) {
      return storeIgnoredMessage(ctx, messageData)
    }

    // Machine-mail detection (backscatter-loop prevention): header-only signals
    // (DSN content-type, null return-path, daemon senders, auto-submitted,
    // list/precedence/no-reply) computed once here so the `{ tier, reason }` flag
    // lands in the same write as the message insert below, and rides along on the
    // `message:received` event payload for the consumer gates to read (those gates
    // live in the event handlers — this only detects + flags). Inbound-only:
    // storeMessage's outbound traffic is provider sync echoing our own sent mail,
    // which is never machine mail.
    const machineMailResult = messageData.isInbound
      ? detectMachineMail({
          headers: (messageData.metadata as any)?.headers,
          fromEmail: messageData.from?.identifier ?? null,
        })
      : null
    if (machineMailResult) {
      ctx.logger.info('Flagged inbound message as machine mail', {
        externalId: messageData.externalId,
        tier: machineMailResult.tier,
        reason: machineMailResult.reason,
      })
    }
    const messageMetadata = machineMailResult
      ? { ...(messageData.metadata ?? {}), machineMail: machineMailResult }
      : messageData.metadata

    // Hard-tier machine mail (bounces/NDRs) must never grow the contact graph —
    // an NDR from mailer-daemon@ becoming a Contact fires `contact:created`
    // automations (the transitive backscatter loop). Participant rows are fine.
    const skipMachineMailContact = machineMailResult?.tier === 'hard'

    // Ingest guarantee (mail-permissions Phase 0): every thread must carry an
    // inboxId so it can't fall into the null-inbox visibility class. Resolve it
    // from the integration's InboxIntegration mapping when the caller didn't
    // supply one; a failure is logged (the column stays nullable defensively).
    // Resolved BEFORE participant processing so `participant:updated` events
    // can route to this inbox's lens channels (Phase 3 §6.2).
    let resolvedInboxId = messageData.inboxId ?? null
    if (!resolvedInboxId && messageData.integrationId) {
      const [link] = await ctx.db
        .select({ inboxId: schema.InboxIntegration.inboxId })
        .from(schema.InboxIntegration)
        .where(eq(schema.InboxIntegration.integrationId, messageData.integrationId))
        .limit(1)
      resolvedInboxId = link?.inboxId ?? null
      if (!resolvedInboxId) {
        ctx.logger.error('Thread ingest could not resolve an inboxId for integration', {
          integrationId: messageData.integrationId,
          organizationId: messageData.organizationId,
          externalThreadId: messageData.externalThreadId,
        })
      }
    }

    // Personal-channel label-derived status (Gmail parity). Shared inboxes keep
    // everything-open helpdesk semantics — byte-for-byte today's behavior. The
    // `labelIds` ride in memory on `messageData` and are never persisted; we
    // only consult them here at decision time.
    const personalInbox = await isPersonalInbox(ctx, resolvedInboxId)
    const labelIds = messageData.labelIds ?? []
    const hasInboxLabel = labelIds.includes('INBOX')
    const newThreadStatus = personalInbox
      ? deriveThreadStatusFromLabels(labelIds)
      : ThreadStatus.OPEN

    // Resolved (role, participantId) pairs for MessageParticipant links,
    // captured while processing so the link insert doesn't re-derive
    // identifier types.
    const resolvedParticipantLinks: Array<{ role: ParticipantRole; participantId: string }> = []

    // Per-message cache (NOT per-batch) — dedupes when the same identifier
    // appears in multiple roles on this message, and the iteration below is
    // how we derive the thread's participantCount. Sharing across messages
    // would over-count.
    const participantCache = new Map<string, Participant>()

    const processAndCacheParticipant = async (
      data: ParticipantInputData,
      role?: ParticipantRole
    ): Promise<Participant | null> => {
      if (!data?.identifier) return null
      const identifierType = await determineIdentifierType(
        ctx,
        data.identifier,
        messageData.integrationId
      )
      const normalizedId = normalizeIdentifier(data.identifier, identifierType)
      const cacheKey = `${identifierType}:${normalizedId}`

      const cached = participantCache.get(cacheKey)
      if (cached) return cached

      const messageContext = role ? { isInbound: messageData.isInbound, role } : undefined

      const participantRecord = await findOrCreateParticipantRecord(
        ctx,
        data,
        identifierType,
        messageContext,
        resolvedInboxId,
        skipMachineMailContact
      )
      participantCache.set(cacheKey, participantRecord)
      return participantRecord
    }

    const allInputs = [
      { role: ParticipantRoleEnum.FROM, data: messageData.from },
      ...messageData.to.map((p) => ({ role: ParticipantRoleEnum.TO, data: p })),
      ...(messageData.cc || []).map((p) => ({ role: ParticipantRoleEnum.CC, data: p })),
      ...(messageData.bcc || []).map((p) => ({ role: ParticipantRoleEnum.BCC, data: p })),
      ...(messageData.replyTo || []).map((p) => ({ role: ParticipantRoleEnum.REPLY_TO, data: p })),
    ]

    for (const { role, data } of allInputs) {
      if (data?.identifier) {
        const participant = await processAndCacheParticipant(data, role)
        if (participant?.id) {
          resolvedParticipantLinks.push({ role, participantId: participant.id })
        } else {
          ctx.logger.error(
            `Participant record missing for ${data.identifier} while collecting MessageParticipant links.`
          )
        }
      } else {
        ctx.logger.warn('Skipping participant input due to missing identifier', { role })
      }
    }

    const senderParticipant = await processAndCacheParticipant(
      messageData.from,
      ParticipantRoleEnum.FROM
    )
    if (!senderParticipant) {
      throw new Error(`Failed to process sender participant for message ${messageData.externalId}`)
    }
    const senderParticipantId = senderParticipant.id

    let firstReplyToParticipantId: string | null = null
    const firstReplyTo = messageData.replyTo?.[0]
    if (firstReplyTo) {
      const replyToParticipant = await processAndCacheParticipant(
        firstReplyTo,
        ParticipantRoleEnum.REPLY_TO
      )
      firstReplyToParticipantId = replyToParticipant?.id ?? null
    }

    const currentMessageParticipantIds: string[] = []
    for (const participant of participantCache.values()) {
      if (participant?.id) currentMessageParticipantIds.push(participant.id)
    }

    // Core write set in one transaction: thread upsert → message upsert →
    // latestMessageId → MessageParticipant links. One pool acquire, atomic.
    // Participant upserts stay OUTSIDE — they publish realtime events and
    // create contacts, which must not run inside a transaction holding a
    // connection against the 30s idle-in-transaction timeout.
    const txResult = await ctx.db.transaction(async (tx) => {
      const threadData = await tx
        .insert(schema.Thread)
        .values({
          externalId: messageData.externalThreadId,
          integrationId: messageData.integrationId,
          organizationId: messageData.organizationId,
          inboxId: resolvedInboxId,
          subject: messageData.subject ?? 'No Subject',
          status: newThreadStatus,
          firstMessageAt: messageData.sentAt,
          lastMessageAt: messageData.sentAt,
          messageCount: 1,
          participantCount: currentMessageParticipantIds.length,
        })
        .onConflictDoUpdate({
          target: [schema.Thread.integrationId, schema.Thread.externalId],
          set: {
            subject: messageData.subject || undefined,
            inboxId: resolvedInboxId ?? undefined,
          },
        })
        .returning({
          id: schema.Thread.id,
          inboxId: schema.Thread.inboxId,
          status: schema.Thread.status,
          assigneeId: schema.Thread.assigneeId,
          messageCount: schema.Thread.messageCount,
          firstMessageAt: schema.Thread.firstMessageAt,
          lastMessageAt: schema.Thread.lastMessageAt,
          participantCount: schema.Thread.participantCount,
        })

      // `INSERT … ON CONFLICT DO UPDATE … RETURNING` always yields exactly one
      // row (unlike DO NOTHING, which returns none on a conflict), so this is a
      // shape assertion, not a recoverable case. Throwing rolls the whole write
      // set back rather than proceeding with a half-built thread.
      const thread = threadData[0]
      if (!thread) {
        throw new Error(
          `Thread upsert returned no row for externalThreadId ${messageData.externalThreadId} (integration ${messageData.integrationId})`
        )
      }

      const isNewThread =
        (thread.messageCount ?? 0) === 1 &&
        thread.firstMessageAt?.getTime() === messageData.sentAt.getTime()

      // Gmail parity: a thread with any INBOX message belongs in the inbox.
      // Reopen an ARCHIVED personal-channel thread when this message carries
      // INBOX. Never flip OPEN→ARCHIVED from a message insert (order-independent
      // during backfill), and never reopen TRASH/SPAM. `thread.status` stays the
      // pre-reopen value in memory so the count/realtime gates below can tell a
      // reopen from a steady-state insert.
      const didReopen =
        personalInbox && !isNewThread && hasInboxLabel && thread.status === ThreadStatus.ARCHIVED
      if (didReopen) {
        await tx
          .update(schema.Thread)
          .set({ status: ThreadStatus.OPEN })
          .where(eq(schema.Thread.id, thread.id))
      }

      // An inbound reply makes the thread unread again for everyone who had
      // read it. One bounded UPDATE (rows exist only for users who read it);
      // users with no row are already "unread" by definition. RETURNING feeds
      // the count deltas below.
      let flippedUserIds: string[] = []
      if (!isNewThread && messageData.isInbound) {
        const flipped = await tx
          .update(schema.ThreadReadStatus)
          .set({ isRead: false })
          .where(
            and(
              eq(schema.ThreadReadStatus.threadId, thread.id),
              eq(schema.ThreadReadStatus.isRead, true)
            )
          )
          .returning({ userId: schema.ThreadReadStatus.userId })
        flippedUserIds = flipped.map((f) => f.userId)
      }

      const messageRecords = await tx
        .insert(schema.Message)
        .values({
          externalThreadId: messageData.externalThreadId,
          threadId: thread.id,
          organizationId: messageData.organizationId,
          integrationId: messageData.integrationId,
          historyId: messageData.historyId ? Number(messageData.historyId) : null,
          createdAt: messageData.createdTime,
          updatedAt: new Date(),
          sentAt: messageData.sentAt,
          receivedAt: messageData.receivedAt,
          internetMessageId: extractInternetMessageId(messageData) || messageData.internetMessageId,
          subject: messageData.subject ?? '',
          hasAttachments: messageData.hasAttachments,
          textHtml: messageData.htmlBodyStorageLocationId ? null : messageData.textHtml,
          textPlain: messageData.textPlain,
          snippet: messageData.snippet,
          htmlBodyStorageLocationId: messageData.htmlBodyStorageLocationId ?? null,
          metadata: messageMetadata || null,
          machineMailTier: machineMailResult?.tier ?? null,
          isInbound: messageData.isInbound,
          isFirstInThread: isNewThread,
          fromId: senderParticipantId,
          replyToId: firstReplyToParticipantId,
        })
        .onConflictDoUpdate({
          target: [schema.Message.integrationId, schema.Message.externalId],
          set: {
            threadId: thread.id,
            historyId: messageData.historyId ? Number(messageData.historyId) : null,
            updatedAt: new Date(),
            sentAt: messageData.sentAt,
            receivedAt: messageData.receivedAt,
            subject: messageData.subject || '',
            hasAttachments: messageData.hasAttachments,
            textHtml: messageData.htmlBodyStorageLocationId ? null : messageData.textHtml,
            textPlain: messageData.textPlain,
            snippet: messageData.snippet,
            htmlBodyStorageLocationId: messageData.htmlBodyStorageLocationId ?? null,
            metadata: messageMetadata || null,
            machineMailTier: machineMailResult?.tier ?? null,
            isInbound: messageData.isInbound,
            fromId: senderParticipantId,
            replyToId: firstReplyToParticipantId,
          },
        })
        .returning({ id: schema.Message.id })

      // Same guarantee as the thread upsert above — DO UPDATE always returns
      // the row. Asserted here so the MessageParticipant / ThreadParticipant
      // writes below can't insert links against an undefined messageId.
      const messageRecord = messageRecords[0]
      if (!messageRecord) {
        throw new Error(
          `Message upsert returned no row for externalId ${messageData.externalId} (integration ${messageData.integrationId})`
        )
      }

      if (isNewThread && messageRecord.id) {
        await tx
          .update(schema.Thread)
          .set({ latestMessageId: messageRecord.id })
          .where(eq(schema.Thread.id, thread.id))
      }

      if (resolvedParticipantLinks.length > 0) {
        await tx
          .insert(schema.MessageParticipant)
          .values(
            resolvedParticipantLinks.map(({ role, participantId }) => ({
              messageId: messageRecord.id,
              participantId,
              role,
            }))
          )
          .onConflictDoNothing()
      }

      // Thread-grained participant rollup (mail-permissions §2.4): mail ingest
      // didn't write ThreadParticipant rows before — only chat + merges did.
      // Carrying `entityInstanceId` gives contact-derived sharing one indexed
      // thread-grained join instead of Message ⋈ MessageParticipant per thread.
      const rollupRows = Array.from(participantCache.values())
        .filter((p): p is Participant => !!p?.identifier)
        .map((p) => ({
          threadId: thread.id,
          email: p.identifier,
          name: p.name ?? null,
          entityInstanceId: p.entityInstanceId ?? null,
          isInternal: p.isInternal,
          messageCount: 1,
          firstMessageAt: messageData.sentAt,
          lastMessageAt: messageData.sentAt,
        }))
      if (rollupRows.length > 0) {
        await tx
          .insert(schema.ThreadParticipant)
          .values(rollupRows)
          .onConflictDoUpdate({
            target: [schema.ThreadParticipant.threadId, schema.ThreadParticipant.email],
            set: {
              messageCount: sql`${schema.ThreadParticipant.messageCount} + 1`,
              firstMessageAt: sql`LEAST(${schema.ThreadParticipant.firstMessageAt}, excluded."firstMessageAt")`,
              lastMessageAt: sql`GREATEST(${schema.ThreadParticipant.lastMessageAt}, excluded."lastMessageAt")`,
              // Prefer a freshly resolved contact link / name; keep the old one otherwise.
              entityInstanceId: sql`COALESCE(excluded."entityInstanceId", ${schema.ThreadParticipant.entityInstanceId})`,
              name: sql`COALESCE(excluded."name", ${schema.ThreadParticipant.name})`,
            },
          })
      }

      return { thread, isNewThread, messageRecord, flippedUserIds, didReopen }
    })
    const { thread, isNewThread, messageRecord, flippedUserIds, didReopen } = txResult

    // Reply-detection hook (Sequences plan §3.3/Phase 2; client-notifications plan §4.4 gates
    // it on `Sequence.exitOnReply`) — an inbound message on a thread with an active
    // SequenceRun exits that run (reason 'reply') ONLY when its sequence opted in
    // (`exitOnReply=true`, the default — a "see you then!" reply to a day-of visit reminder
    // must not kill it). One indexed lookup on the hot path, no-op on a miss (the vast
    // majority of inbound mail has no sequence attached). Dynamic import to keep this module
    // free of any static dependency on the sequences module; best-effort — never let a
    // sequence-exit hiccup fail message ingestion.
    if (messageData.isInbound) {
      try {
        const activeRun = await ctx.db.query.SequenceRun.findFirst({
          where: (t, { eq: eqOp, and: andOp }) =>
            andOp(
              eqOp(t.threadId, thread.id),
              eqOp(t.organizationId, messageData.organizationId),
              eqOp(t.status, 'active')
            ),
          columns: { id: true, sequenceId: true },
        })
        if (activeRun) {
          const sequence = await ctx.db.query.Sequence.findFirst({
            where: (t, { eq: eqOp }) => eqOp(t.id, activeRun.sequenceId),
            columns: { exitOnReply: true },
          })
          if (sequence?.exitOnReply) {
            const { exitSequenceRun } = await import('../sequences/runtime')
            await exitSequenceRun(ctx.db, {
              sequenceRunId: activeRun.id,
              organizationId: messageData.organizationId,
              reason: 'reply',
              metadata: { messageId: messageRecord.id },
            })
          }
        }
      } catch (error) {
        ctx.logger.error('Sequence reply-detection hook failed (non-fatal)', {
          threadId: thread.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    ctx.logger.debug(
      `Created/Skipped ${resolvedParticipantLinks.length} MessageParticipant links for message ${messageRecord.id}`
    )

    const shouldUpdateThreadMetadata =
      !isNewThread &&
      (!thread.firstMessageAt ||
        !thread.lastMessageAt ||
        messageData.sentAt < thread.firstMessageAt ||
        messageData.sentAt > thread.lastMessageAt)

    if (shouldUpdateThreadMetadata) {
      await updateThreadMetadataEfficient(ctx, thread.id)
    }

    // Advance lastActivityAt for any entity linked to this thread (primary +
    // active secondaries). Best-effort; helper logs and swallows on failure.
    await touchActivityForThreadLinks(thread.id, messageData.organizationId, messageData.sentAt)

    // Realtime publish — message:created (and thread:created on a brand-new
    // thread). During a sync batch, suppress per-message events entirely and
    // just record the inbox as touched; the orchestrator emits one
    // `inbox:syncCompleted` per touched inbox at the end so the FE refreshes
    // `thread.listIds` once instead of fetching every id.
    const inboxIdForChannel = thread.inboxId ?? null
    if (ctx.inSyncBatch) {
      ctx.touchedInboxIds.add(inboxIdForChannel)
    } else {
      // Counter deltas (post-commit — a rolled-back tx must not move counters).
      // Counts include only OPEN threads; the upsert never reopens archived
      // threads, so gate on the returned status. New threads count regardless
      // of direction (no read rows = unread for everyone, matching the
      // reconcile queries). During sync batches this is skipped entirely —
      // the orchestrator marks counts stale once at the end.
      if (
        (didReopen || messageData.isInbound || isNewThread) &&
        (didReopen || thread.status === ThreadStatus.OPEN) &&
        inboxIdForChannel
      ) {
        // A reopened archived thread re-enters the inbox for the full-lens
        // audience — same deltas as a brand-new OPEN thread. New-thread audience
        // = members who see this inbox at `full` (§10.1) — sub-full viewers have
        // no unread state, so no badge movement. Flipped users on existing
        // threads had read rows, i.e. full access already.
        const userIds =
          isNewThread || didReopen
            ? await import('../permissions/visibility/audience').then((m) =>
                m.getFullLensAudienceForInbox(messageData.organizationId, inboxIdForChannel)
              )
            : flippedUserIds
        await applyMailCountDeltas(
          messageData.organizationId,
          userIds.map((userId) => ({
            userId,
            deltas: {
              [`si:${inboxIdForChannel}`]: 1,
              ...(thread.assigneeId === userId ? { inbox: 1 } : {}),
            },
          }))
        )
      }
      const realtime = getRealtimeService()
      if (isNewThread) {
        // A message can land in a personal mailbox, which lives on the
        // `personal_inbox` definition (plan 40 §3 / 40a §5.1) — hard-coding
        // `'inbox'` here would ship every new personal thread to the FE with a
        // RecordId whose def no longer owns the instance. Resolved from the
        // merged `inboxes` org cache (no DB hop), and computed HERE rather than
        // beside `inboxIdForChannel` so the sync-batch path — the hot one, it
        // publishes nothing — pays nothing for it.
        const inboxRecordId = inboxIdForChannel
          ? await toInboxRecordId(messageData.organizationId, inboxIdForChannel)
          : null
        await publishThreadCreated(
          realtime,
          messageData.organizationId,
          {
            threadId: thread.id,
            inboxId: inboxIdForChannel,
            inboxRecordId,
            assigneeId: thread.assigneeId ?? null,
          },
          { excludeSocketId: ctx.socketId }
        )
      } else if (didReopen) {
        await publishThreadUpdated(
          realtime,
          messageData.organizationId,
          {
            threadId: thread.id,
            inboxId: inboxIdForChannel,
            assigneeId: thread.assigneeId ?? null,
            patch: { status: ThreadStatus.OPEN },
          },
          { excludeSocketId: ctx.socketId }
        )
      }
      await publishMessageCreated(
        realtime,
        messageData.organizationId,
        {
          messageId: messageRecord.id,
          threadId: thread.id,
          inboxId: inboxIdForChannel,
          assigneeId: thread.assigneeId ?? null,
        },
        { excludeSocketId: ctx.socketId }
      )
    }

    // Workflow trigger bus event — fans out to the MESSAGE_RECEIVED workflow
    // trigger (`triggerMessageWorkflows`) and the contact timeline handler
    // (`createTimelineEvent`). Gated three ways:
    //  - inbound only: `storeMessage` is never on the compose/send path (that's
    //    `MessageComposerService.createPendingMessage`); the only outbound
    //    traffic here is provider sync echoing our own sent mail, so gating on
    //    `isInbound` fully covers "a workflow that sends mail must not
    //    re-trigger itself".
    //  - genuinely NEW row only: every dedup/reconciliation branch above
    //    (internetMessageId match, `reconcileMessage` match, duplicate-key
    //    catch) returns early with `isNew: false` — this line only runs on
    //    the fresh-insert path, so re-ingest of an already-stored message
    //    never re-emits.
    //  - `!ctx.isInitialSync`: a first-connect Gmail/Outlook backfill must not
    //    fire thousands of workflow runs. Gmail/Outlook set this via
    //    `MessageStorageService.setInitialSyncMode` on their backfill
    //    branches (see `sync-messages.ts` / `outlook-provider.ts`); live
    //    webhook ingest (SES inbound, OpenPhone/Facebook/Instagram routes)
    //    never touches sync mode, so it stays `false` and always fires.
    // Best-effort — `publisher.publishLater` swallows its own errors and
    // never throws, so this can't fail message ingestion.
    if (messageData.isInbound && !ctx.isInitialSync) {
      await publisher.publishLater({
        type: 'message:received',
        data: {
          messageId: messageRecord.id,
          organizationId: messageData.organizationId,
          ...(senderParticipant.entityInstanceId && {
            recordId: toRecordId('contact', senderParticipant.entityInstanceId),
          }),
          threadId: thread.id,
          subject: messageData.subject ?? undefined,
          from: senderParticipant.identifier,
          snippet: messageData.snippet ?? undefined,
          ...(machineMailResult && { machineMail: machineMailResult }),
        },
      } as MessageReceivedEvent)
    }

    ctx.logger.info('Message stored successfully (Revised Schema v2)', {
      messageId: messageRecord.id,
      externalId: messageData.externalId,
    })
    return { messageId: messageRecord.id, isNew: true }
  } catch (error: any) {
    ctx.logger.error('Error storing message (Revised Schema v2):', {
      error: error.message,
      externalId: messageData?.externalId ?? 'UNKNOWN',
      stack: error.stack,
    })
    if (error.message?.includes('duplicate key') || error.code === '23505') {
      ctx.logger.warn(
        `Unique constraint violation storing message ${messageData?.externalId ?? 'UNKNOWN'}. Assuming already processed.`
      )
      const [existing] = await ctx.db
        .select({ id: schema.Message.id })
        .from(schema.Message)
        .where(
          and(
            eq(schema.Message.integrationId, messageData.integrationId),
            eq(schema.Message.externalId, messageData.externalId)
          )
        )
        .limit(1)

      if (existing) return { messageId: existing.id, isNew: false }
    }
    throw error
  }
}
