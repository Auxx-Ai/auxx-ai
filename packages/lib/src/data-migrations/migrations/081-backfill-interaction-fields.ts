// packages/lib/src/data-migrations/migrations/081-backfill-interaction-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-081')

/** Threads scanned per statement. */
const BATCH_SIZE = 500

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * Seed `EntityInstance.first/lastInteractionAt(+MessageId)` and repair the
 * Participant interaction stamps from the message graph.
 *
 * **Why.** The interaction columns are new (records/interaction-fields plan) and
 * existing orgs already hold imported history; the ingest/sender touches only
 * cover messages stored after deploy. Participants are worse: their stamps were
 * written with `new Date()` (processing time), so a backfilled mailbox dated
 * every correspondent's "first interaction" as connect day.
 *
 * **What counts.** Messages with a real `sentAt`, excluding hard-tier machine
 * mail (`machineMailTier = 'hard'` — mirrors ingest's contact-graph rule; rows
 * ingested before tier detection shipped have NULL tier and count, accepted).
 * Entities are the thread's `primaryEntityInstanceId` plus active
 * `ThreadEntityLink` secondaries — same resolution as the live touch. Companies
 * then inherit min/max from their linked contacts via `contact_employer`.
 *
 * **Idempotent and live-safe.** Pure min/max recompute under the same
 * first-wins/last-wins guards the live path uses: a re-run is a no-op, and a
 * concurrent live stamp is never rewound.
 */
