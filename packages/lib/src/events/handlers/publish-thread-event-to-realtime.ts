// packages/lib/src/events/handlers/publish-thread-event-to-realtime.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toActorId } from '@auxx/types/actor'
import { eq } from 'drizzle-orm'
import { getRealtimeService, rooms } from '../../realtime'
import { THREAD_EVENT_TYPES, VISITOR_FACING_THREAD_EVENT_TYPES } from '../../thread-events/client'
import { recordThreadEvent } from '../../thread-events/thread-event-mutations'
import type {
  AuxxEvent,
  ThreadArchivedEvent,
  ThreadAssigneeChangedEvent,
  ThreadMergedEvent,
  ThreadReopenedEvent,
  ThreadReturnedToAiEvent,
  ThreadTaggedEvent,
  ThreadTakenOverEvent,
  ThreadUntaggedEvent,
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
  | ThreadTaggedEvent
  | ThreadUntaggedEvent
  | ThreadMergedEvent

/**
 * Thread lifecycle event types this handler owns end-to-end (persistence +
 * realtime fan-out) — the full `THREAD_EVENT_TYPES` vocabulary from
 * `@auxx/lib/thread-events/client`. The generic `createEventJob` skips these
 * types so this handler is the single writer — that way the Pusher payload can
 * carry the row's `id` and `createdAt` for stable client-side dedupe.
 */
const OWNED_THREAD_EVENT_TYPES = new Set<string>(THREAD_EVENT_TYPES)

const VISITOR_FACING_TYPES = new Set<string>(VISITOR_FACING_THREAD_EVENT_TYPES)

/**
 * Resolve the acting principal for the persisted `ThreadEvent.actorId` column
 * as a branded `ActorId` string. Mirrors the mapping the admin renderer's
 * `pickActorUserId` historically dug out of `data` per type
 * (`system-line.tsx`): `thread:assignee:changed` narrates the NEW assignee, the
 * others carry the acting user. Null when the payload has no addressable actor
 * (e.g. `thread:visitor:identified`).
 */
function resolveActorId(event: RealtimeThreadEvent): string | null {
  // Explicit actor wins (thread-events §5.5): emitters that know their
  // principal write a branded `data.actorId` ('user:…' / 'agent:…', or null
  // for automation with `data.source` provenance). The userId/toUserId
  // derivation below remains only for in-flight legacy events.
  const explicit = (event.data as { actorId?: string | null }).actorId
  if (explicit !== undefined) return explicit
  const userId =
    event.type === 'thread:assignee:changed'
      ? event.data.toUserId
      : 'userId' in event.data
        ? event.data.userId
        : null
  return typeof userId === 'string' && userId ? toActorId('user', userId) : null
}

/**
 * Persist the thread lifecycle event AND push it onto the per-thread realtime
 * room so widget and admin clients can render centered system lines without
 * polling. Owns the `ThreadEvent` row insert for these types — the generic
 * `createEventJob` skips them (no `Event` row is written at all, plan
 * thread-events §12.1) so the inserted `id` and `createdAt` can be included in
 * the Pusher payload (downstream clients dedupe on `id`).
 */
export const publishThreadEventToRealtime = async ({ data: event }: { data: AuxxEvent }) => {
  if (!OWNED_THREAD_EVENT_TYPES.has(event.type)) return

  const typed = event as RealtimeThreadEvent
  const threadId = typed.data.threadId
  if (!threadId) {
    logger.warn('Thread event missing threadId; skipping realtime push', { type: event.type })
    return
  }

  const actorId = resolveActorId(typed)

  // Persist first — the realtime payload carries the row id so clients can
  // dedupe against the rows they load via the history endpoint.
  let row: { id: string; createdAt: Date } | undefined
  const persisted = await recordThreadEvent(database, {
    organizationId: typed.data.organizationId,
    threadId,
    type: typed.type,
    actorId,
    data: typed.data,
  })
  if (persisted.isOk()) {
    row = persisted.value
  } else {
    logger.error('Failed to persist thread event row', {
      type: event.type,
      threadId,
      error: persisted.error.message,
    })
  }

  const payload = {
    ...typed.data,
    id: row?.id,
    createdAt: row?.createdAt?.toISOString() ?? new Date().toISOString(),
    actorId,
  }

  // Per-thread room: the admin conversation panel and the widget's per-thread
  // subscription both listen here. This is the primary delivery path.
  //
  // Deliberately NOT routed through `shapeMailEventForLens`, unlike every other
  // mail publish path. `rooms.chatThread` admits an org member at
  // `satisfiesLens(lens, 'metadata')`, and all payloads are within that tier
  // (plan 45 §1.5 audit, resolved 2026-07-29; thread-events §13.6 for the
  // newer types):
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
  // Pinned by `publish-thread-event-to-realtime.test.ts` — if the participant
  // hydration path ever gains a lens gate, that assertion is the thing that has
  // to change, and this publish becomes a shaping site.
  try {
    await getRealtimeService().publish(rooms.chatThread(threadId), event.type, payload)
  } catch (error) {
    logger.error('Failed to publish thread event to realtime', {
      type: event.type,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Redundant fan-out to the visitor's per-thread-agnostic channel — gated on
  // the FROZEN visitor-facing set (thread-events §13.3.2): `rooms.visitor(...)`
  // is a public, unsigned channel, and the newer admin-surface types
  // (`thread:tagged` / `thread:untagged` / `thread:merged`) must never reach
  // it — even type + timestamp is an activity leak, and the principle is
  // allowlist. The widget only subscribes to the per-thread room while that
  // conversation is open, so without this fan-out a takeover that happens while
  // the visitor sits on Home (or whose per-thread subscription hiccuped) never
  // surfaces live. The visitor channel is always connected for the widget
  // session; the client dedupes against the per-thread delivery by event `id`.
  // Chat threads only — email threads carry no `visitorParticipantId` and
  // resolve to `null` here. Emitters carry the id on the event
  // (visitor:identified as `participantId`); the Thread SELECT remains only as
  // a fallback for in-flight legacy jobs.
  if (!VISITOR_FACING_TYPES.has(event.type)) return
  // Narrowed by the gate above: only the frozen six reach here, and all of
  // them carry `visitorParticipantId` (the newer admin-surface payloads don't
  // declare it, which is why the union needs the assertion).
  const carried = (typed.data as { visitorParticipantId?: string | null }).visitorParticipantId
  const visitorParticipantId =
    typed.type === 'thread:visitor:identified'
      ? typed.data.participantId
      : carried !== undefined
        ? carried
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
