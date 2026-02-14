// packages/database/scripts/migrate-chunk-settings.ts
/**
 * One-time data migration script to migrate existing data from old columns
 * (chunkSize, chunkOverlap, chunkingStrategy) to the new chunkSettings JSONB structure.
 *
 * Run with: pnpm tsx scripts/migrate-chunk-settings.ts
 */

import { sql } from 'drizzle-orm'
import { database as db } from '../src'

async function migrateChunkSettings() {
  console.log('Starting chunk settings migration...')

  try {
    // Migrate existing data from old columns to new JSONB structure
    // This handles datasets that have the old columns but no chunkSettings yet
    const result = await db.execute(sql`
      UPDATE "Dataset"
      SET "chunkSettings" = jsonb_build_object(
        'strategy', COALESCE("chunkingStrategy", 'FIXED_SIZE'),
        'size', COALESCE("chunkSize", 1000),
        'overlap', COALESCE("chunkOverlap", 200),
        'delimiter', E'\n\n',
        'preprocessing', jsonb_build_object(
          'normalizeWhitespace', true,
          'removeUrlsAndEmails', false
        )
      )
      WHERE "chunkSettings" IS NULL
         OR "chunkSettings" = '{}'::jsonb
         OR "chunkSettings" = 'null'::jsonb
    `)

    console.log('Migration completed successfully!')
    console.log('Rows updated:', result.rowCount)
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }

  process.exit(0)
}

migrateChunkSettings()
