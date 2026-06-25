// packages/lib/src/data-migrations/migrations/026-normalize-channel-credentials.ts

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

/**
 * Retire the legacy `Credential.kind` vocabulary (`integration` / `workflow`) in favor of the
 * unified `connection` family, and fix the channel `type` that held a ChannelProviderType
 * (`'google'`/`'outlook'`) instead of the providerKey (`'gmail'`/`'outlookMail'`). That mismatch
 * was the cause of the connections-grid "Gmail edit shows a token input" bug — the grid resolves a
 * row's provider via `providerByKey.get(type)`, keyed by providerKey, so `get('google')` missed.
 *
 * Three idempotent statements (each re-runs to a no-op once applied):
 *   1. `integration` channel rows → `kind:'connection'`, `type` remapped to the providerKey.
 *   2. `workflow` rows (AI keys, platform providers, bots) → `kind:'connection'`.
 *   3. Backfill `connectionDefinitionId` for channel rows still missing it (the IMAP straggler),
 *      resolving the platform def by `providerKey = type` (highest major wins).
 *
 * New inserts already write the unified shape (saveConnection / channel-token-accessor / IMAP
 * connect), so this only repairs rows created before the cutover. Ship in the same release as the
 * code so a row inserted between deploy and the boot-time run already uses the new vocabulary.
 */
export const migration026NormalizeChannelCredentials: DataMigrationDef = {
  id: '026-normalize-channel-credentials',
  description: 'Collapse Credential kind integration/workflow → connection; fix channel type + FK',
  async run(db: Database): Promise<void> {
    // 1. Channel rows: integration → connection, ChannelProviderType → providerKey.
    await db.execute(sql`
      UPDATE "Credential"
         SET kind = 'connection',
             type = CASE type
                      WHEN 'google' THEN 'gmail'
                      WHEN 'outlook' THEN 'outlookMail'
                      ELSE type
                    END
       WHERE kind = 'integration'
    `)

    // 2. Everything else with the legacy owner-less kind.
    await db.execute(sql`
      UPDATE "Credential" SET kind = 'connection' WHERE kind = 'workflow'
    `)

    // 3. Backfill the connection definition FK for channel rows that predate it.
    await db.execute(sql`
      UPDATE "Credential" c
         SET "connectionDefinitionId" = (
               SELECT cd.id
                 FROM "ConnectionDefinition" cd
                WHERE cd."providerKey" = c.type
                ORDER BY cd.major DESC
                LIMIT 1
             )
       WHERE c."connectionDefinitionId" IS NULL
         AND c.type IN ('gmail', 'outlookMail', 'imap')
         AND EXISTS (
               SELECT 1 FROM "ConnectionDefinition" cd WHERE cd."providerKey" = c.type
             )
    `)
  },
}
