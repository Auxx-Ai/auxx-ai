// packages/lib/src/data-migrations/migrations/032-backfill-thread-participants.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, isNotNull, sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-032')

const CHUNK = 1000

/**
 * Backfill the mail `ThreadParticipant` rollup (mail-permissions §2.4). Mail
 * ingest never wrote these rows historically — only chat + merges did — so
 * contact-derived thread access had no thread-grained join. This aggregates
 * `MessageParticipant ⋈ Message ⋈ Participant` per `(thread, email)`, carrying
 * the resolved `entityInstanceId` (contact link).
 *
 * Org-scoped implicitly: the group key is `Message.threadId` (one org) joined
 * to that org's `Participant` rows, so the same email maps to different
 * contacts in different orgs without merging. Idempotent: the upsert uses
 * GREATEST/LEAST/COALESCE, so a re-run (and coexistence with rows the new
 * ingest path already wrote) converges rather than double-counts.
 */
export const migration032BackfillThreadParticipants: DataMigrationDef = {
  id: '032-backfill-thread-participants',
  description: 'Backfill mail ThreadParticipant rollup + entityInstanceId from MessageParticipant',
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        threadId: schema.Message.threadId,
        email: schema.Participant.identifier,
        name: sql<string | null>`max(${schema.Participant.name})`,
        entityInstanceId: sql<string | null>`max(${schema.Participant.entityInstanceId})`,
        isInternal: sql<boolean>`bool_or(${schema.Participant.isInternal})`,
        messageCount: sql<number>`count(distinct ${schema.MessageParticipant.messageId})`,
        firstMessageAt: sql<Date>`min(coalesce(${schema.Message.sentAt}, ${schema.Message.receivedAt}, ${schema.Message.createdAt}))`,
        lastMessageAt: sql<Date>`max(coalesce(${schema.Message.sentAt}, ${schema.Message.receivedAt}, ${schema.Message.createdAt}))`,
      })
      .from(schema.MessageParticipant)
      .innerJoin(schema.Message, eq(schema.Message.id, schema.MessageParticipant.messageId))
      .innerJoin(
        schema.Participant,
        eq(schema.Participant.id, schema.MessageParticipant.participantId)
      )
      .where(isNotNull(schema.Message.threadId))
      .groupBy(schema.Message.threadId, schema.Participant.identifier)

    if (rows.length === 0) {
      logger.info('No MessageParticipant rows to roll up')
      return
    }

    let written = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        threadId: r.threadId!,
        email: r.email,
        name: r.name,
        entityInstanceId: r.entityInstanceId,
        isInternal: r.isInternal,
        messageCount: Number(r.messageCount),
        // Aggregate expressions come back as timestamp strings, not Dates —
        // coerce so the timestamp column encoder doesn't choke on toISOString().
        firstMessageAt: new Date(r.firstMessageAt),
        lastMessageAt: new Date(r.lastMessageAt),
      }))
      await db
        .insert(schema.ThreadParticipant)
        .values(chunk)
        .onConflictDoUpdate({
          target: [schema.ThreadParticipant.threadId, schema.ThreadParticipant.email],
          set: {
            messageCount: sql`GREATEST(${schema.ThreadParticipant.messageCount}, excluded."messageCount")`,
            firstMessageAt: sql`LEAST(${schema.ThreadParticipant.firstMessageAt}, excluded."firstMessageAt")`,
            lastMessageAt: sql`GREATEST(${schema.ThreadParticipant.lastMessageAt}, excluded."lastMessageAt")`,
            entityInstanceId: sql`COALESCE(${schema.ThreadParticipant.entityInstanceId}, excluded."entityInstanceId")`,
            name: sql`COALESCE(${schema.ThreadParticipant.name}, excluded."name")`,
          },
        })
      written += chunk.length
    }

    logger.info('Backfilled ThreadParticipant rollup', { groups: written })
  },
}