export const migration081BackfillInteractionFields: DataMigrationDef = {
  id: '081-backfill-interaction-fields',
  description: 'Seed entity first/last interaction stamps and repair participant stamps',
  async run(db: Database): Promise<void> {
    // ── Pass 1: thread-linked entities, batched by thread ──────────────────
    let cursor = ''
    let scanned = 0
    let stampedFirst = 0
    let stampedLast = 0
    let batches = 0

    for (;;) {
      const result = await db.execute<{
        lastId: string | null
        scanned: number
        first: number
        last: number
      }>(sql`
        WITH batch AS MATERIALIZED (
          SELECT id, "organizationId", "primaryEntityInstanceId"
          FROM "Thread"
          WHERE id > ${cursor}
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        ),
        agg AS (
          SELECT
            batch.id AS thread_id,
            batch."organizationId" AS org_id,
            batch."primaryEntityInstanceId" AS primary_entity_id,
            f.id AS first_msg_id, f."sentAt" AS first_at,
            l.id AS last_msg_id, l."sentAt" AS last_at
          FROM batch
          JOIN LATERAL (
            SELECT id, "sentAt" FROM "Message"
            WHERE "threadId" = batch.id AND "sentAt" IS NOT NULL
              AND "machineMailTier" IS DISTINCT FROM 'hard'
            ORDER BY "sentAt" ASC LIMIT 1
          ) f ON TRUE
          JOIN LATERAL (
            SELECT id, "sentAt" FROM "Message"
            WHERE "threadId" = batch.id AND "sentAt" IS NOT NULL
              AND "machineMailTier" IS DISTINCT FROM 'hard'
            ORDER BY "sentAt" DESC LIMIT 1
          ) l ON TRUE
        ),
        targets AS (
          SELECT DISTINCT e.entity_id, a.org_id, a.first_msg_id, a.first_at, a.last_msg_id, a.last_at
          FROM agg a
          JOIN (
            SELECT id AS thread_id, "primaryEntityInstanceId" AS entity_id FROM batch
            UNION ALL
            SELECT "threadId", "entityInstanceId"
            FROM "ThreadEntityLink"
            WHERE "threadId" IN (SELECT id FROM batch) AND "unlinkedAt" IS NULL
          ) e ON e.thread_id = a.thread_id
          WHERE e.entity_id IS NOT NULL
        ),
        -- A batch can hit one entity through several threads: collapse to the
        -- single oldest/newest candidate per entity before updating, because
        -- UPDATE ... FROM applies an arbitrary matching row, not the extreme one.
        first_targets AS (
          SELECT DISTINCT ON (entity_id) entity_id, org_id, first_at, first_msg_id
          FROM targets ORDER BY entity_id, first_at ASC
        ),
        last_targets AS (
          SELECT DISTINCT ON (entity_id) entity_id, org_id, last_at, last_msg_id
          FROM targets ORDER BY entity_id, last_at DESC
        ),
        first_upd AS (
          UPDATE "EntityInstance" ei
          SET "firstInteractionAt" = t.first_at, "firstInteractionMessageId" = t.first_msg_id
          FROM first_targets t
          WHERE ei.id = t.entity_id AND ei."organizationId" = t.org_id
            AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at)
          RETURNING ei.id
        ),
        last_upd AS (
          UPDATE "EntityInstance" ei
          SET "lastInteractionAt" = t.last_at, "lastInteractionMessageId" = t.last_msg_id
          FROM last_targets t
          WHERE ei.id = t.entity_id AND ei."organizationId" = t.org_id
            AND (ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at)
          RETURNING ei.id
        )
        SELECT
          (SELECT max(id) FROM batch) AS "lastId",
          (SELECT count(*) FROM batch)::int AS "scanned",
          (SELECT count(*) FROM first_upd)::int AS "first",
          (SELECT count(*) FROM last_upd)::int AS "last"
      `)

      const row = result.rows[0]
      if (!row?.lastId || Number(row.scanned) === 0) break

      cursor = row.lastId
      scanned += Number(row.scanned)
      stampedFirst += Number(row.first)
      stampedLast += Number(row.last)
      batches += 1

      if (batches % LOG_EVERY === 0) {
        logger.info('Backfilling entity interaction stamps', { scanned, stampedFirst, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Entity interaction pass done', { scanned, stampedFirst, stampedLast, batches })

    // ── Pass 2: propagate contact stamps to their linked companies ─────────
    // Companies are usually not thread-linked; they inherit the extreme stamps
    // of their `contact_employer`-linked contacts, message refs included.
    const companies = await db.execute<{ first: number; last: number }>(sql`
      WITH links AS (
        SELECT
          fv."relatedEntityId" AS company_id,
          fv."organizationId" AS org_id,
          c."firstInteractionAt" AS first_at, c."firstInteractionMessageId" AS first_msg_id,
          c."lastInteractionAt" AS last_at, c."lastInteractionMessageId" AS last_msg_id
        FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf.id = fv."fieldId" AND cf."systemAttribute" = 'contact_employer'
        JOIN "EntityInstance" c ON c.id = fv."entityId"
        WHERE fv."relatedEntityId" IS NOT NULL
      ),
      first_targets AS (
        SELECT DISTINCT ON (company_id) company_id, org_id, first_at, first_msg_id
        FROM links WHERE first_at IS NOT NULL ORDER BY company_id, first_at ASC
      ),
      last_targets AS (
        SELECT DISTINCT ON (company_id) company_id, org_id, last_at, last_msg_id
        FROM links WHERE last_at IS NOT NULL ORDER BY company_id, last_at DESC
      ),
      first_upd AS (
        UPDATE "EntityInstance" ei
        SET "firstInteractionAt" = t.first_at, "firstInteractionMessageId" = t.first_msg_id
        FROM first_targets t
        WHERE ei.id = t.company_id AND ei."organizationId" = t.org_id
          AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at)
        RETURNING ei.id
      ),
      last_upd AS (
        UPDATE "EntityInstance" ei
        SET "lastInteractionAt" = t.last_at, "lastInteractionMessageId" = t.last_msg_id
        FROM last_targets t
        WHERE ei.id = t.company_id AND ei."organizationId" = t.org_id
          AND (ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at)
        RETURNING ei.id
      )
      SELECT
        (SELECT count(*) FROM first_upd)::int AS "first",
        (SELECT count(*) FROM last_upd)::int AS "last"
    `)
    logger.info('Company propagation pass done', {
      first: Number(companies.rows[0]?.first ?? 0),
      last: Number(companies.rows[0]?.last ?? 0),
    })

    // ── Pass 3: repair Participant stamps from the participant's messages ──
    // firstInteractionDate = MIN(sentAt) over every message the participant
    // appears on; lastSentMessageAt = MAX(sentAt) over outbound messages where
    // they were a recipient. Same guards as live: never forward-date a first,
    // never rewind a last.
    const participants = await db.execute<{ first: number; last: number }>(sql`
      WITH first_targets AS (
        SELECT mp."participantId" AS participant_id, MIN(m."sentAt") AS first_at
        FROM "MessageParticipant" mp
        JOIN "Message" m ON m.id = mp."messageId"
        WHERE m."sentAt" IS NOT NULL AND m."machineMailTier" IS DISTINCT FROM 'hard'
        GROUP BY mp."participantId"
      ),
      last_sent_targets AS (
        SELECT mp."participantId" AS participant_id, MAX(m."sentAt") AS last_at
        FROM "MessageParticipant" mp
        JOIN "Message" m ON m.id = mp."messageId"
        WHERE m."sentAt" IS NOT NULL AND m."isInbound" = false
          AND mp.role IN ('TO', 'CC', 'BCC')
        GROUP BY mp."participantId"
      ),
      first_upd AS (
        UPDATE "Participant" p
        SET "firstInteractionDate" = t.first_at
        FROM first_targets t
        WHERE p.id = t.participant_id
          AND (p."firstInteractionDate" IS NULL OR p."firstInteractionDate" > t.first_at)
        RETURNING p.id
      ),
      last_upd AS (
        UPDATE "Participant" p
        SET "lastSentMessageAt" = t.last_at
        FROM last_sent_targets t
        WHERE p.id = t.participant_id
          AND (p."lastSentMessageAt" IS NULL OR p."lastSentMessageAt" < t.last_at)
        RETURNING p.id
      )
      SELECT
        (SELECT count(*) FROM first_upd)::int AS "first",
        (SELECT count(*) FROM last_upd)::int AS "last"
    `)
    logger.info('Participant repair pass done', {
      first: Number(participants.rows[0]?.first ?? 0),
      last: Number(participants.rows[0]?.last ?? 0),
    })
  },
}
