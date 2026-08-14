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
 */
export const migration082InteractionFieldsParticipantResolution: DataMigrationDef = {
  id: '082-interaction-fields-participant-resolution',
  description: 'Backfill contact/company interaction stamps via participant resolution',
  async run(db: Database): Promise<void> {
    // ── Pass 1: contacts, batched by participant ───────────────────────────
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
          SELECT DISTINCT ON (contact_id) contact_id, org_id, sent_at, msg_id
          FROM msgs ORDER BY contact_id, sent_at DESC
        ),
        first_upd AS (
          UPDATE "EntityInstance" ei
          SET "firstInteractionAt" = t.sent_at, "firstInteractionMessageId" = t.msg_id
          FROM first_targets t
          WHERE ei.id = t.contact_id AND ei."organizationId" = t.org_id
            AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.sent_at)
          RETURNING ei.id
        ),
        last_upd AS (
          UPDATE "EntityInstance" ei
          SET "lastInteractionAt" = t.sent_at, "lastInteractionMessageId" = t.msg_id
          FROM last_targets t
          WHERE ei.id = t.contact_id AND ei."organizationId" = t.org_id
            AND (ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.sent_at)
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
        logger.info('Backfilling contact interaction stamps', { scanned, stampedFirst, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Contact interaction pass done', { scanned, stampedFirst, stampedLast, batches })

    // ── Pass 2: propagate contact stamps to their linked companies ─────────
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
  },
}
