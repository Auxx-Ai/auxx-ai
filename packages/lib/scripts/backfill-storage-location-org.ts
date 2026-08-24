// packages/lib/scripts/backfill-storage-location-org.ts
//
// One-off: recover `StorageLocation.organizationId` for rows written without
// one, by reading the organization back out of the storage key.
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-storage-location-org.ts --dry-run
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-storage-location-org.ts --apply
//
// Dry run by default -- it prints the plan and writes nothing unless --apply.
//
// ## Why these rows exist
//
// The column did not exist before 2026-03-12: drizzle 0097 added
// `"organizationId" text` nullable with no backfill, in the same commit that
// started populating it. Rows written before that had nowhere to put an org the
// callers were already passing. It is an unrepeatable DDL event, so this cannot
// refill.
//
// ## Why it matters
//
// Nothing deletes S3 objects by prefix -- the `aws s3 rm s3://bucket/{orgId}/`
// line in `files/upload/util.ts` is aspirational. Purge is row-driven on
// `organizationId`, so a NULL row escapes the FK cascade, the org delete AND the
// cleanup job, and never gets a `deletedAt`. It is immortal. Deletability, not
// downloads, is the reason to fix these.
//
// ## Why recover rather than delete
//
// `MediaAssetVersion.storageLocationId` is ON DELETE CASCADE, so deleting a
// location silently deletes the version -- and every affected version is the
// `currentVersionId` of a live asset (avatars, dataset documents, an email
// attachment). Recovering the org is the same end state with nothing broken.

import { closePools, database } from '@auxx/database'
import { sql } from 'drizzle-orm'

/** How many leading path segments may hold the organization id. */
const MAX_ORG_SEGMENT = 3

/**
 * Candidate organization ids for a storage key, nearest-first.
 *
 * Keys put the org at different depths -- `{org}/file/...` (1),
 * `/thumbs/{org}/...` (2, note the leading slash), `email/inbound/{org}/...`
 * (3). Rather than special-case each prefix, offer the first few segments and
 * let the database decide which one is a real organization.
 */
export function organizationCandidatesFromKey(key: string | null | undefined): string[] {
  if (!key) return []
  return key
    .replace(/^\/+/, '')
    .split('/')
    .slice(0, MAX_ORG_SEGMENT)
    .filter((segment) => segment.length > 0)
}

type PlanRow = {
  id: string
  key: string | null
  resolved: string | null
  segment: number | null
  org_name: string | null
  asset_versions: number
  file_versions: number
}

/**
 * The earliest key segment that is a real `Organization`, per row.
 *
 * The join is the safety story: a segment that is not a real organization
 * simply does not match, so this can never propose a dangling reference.
 */
const PLAN = sql`
  WITH k AS (
    SELECT id, metadata->>'key' AS key, ltrim(metadata->>'key', '/') AS trimmed
    FROM "StorageLocation"
    WHERE "organizationId" IS NULL
  ),
  hit AS (
    SELECT k.id, min(s.n) AS segment
    FROM k
    CROSS JOIN generate_series(1, ${MAX_ORG_SEGMENT}) AS s(n)
    JOIN "Organization" o ON o.id = split_part(k.trimmed, '/', s.n)
    GROUP BY k.id
  )
  SELECT k.id,
         k.key,
         split_part(k.trimmed, '/', hit.segment) AS resolved,
         hit.segment,
         o.name AS org_name,
         (SELECT count(*)::int FROM "MediaAssetVersion" v WHERE v."storageLocationId" = k.id) AS asset_versions,
         (SELECT count(*)::int FROM "FileVersion"      v WHERE v."storageLocationId" = k.id) AS file_versions
  FROM k
  LEFT JOIN hit ON hit.id = k.id
  LEFT JOIN "Organization" o ON o.id = split_part(k.trimmed, '/', hit.segment)
  ORDER BY hit.segment NULLS LAST, k.key
`

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = (await database.execute<PlanRow>(PLAN)).rows

  if (rows.length === 0) {
    console.log('No StorageLocation rows with a NULL organizationId. Nothing to do.')
    await closePools()
    return
  }

  const resolvable = rows.filter((r) => r.resolved)
  const stuck = rows.filter((r) => !r.resolved)

  console.log(`${rows.length} row(s) with a NULL organizationId:\n`)
  for (const r of resolvable) {
    const refs = r.asset_versions + r.file_versions
    console.log(
      `  ${r.id}  seg${r.segment} -> ${r.resolved} (${r.org_name})` +
        `${refs > 0 ? `  [${refs} live version(s)]` : '  [unreferenced]'}\n    ${r.key}`
    )
  }
  for (const r of stuck) {
    console.log(`  ${r.id}  UNRESOLVED -- no key segment matches an Organization\n    ${r.key}`)
  }

  if (!apply) {
    console.log(
      `\nDry run. ${resolvable.length} resolvable, ${stuck.length} unresolved. ` +
        'Re-run with --apply to write.'
    )
    await closePools()
    return
  }

  // Same resolution, executed as one set-based statement rather than replaying
  // the ids -- so the write cannot drift from the plan that was just printed.
  const result = await database.execute(sql`
    WITH k AS (
      SELECT id, ltrim(metadata->>'key', '/') AS trimmed
      FROM "StorageLocation"
      WHERE "organizationId" IS NULL
    ),
    hit AS (
      SELECT k.id, min(s.n) AS segment
      FROM k
      CROSS JOIN generate_series(1, ${MAX_ORG_SEGMENT}) AS s(n)
      JOIN "Organization" o ON o.id = split_part(k.trimmed, '/', s.n)
      GROUP BY k.id
    )
    UPDATE "StorageLocation" sl
    SET "organizationId" = split_part(k.trimmed, '/', hit.segment)
    FROM k JOIN hit ON hit.id = k.id
    WHERE sl.id = k.id AND sl."organizationId" IS NULL
  `)

  console.log(`\nUpdated ${result.rowCount ?? 0} row(s). ${stuck.length} left unresolved.`)
  await closePools()
}

main().catch(async (err) => {
  console.error('Backfill failed:', err)
  await closePools()
  process.exit(1)
})
