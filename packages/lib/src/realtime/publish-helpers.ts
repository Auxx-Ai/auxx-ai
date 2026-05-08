// @auxx/lib/realtime/publish-helpers.ts

import { getOrgCache } from '../cache'
import type {
  FieldValueUpdateEntry,
  MailSyncEvent,
  MessageMeta,
  ParticipantMeta,
  ThreadMeta,
} from './events'
import type { RealtimeService } from './realtime-service'

const CHUNK_SIZE = 50

/**
 * Publish field value updates to the org channel, chunking if needed (Pusher 10KB limit).
 * Fire-and-forget — errors are logged by the provider, not thrown.
 *
 * Each entry can carry any combination of `value`, `aiStatus`, and
 * `aiMetadata`. Omit `value` to publish a pure AI-state transition (e.g. the
 * stage-1 enqueue or a stage-2 error); include both to commit a successful
 * AI generation. Omit the AI fields for regular writes.
 */
export async function publishFieldValueUpdates(
  realtimeService: RealtimeService,
  organizationId: string,
  entries: FieldValueUpdateEntry[],
  options?: { excludeSocketId?: string }
) {
  if (entries.length === 0) return

  // Check realtimeSync feature flag (cached per-org, fast lookup)
  const { features } = await getOrgCache().getOrRecompute(organizationId, ['features'])
  if (!features?.realtimeSync) return

  if (entries.length <= CHUNK_SIZE) {
    await realtimeService.sendToOrganization(
      organizationId,
      'fieldValues:updated',
      { entries },
      options
    )
    return
  }

  // Chunk into multiple messages
  const totalChunks = Math.ceil(entries.length / CHUNK_SIZE)
  const promises: Promise<boolean>[] = []

  for (let i = 0; i < totalChunks; i++) {
    const chunk = entries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    promises.push(
      realtimeService.sendToOrganization(
        organizationId,
        'fieldValues:updated',
        { entries: chunk, chunk: { index: i, total: totalChunks } },
        options
      )
    )
  }

  await Promise.allSettled(promises)
}

// ════════════════════════════════════════════════════════════════════════════
// Mail publish helpers — gated on `realtimeMail` feature flag
// ════════════════════════════════════════════════════════════════════════════

interface MailPublishOptions {
  excludeSocketId?: string
}

async function isMailRealtimeEnabled(organizationId: string): Promise<boolean> {
  const { features } = await getOrgCache().getOrRecompute(organizationId, ['features'])
  return Boolean(features?.realtimeMail)
}

/**
 * Publish `thread:created` on the inbox channel for the given thread.
 * `inboxId` is the raw EntityInstance id (or null for triage).
 */
export async function publishThreadCreated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { threadId: string; inboxId: string | null; inboxRecordId?: string | null },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  await realtimeService
    .sendToInbox(
      organizationId,
      args.inboxId,
      'thread:created',
      { threadId: args.threadId, inboxId: args.inboxRecordId ?? null },
      options
    )
    .catch(() => {})
}

/**
 * Publish `thread:updated` with a partial patch on the inbox channel.
 * Pass `previousInboxId` when a thread's inboxId changes — the helper will
 * publish on both the old and new channels so users on each side see the
 * transition (FE drops the row from the old via filter, fetches on the new).
 */
export async function publishThreadUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: {
    threadId: string
    inboxId: string | null
    previousInboxId?: string | null
    patch: Partial<ThreadMeta>
  },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  const payload = { threadId: args.threadId, patch: { id: args.threadId, ...args.patch } }
  const targets = new Set<string | null>([args.inboxId])
  if (args.previousInboxId !== undefined && args.previousInboxId !== args.inboxId) {
    targets.add(args.previousInboxId ?? null)
  }
  await Promise.allSettled(
    Array.from(targets).map((inboxId) =>
      realtimeService.sendToInbox(organizationId, inboxId, 'thread:updated', payload, options)
    )
  )
}

/** Publish `thread:deleted` on the inbox channel. */
export async function publishThreadDeleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { threadId: string; inboxId: string | null },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  await realtimeService
    .sendToInbox(
      organizationId,
      args.inboxId,
      'thread:deleted',
      { threadId: args.threadId },
      options
    )
    .catch(() => {})
}

/** Publish `message:created` on the inbox channel. */
export async function publishMessageCreated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { messageId: string; threadId: string; inboxId: string | null },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  await realtimeService
    .sendToInbox(
      organizationId,
      args.inboxId,
      'message:created',
      { messageId: args.messageId, threadId: args.threadId },
      options
    )
    .catch(() => {})
}

/** Publish `message:updated` with a partial patch on the inbox channel. */
export async function publishMessageUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: {
    messageId: string
    threadId: string
    inboxId: string | null
    patch: Partial<MessageMeta>
  },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  await realtimeService
    .sendToInbox(
      organizationId,
      args.inboxId,
      'message:updated',
      {
        messageId: args.messageId,
        threadId: args.threadId,
        patch: { id: args.messageId, threadId: args.threadId, ...args.patch },
      },
      options
    )
    .catch(() => {})
}

/** Publish `message:deleted` on the inbox channel. */
export async function publishMessageDeleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { messageId: string; threadId: string; inboxId: string | null },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  await realtimeService
    .sendToInbox(
      organizationId,
      args.inboxId,
      'message:deleted',
      { messageId: args.messageId, threadId: args.threadId },
      options
    )
    .catch(() => {})
}

/**
 * Publish `participant:updated` on the org channel. Participants aren't
 * inbox-scoped (a contact can be on threads across many inboxes) so this
 * stays org-wide for v1.
 */
export async function publishParticipantUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { participantId: string; patch: Partial<ParticipantMeta> },
  options?: MailPublishOptions
) {
  if (!(await isMailRealtimeEnabled(organizationId))) return
  await realtimeService
    .sendToOrganization(
      organizationId,
      'participant:updated',
      {
        participantId: args.participantId,
        patch: { id: args.participantId, ...args.patch },
      },
      options
    )
    .catch(() => {})
}

/**
 * Flush a list of mail events as one or more `mail:batch` frames on the inbox
 * channel. Used by ingest's initial-sync / polling-sync paths to coalesce
 * many events into a small number of frames. Events are chunked at
 * `CHUNK_SIZE` (50) per frame to stay under Pusher's 10KB limit.
 *
 * Events of mixed inboxId may be passed — they are bucketed and flushed per
 * inbox. Use `inboxId = null` for triage (unassigned).
 */
export async function flushMailBatch(
  realtimeService: RealtimeService,
  organizationId: string,
  events: Array<{ inboxId: string | null; event: MailSyncEvent }>,
  options?: MailPublishOptions
) {
  if (events.length === 0) return
  if (!(await isMailRealtimeEnabled(organizationId))) return

  const buckets = new Map<string, MailSyncEvent[]>()
  for (const { inboxId, event } of events) {
    const slug = inboxId ?? 'none'
    if (!buckets.has(slug)) buckets.set(slug, [])
    buckets.get(slug)!.push(event)
  }

  const promises: Promise<boolean>[] = []
  for (const [slug, list] of buckets) {
    const inboxId = slug === 'none' ? null : slug
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE)
      promises.push(
        realtimeService.sendToInbox(
          organizationId,
          inboxId,
          'mail:batch',
          { events: chunk },
          options
        )
      )
    }
  }
  await Promise.allSettled(promises)
}
