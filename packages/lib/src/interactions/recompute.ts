// packages/lib/src/interactions/recompute.ts
//
// Recompute `first/lastInteractionAt(+MessageId)` for a set of records from the messages
// their participants appear on.
//
// The statement shape is `data-migrations/migrations/082-interaction-fields-participant-
// resolution.ts`, scoped to a record set instead of a participant cursor. It is copied
// rather than shared: a DataMigration has to stay self-sufficient, so it cannot call into a
// module that may be refactored under it later.
//
// 🔴 Two things in that shape are load-bearing, both learned the hard way:
//
//   1. `DISTINCT ON` collapses to the extreme row BEFORE the update. `UPDATE ... FROM`
//      applies an arbitrary matching row, not the min or the max, so several participants
//      resolving to one contact would otherwise stamp whichever the planner reached first.
//   2. **One** UPDATE writes both pairs, with per-pair `CASE` guards. Postgres silently
//      applies only ONE of two data-modifying CTEs that touch the same row — splitting
//      first/last into separate CTEs is exactly how migration 081 shipped with every
//      backfilled row carrying a `firstInteractionAt` and a NULL `lastInteractionAt`.
//
// Qualification matches the live path in `entity-instances/activity.ts`: a real `sentAt`,
// no hard-tier machine mail, non-internal participants only. The guards are the same
// first-wins / last-wins comparisons, so this converges with live writes in any order and
// re-running it is a no-op.

import { type Database, database as defaultDb } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'

const logger = createScopedLogger('interactions')

/** `'a', 'b', 'c'` for an `IN (...)` list. Never called with an empty list. */
function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )
}

/**
 * Stamp contacts from their own participants' messages.
 *
 * Returns the number of rows actually written — records whose stored values already win
 * both comparisons are excluded by the WHERE, so a second run over the same ids returns 0.
 */
export async function recomputeContactStamps(
  organizationId: string,
  contactIds: readonly string[],
  db: Database = defaultDb
): Promise<number> {
  if (contactIds.length === 0) return 0

  try {
    const result = await db.execute<{ stamped: number }>(sql`
      WITH msgs AS (
        SELECT
          p."entityInstanceId" AS contact_id,
          m.id AS msg_id,
          m."sentAt" AS sent_at
        FROM "Participant" p
        JOIN "MessageParticipant" mp ON mp."participantId" = p.id
        JOIN "Message" m ON m.id = mp."messageId"
        WHERE p."organizationId" = ${organizationId}
          AND p."isInternal" = false
          AND p."entityInstanceId" IN (${idList(contactIds)})
          AND m."sentAt" IS NOT NULL
          AND m."machineMailTier" IS DISTINCT FROM 'hard'
      ),
      -- Collapse to one row per contact BEFORE the update (see the file header).
      first_targets AS (
        SELECT DISTINCT ON (contact_id) contact_id, sent_at, msg_id
        FROM msgs ORDER BY contact_id, sent_at ASC
      ),
      last_targets AS (
        SELECT DISTINCT ON (contact_id) contact_id, sent_at, msg_id
        FROM msgs ORDER BY contact_id, sent_at DESC
      ),
      targets AS (
        SELECT f.contact_id,
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
        WHERE ei.id = t.contact_id AND ei."organizationId" = ${organizationId}
          AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
            OR ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at)
        RETURNING ei.id
      )
      SELECT (SELECT count(*) FROM upd)::int AS "stamped"
    `)
    return Number(result.rows[0]?.stamped ?? 0)
  } catch (error) {
    logger.warn('Contact interaction recompute failed', {
      organizationId,
      contacts: contactIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/**
 * Propagate contact stamps onto the companies those contacts work for.
 *
 * The live path does this inside `touchInteractionForMessage`, reading `contact_employer`
 * **at the moment the message is stored** — so a link made afterwards (an import, a manual
 * edit, this module's own employer attach) propagates nothing backwards. This is that
 * missing direction.
 *
 * A company is stamped from the min/max over every contact linked to it, not only the
 * contacts in the current batch: the employer field is the whole relation, and reading half
 * of it would produce a "first interaction" that moves backwards on the next run.
 */
export async function recomputeCompanyStamps(
  organizationId: string,
  companyIds: readonly string[],
  db: Database = defaultDb
): Promise<number> {
  if (companyIds.length === 0) return 0

  try {
    const result = await db.execute<{ stamped: number }>(sql`
      WITH links AS (
        SELECT
          fv."relatedEntityId" AS company_id,
          c."firstInteractionAt" AS first_at, c."firstInteractionMessageId" AS first_msg_id,
          c."lastInteractionAt" AS last_at, c."lastInteractionMessageId" AS last_msg_id
        FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf.id = fv."fieldId" AND cf."systemAttribute" = 'contact_employer'
        JOIN "EntityInstance" c ON c.id = fv."entityId"
        WHERE fv."organizationId" = ${organizationId}
          AND fv."relatedEntityId" IN (${idList(companyIds)})
      ),
      first_targets AS (
        SELECT DISTINCT ON (company_id) company_id, first_at, first_msg_id
        FROM links WHERE first_at IS NOT NULL ORDER BY company_id, first_at ASC
      ),
      last_targets AS (
        SELECT DISTINCT ON (company_id) company_id, last_at, last_msg_id
        FROM links WHERE last_at IS NOT NULL ORDER BY company_id, last_at DESC
      ),
      -- Contacts carry both stamps or neither (one UPDATE writes the pair, live and here),
      -- so this inner join pairs both extremes for every company that has any history.
      targets AS (
        SELECT f.company_id,
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
        WHERE ei.id = t.company_id AND ei."organizationId" = ${organizationId}
          AND (ei."firstInteractionAt" IS NULL OR ei."firstInteractionAt" > t.first_at
            OR ei."lastInteractionAt" IS NULL OR ei."lastInteractionAt" < t.last_at)
        RETURNING ei.id
      )
      SELECT (SELECT count(*) FROM upd)::int AS "stamped"
    `)
    return Number(result.rows[0]?.stamped ?? 0)
  } catch (error) {
    logger.warn('Company interaction propagation failed', {
      organizationId,
      companies: companyIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/**
 * The companies these contacts work for.
 *
 * Called after the contact pass so the employers of freshly stamped contacts are propagated
 * to in the same run — otherwise an imported contact would light up while its (already
 * linked) company stayed blank until the nightly sweep.
 */
export async function employerCompanyIds(
  organizationId: string,
  contactIds: readonly string[],
  db: Database = defaultDb
): Promise<string[]> {
  if (contactIds.length === 0) return []

  try {
    const result = await db.execute<{ companyId: string }>(sql`
      SELECT DISTINCT fv."relatedEntityId" AS "companyId"
      FROM "FieldValue" fv
      JOIN "CustomField" cf ON cf.id = fv."fieldId" AND cf."systemAttribute" = 'contact_employer'
      WHERE fv."organizationId" = ${organizationId}
        AND fv."entityId" IN (${idList(contactIds)})
        AND fv."relatedEntityId" IS NOT NULL
    `)
    return result.rows.map((r) => r.companyId).filter(Boolean)
  } catch (error) {
    logger.warn('Employer lookup failed', {
      organizationId,
      contacts: contactIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
