// packages/lib/src/data-migrations/migrations/103-backfill-email-storage-location-org.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-103')

/** `email/inbound/{orgId}/{messageId}/{name}` — the org is the third segment. */
const INBOUND_EMAIL_KEY = /^email\/inbound\/([^/]+)\//

/**
 * Recover the owning organization from an inbound-email storage key.
 *
 * Pure and exported so the parse is tested without a database. Returns `null`
 * for anything that is not an inbound-email key, which is the whole safety
 * story: the migration only writes rows this function claims.
 *
 * @param key The `metadata.key` of a `StorageLocation` row.
 * @returns The organization id encoded in the key, or `null`.
 */
export function organizationIdFromInboundEmailKey(key: string | null | undefined): string | null {
  if (!key) return null
  const match = INBOUND_EMAIL_KEY.exec(key)
  return match?.[1] ?? null
}

/**
 * Stamp `organizationId` onto the inbound-email `StorageLocation` rows that
 * were written without one.
 *
 * ## Why these rows are unreachable
 *
 * Every scoped read filters `eq(StorageLocation.organizationId, ctx.organizationId)`,
 * and in SQL `NULL = anything` is never true — so a NULL-org row is invisible to
 * `getStorageLocation` and therefore to `StorageManager.getDownloadRef`, which
 * routes through it. 533 pinned `Attachment` rows point at these locations and
 * cannot be downloaded through any path.
 *
 * ## Why this is safe to derive
 *
 * The organization id was never actually unknown — the ingest wrote it into the
 * storage key (`email/inbound/{orgId}/…`) and simply failed to write the column.
 * Measured on the development database: all such rows were created on a single
 * day (2026-03-12); every row from 2026-03-13 onward carries the same key shape
 * WITH the column populated; every id derived from those keys resolves to a real
 * `Organization`; and none is ambiguous.
 *
 * ## Why it is a join, not a computed UPDATE
 *
 * The `FROM "Organization"` join means a key whose third segment is not a real
 * organization simply does not match, so the statement can never write a
 * dangling reference — even if some other producer starts emitting this key
 * shape later. Rows that do not parse are left alone rather than guessed at.
 *
 * Set-based on purpose: this is one statement over a few thousand rows, and a
 * per-row loop would buy nothing. Re-running is a no-op, because the `IS NULL`
 * predicate no longer matches anything it already fixed.
 *
 * Deliberately NOT done here: `organizationId` stays nullable. Tightening it to
 * NOT NULL is a schema migration that must carry its own inline backfill (a
 * runtime migration cannot be assumed to have run first), and the non-email
 * stragglers have to be resolved before that is even possible.
 */
export const migration103BackfillEmailStorageLocationOrg: DataMigrationDef = {
  id: '103-backfill-email-storage-location-org',
  description: 'Recover organizationId for inbound-email StorageLocation rows written without one',
  async run(db: Database): Promise<void> {
    const before = await db.execute<{ null_org: number; inbound: number }>(sql`
      SELECT
        count(*)::int AS null_org,
        count(*) FILTER (WHERE metadata->>'key' LIKE 'email/inbound/%')::int AS inbound
      FROM "StorageLocation"
      WHERE "organizationId" IS NULL
    `)

    await db.execute(sql`
      UPDATE "StorageLocation" sl
      SET "organizationId" = o.id
      FROM "Organization" o
      WHERE sl."organizationId" IS NULL
        AND sl.metadata->>'key' LIKE 'email/inbound/%'
        AND o.id = split_part(sl.metadata->>'key', '/', 3)
    `)

    const after = await db.execute<{ null_org: number }>(sql`
      SELECT count(*)::int AS null_org FROM "StorageLocation" WHERE "organizationId" IS NULL
    `)

    const nullBefore = before.rows[0]?.null_org ?? 0
    const inboundBefore = before.rows[0]?.inbound ?? 0
    const nullAfter = after.rows[0]?.null_org ?? 0

    logger.info('Inbound-email StorageLocation org backfill complete', {
      nullOrgBefore: nullBefore,
      inboundEmailCandidates: inboundBefore,
      repaired: nullBefore - nullAfter,
      // Non-email rows, and any inbound key whose org segment is not a real
      // organization. Left untouched on purpose; they need their own decision.
      nullOrgRemaining: nullAfter,
    })
  },
}
