// packages/lib/scripts/repair-mail-grant-keyspace.ts
//
// One-off data fix for plan 40 phase 0b (§5.1 completeness checklist).
//
// `ResourceAccess.entityDefinitionId` is a DUAL keyspace with no FK. Mail defs
// must be keyed by their entity SLUG (`inbox`/`thread`/`contact`) because
// `composeUserInstanceGrants` and `isMailSharingDef` both test the literal;
// generic record defs stay keyed by the def CUID. `inbox-detail.tsx` built the
// inbox RecordId from the def CUID, so INSTANCE-level inbox grants landed in the
// wrong keyspace: mail visibility never read them, AND they skipped both
// `assertCanManageMailSharing` and the `granularPermissions` plan gate.
//
// This re-keys those strays to the slug and drops the leftovers. The unique
// arbiter is (organizationId, entityDefinitionId, entityInstanceId, granteeType,
// granteeId) with NULLS NOT DISTINCT, so a stray can collide with an existing
// slug row: insert ON CONFLICT DO NOTHING first, then delete the stray either
// way. The surviving slug row wins — never a downgrade, since the pre-existing
// slug row is the one the authorization path has always been able to see.
//
// DEF-LEVEL (`entityInstanceId IS NULL`) CUID rows on mail defs are LEFT ALONE:
// a CUID-keyed def row is a legitimate RECORD-layer *restriction* marker (see
// `cache/providers/restricted-entity-def-ids-provider.ts`), not a mail grant.
// Every query here is scoped to `entityInstanceId IS NOT NULL`.
//
// Also reports thread/contact stray counts — "expected zero" is exactly the
// claim this bug teaches us to verify, and prod's counts will differ from dev's.
//
// Idempotent and re-runnable: a second run finds zero strays and changes nothing.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/repair-mail-grant-keyspace.ts [--dry-run]

import { database as db, schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { getOrgCache, getUserCache } from '../src/cache'
import { MAIL_SHARING_DEFS } from '../src/resource-access/mail-sharing-defs'

const DRY_RUN = process.argv.includes('--dry-run')

interface StrayRow {
  id: string
  organizationId: string
  entityDefinitionId: string
  slug: string
  entityInstanceId: string
  granteeType: string
  granteeId: string
  rung: string
  grantedById: string | null
}

const MAIL_SLUGS = sql.raw([...MAIL_SHARING_DEFS].map((s) => `'${s}'`).join(', '))

/**
 * INSTANCE-level ResourceAccess rows whose `entityDefinitionId` is an
 * `EntityDefinition.id` (CUID) belonging to a mail def — i.e. rows that should
 * have been keyed by the def's `entityType` slug.
 */
async function findStrays(): Promise<StrayRow[]> {
  const { rows } = await db.execute(sql`
    SELECT ra.id,
           ra."organizationId",
           ra."entityDefinitionId",
           ed."entityType" AS slug,
           ra."entityInstanceId",
           ra."granteeType",
           ra."granteeId",
           ra.rung,
           ra."grantedById"
    FROM "ResourceAccess" ra
    JOIN "EntityDefinition" ed ON ed.id = ra."entityDefinitionId"
    WHERE ed."entityType" IN (${MAIL_SLUGS})
      AND ra."entityInstanceId" IS NOT NULL
    ORDER BY ed."entityType", ra."organizationId", ra.id
  `)
  return rows as unknown as StrayRow[]
}

/** Def-level CUID rows on mail defs — legitimate restriction markers, never touched. */
async function countDefLevelCuidRows(): Promise<Record<string, number>> {
  const { rows } = await db.execute(sql`
    SELECT ed."entityType" AS slug, count(*)::int AS count
    FROM "ResourceAccess" ra
    JOIN "EntityDefinition" ed ON ed.id = ra."entityDefinitionId"
    WHERE ed."entityType" IN (${MAIL_SLUGS})
      AND ra."entityInstanceId" IS NULL
    GROUP BY 1
  `)
  return Object.fromEntries(
    (rows as unknown as Array<{ slug: string; count: number }>).map((r) => [r.slug, r.count])
  )
}

/** Correctly slug-keyed instance rows, for a before/after sanity number. */
async function countSlugKeyedRows(): Promise<Record<string, number>> {
  const { rows } = await db.execute(sql`
    SELECT "entityDefinitionId" AS slug, count(*)::int AS count
    FROM "ResourceAccess"
    WHERE "entityDefinitionId" IN (${MAIL_SLUGS})
      AND "entityInstanceId" IS NOT NULL
    GROUP BY 1
  `)
  return Object.fromEntries(
    (rows as unknown as Array<{ slug: string; count: number }>).map((r) => [r.slug, r.count])
  )
}

function tally(rows: StrayRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const slug of MAIL_SHARING_DEFS) out[slug] = 0
  for (const row of rows) out[row.slug] = (out[row.slug] ?? 0) + 1
  return out
}

