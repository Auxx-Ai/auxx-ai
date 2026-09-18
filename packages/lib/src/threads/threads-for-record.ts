// packages/lib/src/threads/threads-for-record.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'

/** One thread a record's mail lives on, whichever way it is linked. */
export interface RecordThread {
  id: string
  subject: string
}

/**
 * Every thread linked to a record, whether it is the thread's primary entity
 * (`Thread.primaryEntityInstanceId`) or a secondary link (`ThreadEntityLink`,
 * unlinked rows excluded). Twenty modules across `lib` derive this by hand
 * (`docs/channels-mail-architecture-guide.md`, which names this as the reader
 * for "threads of a record") — this is the one reader.
 *
 * Soft-merged threads (`Thread.mergedIntoThreadId` set) are included, unlike
 * `thread-query.service.ts` and `mail-query/condition-query-builder.ts`; a
 * caller that wants only live threads filters that column itself.
 */
export async function threadsForRecord(
  db: Database,
  organizationId: string,
  recordId: string
): Promise<RecordThread[]> {
  const [primary, secondary] = await Promise.all([
    db
      .select({ id: schema.Thread.id, subject: schema.Thread.subject })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.organizationId, organizationId),
          eq(schema.Thread.primaryEntityInstanceId, recordId)
        )
      ),
    db
      .select({ id: schema.Thread.id, subject: schema.Thread.subject })
      .from(schema.Thread)
      .innerJoin(schema.ThreadEntityLink, eq(schema.ThreadEntityLink.threadId, schema.Thread.id))
      .where(
        and(
          eq(schema.Thread.organizationId, organizationId),
          eq(schema.ThreadEntityLink.organizationId, organizationId),
          eq(schema.ThreadEntityLink.entityInstanceId, recordId),
          isNull(schema.ThreadEntityLink.unlinkedAt)
        )
      ),
  ])

  const byId = new Map<string, RecordThread>()
  for (const thread of [...primary, ...secondary]) {
    if (!byId.has(thread.id)) byId.set(thread.id, thread)
  }
  return [...byId.values()]
}
