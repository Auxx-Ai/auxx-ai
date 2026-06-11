// packages/lib/src/data-migrations/migrations/024-verify-credential-v2-backfill.ts

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

/**
 * Per-table checks for leftover legacy (non-`v2:`) ciphertext. Mirrors the README runbook SQL.
 * KeyValuePair values are jsonb strings, so a v2 value serializes to `"v2:…"` — hence the
 * `'"v2:%'` prefix.
 */
const CHECKS: { table: string; sql: ReturnType<typeof sql> }[] = [
  {
    table: 'Credential',
    sql: sql`SELECT count(*)::int AS n FROM "Credential" WHERE "encryptedSecrets" NOT LIKE 'v2:%'`,
  },
  {
    table: 'ApiKey',
    sql: sql`SELECT count(*)::int AS n FROM "ApiKey" WHERE "encryptedSecret" IS NOT NULL AND "encryptedSecret" NOT LIKE 'v2:%'`,
  },
  {
    table: 'ProviderConfiguration',
    sql: sql`SELECT count(*)::int AS n FROM "ProviderConfiguration" WHERE credentials->>'_encrypted' IS NOT NULL AND credentials->>'_encrypted' NOT LIKE 'v2:%'`,
  },
  {
    table: 'KeyValuePair',
    sql: sql`SELECT count(*)::int AS n FROM "KeyValuePair" WHERE type = 'CONFIG_VARIABLE' AND "isEncrypted" = 'true' AND value::text NOT LIKE '"v2:%'`,
  },
]

/**
 * Assert-only guard: fails if any ciphertext row across the four tables is still in the pre-v2
 * format. The backfill ran and was verified in all existing environments (Release 1, 2026-06-11);
 * legacy decryption support has since been removed, so a fresh environment passes trivially and a
 * failure here means restored pre-v2 data that can no longer be decrypted. Read-only; writes nothing.
 */
export const migration024VerifyCredentialV2Backfill: DataMigrationDef = {
  id: '024-verify-credential-v2-backfill',
  description: 'Assert all credential ciphertext (4 tables) is re-encrypted to crypto v2',
  async run(db: Database): Promise<void> {
    const remaining: string[] = []
    for (const check of CHECKS) {
      const result = await db.execute(check.sql)
      const n = Number((result.rows[0] as { n: number | string } | undefined)?.n ?? 0)
      if (n > 0) remaining.push(`${check.table}=${n}`)
    }
    if (remaining.length > 0) {
      throw new Error(
        `Credential v2 backfill incomplete — legacy ciphertext remains: ${remaining.join(', ')}. ` +
          'Legacy decryption was removed in credentials v2 Release 2; these rows cannot be ' +
          'decrypted by current code (see plans/mcp/v2/README.md).'
      )
    }
  },
}
