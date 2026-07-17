// packages/lib/src/events/handlers/project-signal-to-timeline.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { isSignalKind, SIGNAL_KINDS, type SignalKind } from '../../signals/types'
import { ContactEventType, TimelineActorType } from '../../timeline/event-types'
import { TimelineService } from '../../timeline/timeline-service'
import type { AuxxEvent, SignalRecordedEvent } from '../types'

const logger = createScopedLogger('handler:project-signal-to-timeline')

/** System actor id stamped on every signal-derived timeline row. */
const SIGNAL_ACTOR_ID = 'signals'

type EntitySignalRow = typeof schema.EntitySignal.$inferSelect

/** Per-kind verb used for the coalesced 'grouped' row's title, e.g. `Opened "<title>"`. */
const GROUPED_VERB: Partial<Record<SignalKind, string>> = {
  'email:opened': 'Opened',
  'web:page_view': 'Viewed',
}

/**
 * Projects `signal:recorded` events onto the contact timeline, per the
 * `SIGNAL_KINDS[kind].timeline` policy (plans/signals/01-signal-store.md "Timeline
 * projection"):
 * - `'none'` → skip, the kind has its own surface or isn't display-worthy.
 * - `'always'` → one `TimelineEvent` row per signal.
 * - `'grouped'` → one row per (contact, kind, messageId-or-url, calendar day), incrementing
 *   a `count` in its metadata on repeat instead of writing a new row.
 *
 * Signals with no `contactEntityInstanceId` are skipped — v1 only projects onto the contact
 * timeline (entity-scoped signals land in a later phase). Missing signal rows (retention may
 * have pruned them between write and this handler running) are logged at debug and skipped,
 * never thrown — only a genuine DB failure should fail the job for a BullMQ retry.
 */
export const projectSignalToTimeline = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'signal:recorded') return

  const data = event.data as SignalRecordedEvent['data']
  const signalIds = data.signalIds && data.signalIds.length > 0 ? data.signalIds : [data.signalId]

  const rows = await db.query.EntitySignal.findMany({
    where: and(
      eq(schema.EntitySignal.organizationId, data.organizationId),
      inArray(schema.EntitySignal.id, signalIds)
    ),
  })

  if (rows.length === 0) {
    logger.debug('No EntitySignal rows found for signal:recorded (likely pruned)', {
      organizationId: data.organizationId,
      signalIds,
    })
    return
  }

  const timelineService = new TimelineService(db)

  try {
    for (const row of rows) {
      await projectOne(timelineService, row)
    }
  } catch (error) {
    logger.error('Failed to project signal onto timeline', {
      organizationId: data.organizationId,
      signalIds,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function projectOne(timelineService: TimelineService, row: EntitySignalRow): Promise<void> {
  if (!isSignalKind(row.kind)) {
    logger.debug('Unknown signal kind, skipping timeline projection', {
      signalId: row.id,
      kind: row.kind,
    })
    return
  }

  const meta = SIGNAL_KINDS[row.kind]
  if (meta.timeline === 'none') return

  if (!row.contactEntityInstanceId) {
    logger.debug('Signal has no contact, skipping timeline projection', {
      signalId: row.id,
      kind: row.kind,
    })
    return
  }

  if (meta.timeline === 'always') {
    await projectAlways(timelineService, row)
    return
  }

  await projectGrouped(timelineService, row)
}

async function projectAlways(
  timelineService: TimelineService,
  row: EntitySignalRow
): Promise<void> {
  const kind = row.kind as SignalKind
  await timelineService.createEvent({
    eventType: ContactEventType.SIGNAL,
    recordId: toRecordId('contact', row.contactEntityInstanceId!),
    actorType: TimelineActorType.SYSTEM,
    actorId: SIGNAL_ACTOR_ID,
    eventData: {
      kind,
      kindLabel: SIGNAL_KINDS[kind].label,
      title: row.title,
      subtype: row.subtype,
      ...(row.messageId && { messageId: row.messageId }),
      ...(row.threadId && { threadId: row.threadId }),
    },
    metadata: { signalId: row.id, kind },
    organizationId: row.organizationId,
    occurredAt: row.occurredAt,
  })
}

async function projectGrouped(
  timelineService: TimelineService,
  row: EntitySignalRow
): Promise<void> {
  const kind = row.kind as SignalKind
  const contactId = row.contactEntityInstanceId!
  const groupKey = resolveGroupKey(row)
  const { start, end, label } = dayBounds(row.occurredAt)

  const existing = await db.query.TimelineEvent.findFirst({
    where: and(
      eq(schema.TimelineEvent.organizationId, row.organizationId),
      eq(schema.TimelineEvent.entityType, 'contact'),
      eq(schema.TimelineEvent.entityId, contactId),
      eq(schema.TimelineEvent.eventType, ContactEventType.SIGNAL),
      gte(schema.TimelineEvent.startedAt, start),
      lt(schema.TimelineEvent.startedAt, end),
      sql`${schema.TimelineEvent.metadata}->>'signalGroupKey' = ${groupKey}`
    ),
  })

  if (existing) {
    const existingMetadata = (existing.metadata as Record<string, unknown> | null) ?? {}
    const prevCount = typeof existingMetadata.count === 'number' ? existingMetadata.count : 1
    await db
      .update(schema.TimelineEvent)
      .set({
        endedAt: row.occurredAt,
        updatedAt: new Date(),
        metadata: { ...existingMetadata, count: prevCount + 1, lastSignalId: row.id },
      })
      .where(eq(schema.TimelineEvent.id, existing.id))
    return
  }

  const verb = GROUPED_VERB[kind] ?? SIGNAL_KINDS[kind].label
  await timelineService.createEvent({
    eventType: ContactEventType.SIGNAL,
    recordId: toRecordId('contact', contactId),
    actorType: TimelineActorType.SYSTEM,
    actorId: SIGNAL_ACTOR_ID,
    eventData: {
      kind,
      kindLabel: SIGNAL_KINDS[kind].label,
      title: `${verb} "${row.title}"`,
      subtype: row.subtype,
      ...(row.messageId && { messageId: row.messageId }),
      ...(row.threadId && { threadId: row.threadId }),
    },
    metadata: { signalGroupKey: groupKey, signalDay: label, kind, count: 1, lastSignalId: row.id },
    organizationId: row.organizationId,
    occurredAt: row.occurredAt,
  })
}

/**
 * Grouping key for a 'grouped' kind: `messageId` for `email:opened`, a `url`-shaped metadata
 * field for `web:page_view` (no writer ships this kind yet, so the field name isn't final —
 * checked defensively). Falls back to the signal's own id, which degrades to one row per
 * signal (same as 'always') rather than mis-grouping unrelated signals together.
 */
function resolveGroupKey(row: EntitySignalRow): string {
  if (row.messageId) return row.messageId
  const metadata = row.metadata as Record<string, unknown> | null
  const url = metadata?.url ?? metadata?.pageUrl ?? metadata?.path
  if (typeof url === 'string' && url.length > 0) return url
  return row.id
}

/** UTC calendar-day bounds for `occurredAt`, plus an ISO date label for the metadata field. */
function dayBounds(occurredAt: Date): { start: Date; end: Date; label: string } {
  const start = new Date(
    Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate())
  )
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end, label: start.toISOString().slice(0, 10) }
}