async function main() {
  const strays = await findStrays()
  const defLevel = await countDefLevelCuidRows()
  const slugBefore = await countSlugKeyedRows()

  console.log('── BEFORE ──')
  console.log('  slug-keyed instance rows :', slugBefore)
  console.log('  CUID-keyed instance rows :', tally(strays), `(total ${strays.length})`)
  console.log('  CUID-keyed DEF-level rows:', defLevel, '(left alone — restriction markers)')

  if (strays.length === 0) {
    console.log('\nNothing to repair. ✅')
    process.exit(0)
  }

  for (const row of strays) {
    console.log(
      `  stray ${row.id}  org=${row.organizationId}  ${row.entityDefinitionId} → ${row.slug}` +
        `  instance=${row.entityInstanceId}  ${row.granteeType}:${row.granteeId}` +
        `  ${row.rung}`
    )
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no writes performed.')
    process.exit(0)
  }

  let rekeyed = 0
  let collided = 0
  let deleted = 0

  for (const row of strays) {
    const inserted = await db
      .insert(schema.ResourceAccess)
      .values({
        organizationId: row.organizationId,
        entityDefinitionId: row.slug,
        entityInstanceId: row.entityInstanceId,
        granteeType: row.granteeType as never,
        granteeId: row.granteeId,
        rung: row.rung as never,
        grantedById: row.grantedById,
      })
      .onConflictDoNothing()
      .returning({ id: schema.ResourceAccess.id })

    if (inserted.length > 0) rekeyed += 1
    else collided += 1

    const removed = await db
      .delete(schema.ResourceAccess)
      .where(eq(schema.ResourceAccess.id, row.id))
      .returning({ id: schema.ResourceAccess.id })
    deleted += removed.length
  }

  // Without the flush the repaired grant stays dark for the ONE_DAY TTL:
  // `userInstanceGrants` is the per-user lens blob, `mailGrantIndex` the org-wide
  // reverse index that fans ingest/realtime out to grant holders.
  const orgIds = [...new Set(strays.map((r) => r.organizationId))]
  for (const orgId of orgIds) {
    await getOrgCache().flush(orgId, ['mailGrantIndex'])
    await getUserCache().invalidateOrgUsersForKeys(orgId, ['userInstanceGrants'])
  }

  const strayAfter = await findStrays()
  const slugAfter = await countSlugKeyedRows()
  const defLevelAfter = await countDefLevelCuidRows()

  console.log('\n── CHANGED ──')
  console.log(`  re-keyed to slug        : ${rekeyed}`)
  console.log(`  collided with an existing slug row (dropped, slug row wins): ${collided}`)
  console.log(`  stray rows deleted      : ${deleted}`)
  console.log(`  caches flushed for orgs : ${orgIds.length} (${orgIds.join(', ')})`)

  console.log('\n── AFTER ──')
  console.log('  slug-keyed instance rows :', slugAfter)
  console.log('  CUID-keyed instance rows :', tally(strayAfter), `(total ${strayAfter.length})`)
  console.log('  CUID-keyed DEF-level rows:', defLevelAfter, '(unchanged)')

  if (strayAfter.length > 0) {
    console.error('\n❌ strays remain — the keyspace invariant is NOT clean.')
    process.exit(1)
  }
  console.log('\n✅ Every mail-def instance grant is slug-keyed.')
  process.exit(0)
}

void main()
