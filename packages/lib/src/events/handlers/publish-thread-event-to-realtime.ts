// packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getRealtimeService, rooms } from '../../realtime'
import type {
  AuxxEvent,
  ThreadArchivedEvent,
  ThreadAssigneeChangedEvent,
  ThreadReopenedEvent,
  ThreadReturnedToAiEvent,
  ThreadTakenOverEvent,
  ThreadVisitorIdentifiedEvent,
} from '../types'
import { shapeThreadEventForVisitor } from '../visitor-event-shaping'

const logger = createScopedLogger('publish-thread-event-to-realtime')

type RealtimeThreadEvent =
  | ThreadArchivedEvent
  | ThreadReopenedEvent
  | ThreadTakenOverEvent
  | ThreadReturnedToAiEvent
  | ThreadAssigneeChangedEvent
  | ThreadVisitorIdentifiedEvent

/**
 * Thread lifecycle event types this handler owns end-to-end (persistence +
 * realtime fan-out). The generic `createEventJob` skips these types so this
 * handler is the single writer — that way the Pusher payload can carry the
 * row's `id` and `createdAt` for stable client-side dedupe.
 */
export const THREAD_REALTIME_EVENT_TYPES = new Set<AuxxEvent['type']>([
  'thread:archived',
  'thread:reopened',
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:assignee:changed',
  'thread:visitor:identified',
])

/**
 * Persist the thread lifecycle event AND push it onto the per-thread realtime
 * room so widget and admin clients can render centered system lines without
 * polling. Owns the `Event` row insert for these types — the generic
 * `createEventJob` skips them so the inserted `id` and `createdAt` can be
 * included in the Pusher payload (downstream clients dedupe on `id`).
 */
export const publishThreadEventToRealtime = async ({ data: event }: { data: AuxxEvent }) => {
  if (!THREAD_REALTIME_EVENT_TYPES.has(event.type)) return

  const typed = event as RealtimeThreadEvent
  const threadId = typed.data.threadId
  if (!threadId) {
    logger.warn('Thread event missing threadId; skipping realtime push', { type: event.type })
    return
  }

  // Persist first — the realtime payload carries the row id so clients can
  // dedupe against the rows they load via the history endpoint.
  let row: { id: string; createdAt: Date } | undefined
  try {
    const [inserted] = await database
      .insert(schema.Event)
      .values({
        organizationId: typed.data.organizationId,
        type: event.type,
        data: typed.data,
        updatedAt: new Date(),
      })
      .returning({ id: schema.Event.id, createdAt: schema.Event.createdAt })
    row = inserted
  } catch (error) {
    logger.error('Failed to persist thread event row', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const payload = {
    ...typed.data,
    id: row?.id,
    createdAt: row?.createdAt?.toISOString() ?? new Date().toISOString(),
  }

  // Per-thread room: the admin conversation panel and the widget's per-thread
  // subscription both listen here. This is the primary delivery path.
  //
  // Deliberately NOT routed through `shapeMailEventForLens`, unlike every other
  // mail publish path. `rooms.chatThread` admits an org member at
  // `satisfiesLens(lens, 'metadata')`, and all six payloads are within that tier
  // (plan 45 §1.5 audit, resolved 2026-07-29):
  //
  // - `userId` / `fromUserId` / `toUserId` / `previousState` map to `assigneeId`
  //   and `handoffState`, both in `THREAD_METADATA_FIELDS`.
  // - `visitorEmail` is the case that needed deciding, and it is metadata-tier:
  //   `participants` is itself a metadata field, and the ParticipantId[] it
  //   carries hydrates through `participant.getByIds` — a `mailProcedure` with
  //   no per-thread lens gate — into a `ParticipantMeta.identifier`, which for
  //   an EMAIL participant IS the address. A metadata-lens viewer can already
  //   read it via the `participantId` this same event carries, so withholding
  //   it here would hide nothing and only make the tiers disagree.
  //
  // Pinned by `__tests__/publish-thread-event-to-realtime.test.ts` — if the
  // participant hydration path ever gains a lens gate, that assertion is the
  // thing that has to change, and this publish becomes a shaping site.
  try {
    await getRealtimeService().publish(rooms.chatThread(threadId), event.type, payload)
  } catch (error) {
    logger.error('Failed to publish thread event to realtime', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Redundant fan-out to the visitor's per-thread-agnostic channel. The widget
  // only subscribes to the per-thread room while that conversation is open, so
  // without this a takeover that happens while the visitor sits on Home (or
  // whose per-thread subscription hiccuped) never surfaces live. The visitor
  // channel is always connected for the widget session; the client dedupes
  // against the per-thread delivery by event `id`. Chat threads only — email
  // threads carry no `visitorParticipantId` and resolve to `null` here.
  // Emitters carry the id on the event (visitor:identified as `participantId`);
  // the Thread SELECT remains only as a fallback for in-flight legacy jobs.
  const visitorParticipantId =
    typed.type === 'thread:visitor:identified'
      ? typed.data.participantId
      : typed.data.visitorParticipantId !== undefined
        ? typed.data.visitorParticipantId
        : await resolveVisitorParticipantId(threadId)
  if (visitorParticipantId) {
    try {
      // Shaped, NOT spread: this room is a public channel (plan 45 §1.5). The
      // widget keys its system lines off `type` alone, so the allowlist costs it
      // nothing. `loadThreadEvents` applies the same shaping to the history rows.
      await getRealtimeService().publish(
        rooms.visitor(visitorParticipantId),
        event.type,
        shapeThreadEventForVisitor(payload)
      )
    } catch (error) {
      logger.error('Failed to publish thread event to visitor channel', {
        type: event.type,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Resolve the chat visitor's Participant id from the thread's metadata, or
 * `null` for non-chat threads (which have no visitor channel to fan out to).
 */
async function resolveVisitorParticipantId(threadId: string): Promise<string | null> {
  try {
    const [row] = await database
      .select({ metadata: schema.Thread.metadata })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, threadId))
      .limit(1)
    const metadata = row?.metadata as { visitorParticipantId?: string } | null | undefined
    return metadata?.visitorParticipantId ?? null
  } catch {
    return null
  }
}
