// packages/lib/src/import/resolution/write-resolution-rows.ts

import type { Database } from '@auxx/database'
import { type SQL, sql } from 'drizzle-orm'
import type { ResolvedValue } from '../types/resolution'

/**
 * Tuples per batched `UPDATE ... FROM (VALUES ...)`. Six bound parameters per
 * tuple keeps a full chunk at 3k parameters, an order of magnitude under
 * Postgres' 65535 per-statement limit.
 */
export const RESOLUTION_WRITE_CHUNK_SIZE = 500

/** The four columns a resolution write ever touches, `updatedAt` aside. */
export interface ResolutionRowWrite {
  status: 'valid' | 'error' | 'create'
  resolvedValues: ResolvedValue[]
  isValid: boolean
  errorMessage: string | null
}

/** A write addressed by `ImportValueResolution.id` */
export interface ResolutionRowWriteById extends ResolutionRowWrite {
  id: string
}

/** A write addressed by the unique `(importJobPropertyId, hashedValue)` pair */
export interface ResolutionRowWriteByHash extends ResolutionRowWrite {
  importJobPropertyId: string
  hashedValue: string
}

/**
 * Rewrite resolutions addressed by primary key, in chunks.
 *
 * @param db - Database instance
 * @param writes - One entry per row; duplicate ids are last-writer-wins
 */
export async function updateResolutionsById(
  db: Database,
  writes: ResolutionRowWriteById[]
): Promise<void> {
  await runChunkedUpdate(
    db,
    writes,
    sql`"id"`,
    (write) => sql`${write.id}`,
    sql`target."id" = source."id"`
  )
}

/**
 * Rewrite resolutions addressed by the column-plus-hash pair, in chunks.
 *
 * The pair is `ImportValueResolution_propertyId_hash_key`'s exact key, so
 * every tuple hits the unique index. Keying on the hash ALONE would be wrong:
 * the same cell text in two mapped columns hashes identically and the two
 * columns can resolve to different records.
 *
 * @param db - Database instance
 * @param writes - One entry per row
 */
export async function updateResolutionsByHash(
  db: Database,
  writes: ResolutionRowWriteByHash[]
): Promise<void> {
  await runChunkedUpdate(
    db,
    writes,
    sql`"importJobPropertyId", "hashedValue"`,
    (write) => sql`${write.importJobPropertyId}, ${write.hashedValue}`,
    sql`target."importJobPropertyId" = source."importJobPropertyId"
        AND target."hashedValue" = source."hashedValue"`
  )
}

/**
 * One `UPDATE ... FROM (VALUES ...)` per chunk, whatever the key.
 *
 * Both callers used to walk their rows one UPDATE at a time, which put a
 * statement-per-distinct-value between a large file and its plan. The shape is
 * shared rather than copied because the fiddly part is not the join, it is the
 * casts: every VALUES parameter reaches Postgres as `unknown` and is resolved
 * to `text`, so the enum, jsonb and boolean columns only round-trip because the
 * SET side casts each one back. `updatedAt` is bound as an ISO string rather
 * than `NOW()` so the stored value stays UTC, matching what Drizzle's timestamp
 * mapper writes.
 *
 * @param keyColumns - Leading `source(...)` column names for the key
 * @param keyValues - The matching leading values of one tuple
 * @param joinPredicate - How a target row is matched to its tuple
 */
async function runChunkedUpdate<T extends ResolutionRowWrite>(
  db: Database,
  writes: T[],
  keyColumns: SQL,
  keyValues: (write: T) => SQL,
  joinPredicate: SQL
): Promise<void> {
  if (writes.length === 0) return

  const updatedAt = new Date().toISOString()

  for (let start = 0; start < writes.length; start += RESOLUTION_WRITE_CHUNK_SIZE) {
    const chunk = writes.slice(start, start + RESOLUTION_WRITE_CHUNK_SIZE)
    const tuples = chunk.map(
      (write) =>
        sql`(${keyValues(write)}, ${write.status}, ${JSON.stringify(write.resolvedValues)}, ${
          write.isValid ? 'true' : 'false'
        }, ${write.errorMessage})`
    )

    await db.execute(sql`
      UPDATE "ImportValueResolution" AS target
      SET "status" = source."status"::"ImportResolutionStatus",
          "resolvedValues" = source."resolvedValues"::jsonb,
          "isValid" = source."isValid"::boolean,
          "errorMessage" = source."errorMessage",
          "updatedAt" = ${updatedAt}::timestamp(3)
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS source(
        ${keyColumns},
        "status",
        "resolvedValues",
        "isValid",
        "errorMessage"
      )
      WHERE ${joinPredicate}
    `)
  }
}
