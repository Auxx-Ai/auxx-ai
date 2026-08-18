// packages/lib/src/participants/publish-participant-changes.ts

import { createScopedLogger } from '@auxx/logger'
import type { ParticipantMeta as RealtimeParticipantMeta } from '../realtime/events'

const logger = createScopedLogger('participant-publish')

/**
 * The name-bearing `Participant` columns the non-ingest write paths can change.
 * Ingest's own diff (`ingest/participants/find-or-create.ts`) additionally
 * tracks `hasReceivedMessage` / `lastSentMessageAt`; the composer and chat
 * identity paths never touch those.
 */
export interface ParticipantNameColumns {
  name: string | null
  displayName: string | null
  isInternal?: boolean | null
}

/**
 * Routing context for a `participant:updated` publish — the inbox whose lens
 * channels receive the event (mail-permissions §6.2). `inboxId: null` falls
 * back to the admin-only `none` channel, same as ingest.
 */
export interface ParticipantPublishContext {
  inboxId: string | null
  /** Originating socket id for self-echo suppression. */
  excludeSocketId?: string
}

/**
 * Diff the tracked name columns of a participant row before/after a write into
 * a partial `participant:updated` patch. Empty object = nothing changed, don't
 * publish. Same column semantics as ingest's inline diff: `displayName` maps
 * null → undefined (the realtime field is `string | undefined`), and
 * `isInternal` is only compared when the write actually recomputed it.
 */
export function diffParticipantNamePatch(
  previous: ParticipantNameColumns,
  next: ParticipantNameColumns
): Partial<RealtimeParticipantMeta> {
  const patch: Partial<RealtimeParticipantMeta> = {}
  if (next.name !== previous.name) patch.name = next.name
  if (next.displayName !== previous.displayName) {
    patch.displayName = next.displayName ?? undefined
  }
  if (next.isInternal != null && next.isInternal !== previous.isInternal) {
    patch.isInternal = next.isInternal
  }
  return patch
}

/**
 * Fire-and-forget `participant:updated` publish through the shared inbox-lens
 * fanout ({@link import('../realtime').publishParticipantUpdated}). Never
 * throws into the caller's path — a realtime hiccup must not fail a send or a
 * chat identity claim. No-ops on an empty patch.
 *
 * The realtime barrel is imported lazily on purpose: a static import from this
 * low-level module widens the graph into the cache/kopilot cycle and silently
 * breaks `vi.mock` interception in lib test suites.
 */
export async function publishParticipantPatch(args: {
  organizationId: string
  participantId: string
  patch: Partial<RealtimeParticipantMeta>
  inboxId?: string | null
  excludeSocketId?: string
}): Promise<void> {
  if (Object.keys(args.patch).length === 0) return
  try {
    const { getRealtimeService, publishParticipantUpdated } = await import('../realtime')
    await publishParticipantUpdated(
      getRealtimeService(),
      args.organizationId,
      { participantId: args.participantId, patch: args.patch, inboxId: args.inboxId ?? null },
      args.excludeSocketId ? { excludeSocketId: args.excludeSocketId } : undefined
    )
  } catch (error) {
    logger.warn('participant:updated publish failed (ignored)', {
      participantId: args.participantId,
      organizationId: args.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
