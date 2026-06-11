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
 * Assert-only guard: fails until the manual v2 backfill (scripts/backfill-credential-v2.ts) has
 * re-encrypted every ciphertext row across all four tables. This surfaces the manual backfill as
 * ledger state — the admin data-migrations panel stays red (and fail-stop blocks later
 * migrations) until the backfill has run in this environment. The green row is the explicit gate
 * for shipping phase 6 (legacy-decrypt deletion). Read-only; writes nothing.
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
          'Run packages/credentials/scripts/backfill-credential-v2.ts --execute against this database.'
      )
    }
  },
}
