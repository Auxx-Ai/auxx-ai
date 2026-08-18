// packages/lib/src/thread-events/thread-event-queries.ts

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../errors'
import { guard } from './guard'
import type { ListThreadEventsInput, ListThreadEventsResult, ThreadEventCursor } from './types'

const DEFAULT_LIMIT = 50

/**
 * Encode a keyset cursor as an opaque string. The wire format
 * (base64url of `<iso createdAt>|<id>`) is an implementation detail — callers
 * only ever round-trip the string.
 */
export function encodeThreadEventCursor(cursor: ThreadEventCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url')
}

/**
 * Decode an opaque cursor back into `(createdAt, id)`. Throws
 * {@link BadRequestError} on garbage input so a tampered cursor surfaces as a
 * 400, not a broken query.
 */
export function decodeThreadEventCursor(raw: string): ThreadEventCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8')
  const separator = decoded.indexOf('|')
  const id = separator === -1 ? '' : decoded.slice(separator + 1)
  const createdAt = new Date(decoded.slice(0, separator))
  if (separator === -1 || !id || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestError('Invalid thread event cursor')
  }
  return { createdAt, id }
}

/**
 * One page of a thread's events, newest first, keyset-paginated on
 * `(createdAt, id) DESC` (plans/threads/thread-events.md §13.4) so a later
 * page never skips or repeats rows when new events land mid-scroll. The
 * `ThreadEvent_thread_idx` index serves filter + order with no sort node.
 *
 * NO access checks here — the router resolves the viewer's mail lens and
 * gates at the `metadata` rung before calling (§13.6).
 */
export async function listThreadEvents(
  db: Database,
  input: ListThreadEventsInput
): Promise<Result<ListThreadEventsResult, Error>> {
  return guard(
    async () => {
      const limit = input.limit ?? DEFAULT_LIMIT

      const where: SQL[] = [
        eq(schema.ThreadEvent.organizationId, input.organizationId),
        eq(schema.ThreadEvent.threadId, input.threadId),
      ]

      if (input.cursor) {
        const cursor = decodeThreadEventCursor(input.cursor)
        const older = or(
          lt(schema.ThreadEvent.createdAt, cursor.createdAt),
          and(
            eq(schema.ThreadEvent.createdAt, cursor.createdAt),
            lt(schema.ThreadEvent.id, cursor.id)
          )
        )
        if (older) where.push(older)
      }

      // Fetch one extra row purely to learn whether an older page exists.
      const rows = await db
        .select()
        .from(schema.ThreadEvent)
        .where(and(...where))
        .orderBy(desc(schema.ThreadEvent.createdAt), desc(schema.ThreadEvent.id))
        .limit(limit + 1)

      const hasMore = rows.length > limit
      const events = hasMore ? rows.slice(0, limit) : rows
      const last = events.at(-1)
      const nextCursor =
        hasMore && last ? encodeThreadEventCursor({ createdAt: last.createdAt, id: last.id }) : null

      return { events, nextCursor }
    },
    'Failed to list thread events',
    { organizationId: input.organizationId, threadId: input.threadId }
  )
}
