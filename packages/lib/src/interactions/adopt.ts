// packages/lib/src/interactions/adopt.ts
//
// Link a `Participant` row that already exists to a contact record that already exists.
//
// This is the one thing nothing in the codebase did before. `Participant.entityInstanceId`
// has exactly two writers — mail ingest, when it MINTS the contact
// (`ingest/participants/find-or-create.ts`), and the chat-visitor promotion — plus the merge
// redirect. A contact that arrived any other way (CSV import, connector sync, the create
// dialog, the API) never meets the participant rows for its own addresses, so every message
// those addresses ever sent stays invisible to it: no interaction stamps, and no mail,
// because `ThreadParticipant.entityInstanceId` is what contact-derived thread access reads.
//
// 🔴 **Adopt, never steal.** Only `entityInstanceId IS NULL` rows are claimed. A participant
// already pointing at a DIFFERENT contact means two records claim one address, which is a
// duplicate — `duplicateScanJob` already runs for the same import, and re-pointing the row
// here would be a silent merge with no audit trail and no undo. Those rows are counted and
// reported, never written.

import { type Database, database as defaultDb } from '@auxx/database'
import { IdentifierType as IdentifierTypeEnum } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { emailIdentifiers, type RecordIdentifier } from './identifiers'

const logger = createScopedLogger('interactions')

/**
 * Pairs per `ThreadParticipant` statement.
 *
 * Deliberately much larger than the record batch size. That table has **no index on
 * `email`** (its unique key is `(threadId, email)`, leading with the thread), so the update
 * below is a hash join over one scan of it — and one scan per 5,000 addresses is a very
 * different cost from one scan per 500 records. The participant claim above has the
 * `(organizationId, identifier, identifierType)` index and needs no such batching.
 */
const THREAD_PARTICIPANT_CHUNK = 5_000

export interface AdoptionResult {
  /** `Participant` rows newly pointed at one of these contacts. */
  adopted: number
  /** Rows whose address matched but which already belong to a different contact. */
  conflicts: number
}

/** `VALUES (a, b), (c, d)` for a two-column pair list. Never called with an empty list. */
function pairValues(pairs: ReadonlyArray<readonly [string, string]>) {
  return sql.join(
    pairs.map(([a, b]) => sql`(${a}, ${b})`),
    sql`, `
  )
}

/**
 * Claim every unlinked participant whose identifier is on one of these contacts.
 *
 * Runs one statement per identifier TYPE rather than one over a combined VALUES list: the
 * type has to be compared against `Participant."identifierType"`, which is a pg enum, and a
 * value dragged through a VALUES list arrives as `text` (`operator does not exist:
 * "IdentifierType" = text`). As a bound scalar it is an untyped literal that Postgres
 * coerces to the enum, and the `(organizationId, identifier, identifierType)` unique index
 * is used as intended.
 *
 * Two contacts cannot race for one participant: `primary_email` is org-wide unique on the
 * seeded field (`resources/registry/resources/contact-fields.ts`).
 */
export async function adoptParticipants(
  organizationId: string,
  identifiers: readonly RecordIdentifier[],
  db: Database = defaultDb
): Promise<AdoptionResult> {
  const result: AdoptionResult = { adopted: 0, conflicts: 0 }
  if (identifiers.length === 0) return result

  for (const identifierType of [IdentifierTypeEnum.EMAIL, IdentifierTypeEnum.PHONE]) {
    const ofType = identifiers.filter((i) => i.identifierType === identifierType)
    if (ofType.length === 0) continue
    const pairs = ofType.map((i) => [i.recordId, i.identifier] as const)

    try {
      const rows = await db.execute<{ adopted: number; conflicts: number }>(sql`
        WITH claim(contact_id, identifier) AS (VALUES ${pairValues(pairs)}),
        upd AS (
          UPDATE "Participant" p
          SET "entityInstanceId" = c.contact_id, "updatedAt" = now()
          FROM claim c
          WHERE p."organizationId" = ${organizationId}
            AND p.identifier = c.identifier
            AND p."identifierType" = ${identifierType}
            -- Adopt, never steal.
            AND p."entityInstanceId" IS NULL
            -- An own-domain address is the org's own mailbox, not a customer.
            AND p."isInternal" = false
          RETURNING p.id
        ),
        conflict AS (
          SELECT p.id
          FROM "Participant" p
          JOIN claim c ON c.identifier = p.identifier
          WHERE p."organizationId" = ${organizationId}
            AND p."identifierType" = ${identifierType}
            AND p."entityInstanceId" IS NOT NULL
            AND p."entityInstanceId" <> c.contact_id
        )
        SELECT
          (SELECT count(*) FROM upd)::int AS "adopted",
          (SELECT count(*) FROM conflict)::int AS "conflicts"
      `)
      const row = rows.rows[0]
      result.adopted += Number(row?.adopted ?? 0)
      result.conflicts += Number(row?.conflicts ?? 0)
    } catch (error) {
      // Best-effort, exactly like the live interaction touch: a resolution that fails must
      // not fail the import, the save, or the sweep that called it.
      logger.warn('Participant adoption failed', {
        organizationId,
        identifierType,
        candidates: ofType.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

/**
 * Point the thread rollup rows at the contact too — the set-shaped twin of
 * `backfillThreadParticipantContact` in ingest.
 *
 * This is the half that gives the record its mail: `ThreadParticipant.entityInstanceId` is
 * what `mail-query/visibility-scope.ts` and `threads/thread-query.service.ts` read for
 * contact-derived thread access. Email only — the table's unique key is `(threadId, email)`
 * and it has no identifier type. It also has no `organizationId` column, hence the join
 * through `Thread` (see `resources/merge/merge-service.ts`).
 *
 * `entityInstanceId IS NULL` only: a rollup row already resolved to some other contact is
 * the same duplicate signal as a participant conflict, and is left alone.
 *
 * ⚠️ Called ONCE per resolution run over every address it collected, not once per record
 * batch — see {@link THREAD_PARTICIPANT_CHUNK}.
 */
export async function backfillThreadParticipants(
  organizationId: string,
  identifiers: readonly RecordIdentifier[],
  db: Database = defaultDb
): Promise<number> {
  const emails = emailIdentifiers(identifiers)
  if (emails.length === 0) return 0

  let updated = 0
  for (let offset = 0; offset < emails.length; offset += THREAD_PARTICIPANT_CHUNK) {
    const slice = emails.slice(offset, offset + THREAD_PARTICIPANT_CHUNK)
    const pairs = slice.map((i) => [i.recordId, i.identifier] as const)
    try {
      const rows = await db.execute<{ updated: number }>(sql`
        WITH claim(contact_id, email) AS (VALUES ${pairValues(pairs)}),
        upd AS (
          UPDATE "ThreadParticipant" tp
          SET "entityInstanceId" = c.contact_id
          FROM claim c, "Thread" t
          WHERE t.id = tp."threadId"
            AND t."organizationId" = ${organizationId}
            AND lower(tp.email) = c.email
            AND tp."entityInstanceId" IS NULL
          RETURNING tp.id
        )
        SELECT (SELECT count(*) FROM upd)::int AS "updated"
      `)
      updated += Number(rows.rows[0]?.updated ?? 0)
    } catch (error) {
      logger.warn('ThreadParticipant backfill failed', {
        organizationId,
        candidates: slice.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return updated
}
