// packages/lib/scripts/resweep-part-costs.ts
//
// One-off cleanup for plans/parts/cost-provenance-and-stale-values.md §5.0.1.
//
// `persistCosts` used to be write-only: a part that lost its last vendor part (or its last
// subpart) kept the number it had at the time, because a `null` was treated as "nothing to
// do" rather than "clear it". The fix makes the persister authoritative, but it only repairs
// a part the next time something touches it — a part frozen BEFORE the fix shipped stays
// frozen until a recalc reaches it.
//
// `recalculateAllPartCosts` is NOT sufficient for that sweep: it persists only parts that
// appear in the vendor/subpart graph, so a part with neither never gets looked at.
// `recalculateAffectedParts` seeds its dirty set from the caller instead, so passing every
// part id in the org makes it a complete authoritative pass over that org. (Plan §5.5 folds
// this into `recalculateAllPartCosts` permanently; until then, this script is the sweep.)
//
// Idempotent — `persistCosts` writes only where the value actually differs, so a second run
// changes nothing.
//
//   npx dotenv -- npx tsx packages/lib/scripts/resweep-part-costs.ts

import { database as db, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { recalculateAffectedParts } from '../src/bom/cost-calculator'

async function partIdsForOrg(organizationId: string): Promise<string[]> {
  const defs = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'part'),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
  const partDefId = defs[0]?.id
  if (!partDefId) return []

  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  return rows.map((r) => r.id)
}

async function main() {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
  console.log(`Found ${orgs.length} organizations`)

  let swept = 0
  let changed = 0
  let failed = 0

  for (const org of orgs) {
    try {
      const partIds = await partIdsForOrg(org.id)
      if (partIds.length === 0) continue

      const changedIds = await recalculateAffectedParts(org.id, partIds)
      swept += partIds.length
      changed += changedIds.length
      if (changedIds.length > 0) {
        console.log(`org ${org.id}: ${changedIds.length}/${partIds.length} parts corrected`)
      }
    } catch (error) {
      failed++
      console.error(`Failed to resweep part costs for org ${org.id}:`, error)
    }
  }

  console.log(`Done. Swept ${swept} parts, corrected ${changed}, ${failed} orgs failed.`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
