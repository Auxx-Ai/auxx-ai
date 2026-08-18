// packages/lib/src/thread-events/thread-event-mutations.ts

import { type Database, schema } from '@auxx/database'
import type { Result } from 'neverthrow'
import { AuxxError } from '../errors'
import type { ThreadEventType } from './client'
import { guard } from './guard'
import type { RecordThreadEventInput, ThreadEventRow } from './types'

/**
 * Append one thread lifecycle event. Rows are append-only — there is no update
 * path by design.
 *
 * `id`/`createdAt` are normally omitted (schema defaults mint them); the
 * Phase 3 backfill passes both to preserve legacy `Event` ids and timestamps
 * so client dedupe-by-id survives the cut-over.
 *
 * NO access checks here — the caller (router / service emit site) asserts.
 */
export async function recordThreadEvent<T extends ThreadEventType>(
  db: Database,
  input: RecordThreadEventInput<T>
): Promise<Result<ThreadEventRow, Error>> {
  return guard(
    async () => {
      const [row] = await db
        .insert(schema.ThreadEvent)
        .values({
          ...(input.id ? { id: input.id } : {}),
          organizationId: input.organizationId,
          threadId: input.threadId,
          type: input.type,
          actorId: input.actorId ?? null,
          data: (input.data ?? {}) as Record<string, unknown>,
          ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        })
        .returning()

      if (!row) throw new AuxxError('Thread event insert returned no row')
      return row
    },
    'Failed to record thread event',
    { organizationId: input.organizationId, threadId: input.threadId, type: input.type }
  )
}
