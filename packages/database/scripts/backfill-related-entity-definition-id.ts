// packages/database/scripts/backfill-related-entity-definition-id.ts
/**
 * One-time data backfill to canonicalize `FieldValue.relatedEntityDefinitionId`.
 *
 * Some relationship rows were written with the system entityType string (e.g.
 * `"contact"`) instead of the `EntityDefinition` UUID because callers passed
 * a RecordId like `toRecordId('contact', ...)` directly into the write path.
 * The write path now canonicalizes these, but pre-existing rows must be
 * rewritten in place. This script joins `FieldValue` to `EntityDefinition`
 * on `organizationId` + `entityType` and updates any `relatedEntityDefinitionId`
 * that currently holds an entityType string.
 *
 * Run with:
 *   npx dotenv -- npx tsx packages/database/scripts/backfill-related-entity-definition-id.ts
 */

import { sql } from 'drizzle-orm'
import { database as db } from '../src'

async function backfill() {
  console.log('Starting relatedEntityDefinitionId backfill...')

  try {
    const result = await db.execute(sql`
      UPDATE "FieldValue" AS fv
      SET "relatedEntityDefinitionId" = ed.id
      FROM "EntityDefinition" AS ed
      WHERE fv."organizationId" = ed."organizationId"
        AND fv."relatedEntityDefinitionId" = ed."entityType"
        AND ed."entityType" IS NOT NULL
    `)

    console.log('Backfill completed.')
    console.log('Rows updated:', result.rowCount)

    // Verification: count any remaining rows whose relatedEntityDefinitionId
    // still matches an entityType string. Should be zero.
    const remaining = await db.execute(sql`
      SELECT fv."relatedEntityDefinitionId" AS def_id, COUNT(*) AS n
      FROM "FieldValue" fv
      WHERE fv."relatedEntityDefinitionId" IN (
        SELECT DISTINCT "entityType" FROM "EntityDefinition" WHERE "entityType" IS NOT NULL
      )
      GROUP BY fv."relatedEntityDefinitionId"
    `)

    if (remaining.rows.length > 0) {
      console.warn('WARNING: rows still holding an entityType string remain:')
      console.warn(remaining.rows)
    } else {
      console.log('Verification passed: no entityType-string rows remain.')
    }
  } catch (error) {
    console.error('Backfill failed:', error)
    process.exit(1)
  }

  process.exit(0)
}

backfill()
