// packages/lib/src/data-migrations/migrations/082-interaction-fields-participant-resolution.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-082')

/** Participants scanned per statement. */
const BATCH_SIZE = 1000

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * Re-run the interaction-fields backfill with the CORRECT target resolution.
 *
 * **Why.** Migration 081 resolved stamp targets via thread primaries +
 * `ThreadEntityLink` — but thread primaries are tickets/quotes, and
 * `ThreadEntityLink` rows exist only for manual links/merges/workflow nodes, so
 * contacts and companies (the point of the feature) got nothing. Contacts
 * attach to mail via `Participant.entityInstanceId`
 * (Message → MessageParticipant → Participant); the live write sites were
 * re-aimed the same way in the fix this migration ships with.
 *
 * **What counts** (same rules as 081/live): messages with a real `sentAt`,
 * excluding hard-tier machine mail; only non-internal participants with a
 * linked contact. Companies then inherit min/max from their linked contacts via
 * `contact_employer`. 081's ticket/quote stamps are left alone (harmless — no
 * registry fields on those types) and its participant repair pass was correct
 * and is not repeated.
 *
 * **Idempotent and live-safe.** Pure min/max recompute under the same
 * first-wins/last-wins guards the live path uses.
 *
 * **One UPDATE per pass, not one per direction.** Postgres does not support two
 * data-modifying CTEs touching the same row in a single statement — only one of
 * the writes is applied, silently. Separate `first_upd`/`last_upd` CTEs left
 * every backfilled row with `lastInteractionAt` NULL. Both column pairs are
 * therefore written by a single UPDATE with per-pair CASE guards.
 */
export const migration082InteractionFieldsParticipantResolution: DataMigrationDef = {
  id: '082-interaction-fields-participant-resolution',
  description: 'Backfill contact/company interaction stamps via participant resolution',
  async run(db: Database): Promise<void> {
    // ── Pass 1: contacts, batched by participant ───────────────────────────
    let cursor = ''
    let scanned = 0
    let stamped = 0
    let batches = 0

    for (;;) {
      const result = await db.execute<{
        lastId: string | null
        scanned: number
        stamped: number
      }>(sql`
        WITH batch AS MATERIALIZED (
          SELECT id, "entityInstanceId", "organizationId"
          FROM "Participant"
          WHERE id > ${cursor}
            AND "entityInstanceId" IS NOT NULL
            AND "isInternal" = false
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        ),
        msgs AS (
          SELECT
            b."entityInstanceId" AS contact_id,
            b."organizationId" AS org_id,
            m.id AS msg_id,
            m."sentAt" AS sent_at
          FROM batch b
          JOIN "MessageParticipant" mp ON mp."participantId" = b.id
          JOIN "Message" m ON m.id = mp."messageId"
          WHERE m."sentAt" IS NOT NULL
            AND m."machineMailTier" IS DISTINCT FROM 'hard'
        ),
        -- Several participants (email + phone identifier, say) can link the
        -- same contact within one batch: collapse to the single oldest/newest
        -- candidate per contact before updating, because UPDATE ... FROM
        -- applies an arbitrary matching row, not the extreme one. Cross-batch
        -- overlap converges via the monotonic guards.
        first_targets AS (
          SELECT DISTINCT ON (contact_id) contact_id, org_id, sent_at, msg_id
          FROM msgs ORDER BY contact_id, sent_at ASC
        ),
        last_targets AS (
          SELECT DISTINCT ON (contact_id) contact_id, sent_at, msg_id
          FROM msgs ORDER BY contact_id, sent_at DESC
        ),
        -- Every contact in first_targets is in last_targets (same source), so
        -- this inner join always pairs both extremes for the single UPDATE.
        targets AS (
          SELECT f.contact_id, f.org_id,
            f.sent_at AS first_at, f.msg_id AS first_msg_id,
            l.sent_at AS last_at, l.msg_id AS last_msg_id
          FROM first_targets f
          JOIN last_targets l ON l.contact_id = f.contact_id
        ),
        upd AS (
          UPDATE "EntityInstance" ei
          SET
            "firstInteractionAt" = CASE
              WHEN ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
              THEN t.first_at ELSE ei."firstInteractionAt" END,
            "firstInteractionMessageId" = CASE
              WHEN ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
              THEN t.first_msg_id ELSE ei."firstInteractionMessageId" END,
            "lastInteractionAt" = CASE
              WHEN ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at
              THEN t.last_at ELSE ei."lastInteractionAt" END,
            "lastInteractionMessageId" = CASE
              WHEN ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at
              THEN t.last_msg_id ELSE ei."lastInteractionMessageId" END
          FROM targets t
          WHERE ei.id = t.contact_id AND ei."organizationId" = t.org_id
            AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
              OR ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at)
          RETURNING ei.id
        )
        SELECT
          (SELECT max(id) FROM batch) AS "lastId",
          (SELECT count(*) FROM batch)::int AS "scanned",
          (SELECT count(*) FROM upd)::int AS "stamped"
      `)

      const row = result.rows[0]
      if (!row?.lastId || Number(row.scanned) === 0) break

      cursor = row.lastId
      scanned += Number(row.scanned)
      stamped += Number(row.stamped)
      batches += 1

      if (batches % LOG_EVERY === 0) {
        logger.info('Backfilling contact interaction stamps', { scanned, stamped, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Contact interaction pass done', { scanned, stamped, batches })

    // ── Pass 2: propagate contact stamps to their linked companies ─────────
    const companies = await db.execute<{ stamped: number }>(sql`
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
        SELECT DISTINCT ON (company_id) company_id, last_at, last_msg_id
        FROM links WHERE last_at IS NOT NULL ORDER BY company_id, last_at DESC
      ),
      -- Contacts carry both stamps or neither (single-UPDATE write above and on
      -- the live path), so the inner join pairs both extremes per company.
      targets AS (
        SELECT f.company_id, f.org_id,
          f.first_at, f.first_msg_id, l.last_at, l.last_msg_id
        FROM first_targets f
        JOIN last_targets l ON l.company_id = f.company_id
      ),
      upd AS (
        UPDATE "EntityInstance" ei
        SET
          "firstInteractionAt" = CASE
            WHEN ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
            THEN t.first_at ELSE ei."firstInteractionAt" END,
          "firstInteractionMessageId" = CASE
            WHEN ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
            THEN t.first_msg_id ELSE ei."firstInteractionMessageId" END,
          "lastInteractionAt" = CASE
            WHEN ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at
            THEN t.last_at ELSE ei."lastInteractionAt" END,
          "lastInteractionMessageId" = CASE
            WHEN ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at
            THEN t.last_msg_id ELSE ei."lastInteractionMessageId" END
        FROM targets t
        WHERE ei.id = t.company_id AND ei."organizationId" = t.org_id
          AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
            OR ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at)
        RETURNING ei.id
      )
      SELECT (SELECT count(*) FROM upd)::int AS "stamped"
    `)
    logger.info('Company propagation pass done', {
      stamped: Number(companies.rows[0]?.stamped ?? 0),
    })
  },
}
