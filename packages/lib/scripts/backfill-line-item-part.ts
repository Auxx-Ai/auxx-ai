// packages/lib/scripts/backfill-line-item-part.ts
//
// One-off backfill for plans/products/08-order-build.md phase 4 (§6.2).
//
// `line_item_part` is STAMPED, not hand-set: when a line carries a
// `catalogItem` whose `catalog_item_part` is set, that part is copied onto the
// line so revenue-by-part is ONE join instead of the three-hop
// line -> catalog_item -> part -> product chain, and so the grouping key is
// auditable rather than re-derived from a field a user can re-point later
// (§6.2 — re-pointing `catalog_item.part` today silently re-attributes every
// historical sale that ever went through that catalog item).
//
// A write-time hook does this going forward. This repairs history: every line
// written before the hook existed.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
//   - It never OVERWRITES. A line that already holds a `line_item_part` — set
//     by a human, or by an earlier run of this script — is left exactly as it
//     is. Only an absent value is filled. That is the whole point of a stamp:
//     the field stays writable, and a human override outranks the derivation.
//
//   - It never invents a part. A line whose catalog item has no
//     `catalog_item_part` is NOT a failure and is NOT guessed at — it is the
//     population that explains why this backfill is small, so it is counted and
//     reported separately rather than silently omitted (§6.1: `catalog_item ->
//     part` is 2 of 9 on dev; everything past `line_item -> catalog_item`
//     collapses).
//
//   - It never touches `line_item_qty`, `line_item_unit_price` or any other
//     money field, and `line_item_part` is deliberately NOT in
//     `LINE_TRIGGER_ATTRS` (money/totals-hooks.ts; asserted by
//     `107-order.test.ts`). A stamp is provenance, never a pricing input, so it
//     must not recompute a document's totals. Do not add it to that set.
//
// THE WRITER — and why it is not raw SQL
//
//   A relation is TWO mirror `FieldValue` rows, one on each end, and
//   `FieldValue.relatedEntityId` is a bare `text()` column with no foreign key.
//   Writing only the line's half is the exact defect
//   `field-values/sweep-entity-references.ts` was written to clean up (1,619
//   half-relations, 15.5% of all relation values in dev).
//
//   So every write here goes through `UnifiedCrudHandler.update`, the same door
//   the record UI uses. `setValuesForEntity` -> `syncInverseRelationships`
//   writes the `part_line_items` mirror on the part
//   (`registry/resources/part-fields.ts:571`) and keeps `searchText` and the
//   display projections in step. Hand-inserting the `FieldValue` row would
//   produce a line that looks stamped and a part whose Line Items list is empty.
//
//   The handler runs under `seedSession` — a reshape, silent forever: no
//   realtime, no timeline entry, no per-write field triggers. Backfilling
//   history must not read as 100 live edits.
//
// SKIPPED, AND REPORTED RATHER THAN SWALLOWED
//
//   - Dangling references. `relatedEntityId` has no FK, so a line may point at a
//     catalog item, or a catalog item at a part, that no longer resolves to an
//     `EntityInstance` in the same org. Stamping one of those would mint a fresh
//     half-relation pointing at nothing. Counted, never written.
//
//   - Ambiguous chains. `catalog_item_part` is a `belongs_to` and should hold at
//     most one value; if the data disagrees (or a line holds two catalog items
//     resolving to different parts) there is no defensible winner, so the line is
//     listed and left alone.
//
// Idempotent and re-runnable: a second run finds nothing and changes nothing,
// because the lines it stamped now hold a `line_item_part` and are excluded by
// the same NOT EXISTS that selects candidates.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/backfill-line-item-part.ts [--dry-run]

import { database as db } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { sql } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { seedSession, UnifiedCrudHandler } from '../src/resources/crud'
import { SystemUserService } from '../src/users/system-user-service'

const DRY_RUN = process.argv.includes('--dry-run')

const SESSION_REASON = 'backfill line_item_part (plans/products/08-order-build.md §6.2)'

/** One line -> catalog item -> part chain that resolves end to end. */
interface CandidateRow extends Record<string, unknown> {
  organizationId: string
  lineId: string
  lineDefId: string
  lineName: string | null
  catalogItemId: string
  catalogItemName: string | null
  partId: string
  partDefId: string
  partName: string | null
}

/** Per-org population counts — the context that makes the stamp count readable. */
interface OrgCountRow extends Record<string, unknown> {
  organizationId: string
  organizationName: string | null
  lines: number
  noCatalogItem: number
  catalogItemWithoutPart: number
  catalogItemWithPart: number
  alreadyStamped: number
}

/** A reference whose target no longer exists. Never stamped, always reported. */
interface DanglingRow extends Record<string, unknown> {
  organizationId: string
  kind: string
  count: number
}

/**
 * The three joins this script is built on, org-scoped at every hop.
 *
 * `CustomField` is joined on `organizationId` as well as `id` — the same
 * `systemAttribute` exists once per org (28 rows for each of these four), and an
 * unscoped join is a cross-org read waiting to happen.
 */
const CHAIN_CTES = sql`
  line_item AS (
    SELECT ei.id, ei."organizationId", ei."entityDefinitionId", ei."displayName"
    FROM "EntityInstance" ei
    JOIN "EntityDefinition" ed
      ON ed.id = ei."entityDefinitionId"
     AND ed."organizationId" = ei."organizationId"
     AND ed."entityType" = 'line_item'
  ),
  line_catalog_item AS (
    SELECT fv."entityId" AS "lineId", fv."organizationId", fv."relatedEntityId" AS "catalogItemId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf
      ON cf.id = fv."fieldId"
     AND cf."organizationId" = fv."organizationId"
     AND cf."systemAttribute" = 'line_item_catalog_item'
    WHERE fv."relatedEntityId" IS NOT NULL
  ),
  catalog_item_part AS (
    SELECT fv."entityId" AS "catalogItemId", fv."organizationId", fv."relatedEntityId" AS "partId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf
      ON cf.id = fv."fieldId"
     AND cf."organizationId" = fv."organizationId"
     AND cf."systemAttribute" = 'catalog_item_part'
    WHERE fv."relatedEntityId" IS NOT NULL
  ),
  stamped AS (
    SELECT DISTINCT fv."entityId" AS "lineId", fv."organizationId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf
      ON cf.id = fv."fieldId"
     AND cf."organizationId" = fv."organizationId"
     AND cf."systemAttribute" = 'line_item_part'
    WHERE fv."relatedEntityId" IS NOT NULL
  )
`

/**
 * Lines whose catalog item has a part, that hold no `line_item_part` yet, and
 * whose whole chain resolves to live records in the same org.
 */
async function findCandidates(): Promise<CandidateRow[]> {
  const { rows } = await db.execute<CandidateRow>(sql`
    WITH ${CHAIN_CTES}
    SELECT li."organizationId",
           li.id                  AS "lineId",
           li."entityDefinitionId" AS "lineDefId",
           li."displayName"       AS "lineName",
           ci.id                  AS "catalogItemId",
           ci."displayName"       AS "catalogItemName",
           p.id                   AS "partId",
           p."entityDefinitionId" AS "partDefId",
           p."displayName"        AS "partName"
    FROM line_item li
    JOIN line_catalog_item lci
      ON lci."lineId" = li.id AND lci."organizationId" = li."organizationId"
    JOIN "EntityInstance" ci
      ON ci.id = lci."catalogItemId" AND ci."organizationId" = li."organizationId"
    JOIN catalog_item_part cip
      ON cip."catalogItemId" = ci.id AND cip."organizationId" = li."organizationId"
    JOIN "EntityInstance" p
      ON p.id = cip."partId" AND p."organizationId" = li."organizationId"
    WHERE NOT EXISTS (
      SELECT 1 FROM stamped s
      WHERE s."lineId" = li.id AND s."organizationId" = li."organizationId"
    )
    ORDER BY li."organizationId", li.id, p.id
  `)
  return rows
}

/** Every line, bucketed by how far along the chain it gets. */
async function countByOrg(): Promise<OrgCountRow[]> {
  const { rows } = await db.execute<OrgCountRow>(sql`
    WITH ${CHAIN_CTES}
    SELECT li."organizationId",
           o.name AS "organizationName",
           count(DISTINCT li.id)::int AS lines,
           count(DISTINCT li.id) FILTER (WHERE lci."lineId" IS NULL)::int AS "noCatalogItem",
           count(DISTINCT li.id) FILTER (
             WHERE lci."lineId" IS NOT NULL AND cip."partId" IS NULL
           )::int AS "catalogItemWithoutPart",
           count(DISTINCT li.id) FILTER (WHERE cip."partId" IS NOT NULL)::int
             AS "catalogItemWithPart",
           count(DISTINCT li.id) FILTER (WHERE s."lineId" IS NOT NULL)::int AS "alreadyStamped"
    FROM line_item li
    LEFT JOIN "Organization" o ON o.id = li."organizationId"
    LEFT JOIN line_catalog_item lci
      ON lci."lineId" = li.id AND lci."organizationId" = li."organizationId"
    LEFT JOIN catalog_item_part cip
      ON cip."catalogItemId" = lci."catalogItemId" AND cip."organizationId" = li."organizationId"
    LEFT JOIN stamped s
      ON s."lineId" = li.id AND s."organizationId" = li."organizationId"
    GROUP BY 1, 2
    ORDER BY 1
  `)
  return rows
}

/** References with no surviving target. `relatedEntityId` carries no FK. */
async function countDangling(): Promise<DanglingRow[]> {
  const { rows } = await db.execute<DanglingRow>(sql`
    WITH ${CHAIN_CTES},
    dangling AS (
      SELECT li."organizationId", 'line -> catalog_item' AS kind, li.id AS "lineId"
      FROM line_item li
      JOIN line_catalog_item lci
        ON lci."lineId" = li.id AND lci."organizationId" = li."organizationId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "EntityInstance" ci
        WHERE ci.id = lci."catalogItemId" AND ci."organizationId" = li."organizationId"
      )
      UNION ALL
      SELECT li."organizationId", 'catalog_item -> part' AS kind, li.id
      FROM line_item li
      JOIN line_catalog_item lci
        ON lci."lineId" = li.id AND lci."organizationId" = li."organizationId"
      JOIN catalog_item_part cip
        ON cip."catalogItemId" = lci."catalogItemId" AND cip."organizationId" = li."organizationId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "EntityInstance" p
        WHERE p.id = cip."partId" AND p."organizationId" = li."organizationId"
      )
    )
    SELECT "organizationId", kind, count(DISTINCT "lineId")::int AS count
    FROM dangling
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
  return rows
}

/** Group candidates by line, so a line resolving to two different parts is visible. */
function groupByLine(rows: CandidateRow[]): Map<string, CandidateRow[]> {
  const byLine = new Map<string, CandidateRow[]>()
  for (const row of rows) {
    const existing = byLine.get(row.lineId)
    if (existing) existing.push(row)
    else byLine.set(row.lineId, [row])
  }
  return byLine
}

async function main() {
  console.log(DRY_RUN ? '── DRY RUN — nothing is written ──\n' : '── APPLYING ──\n')

  const counts = await countByOrg()
  const candidates = await findCandidates()
  const dangling = await countDangling()

  const byLine = groupByLine(candidates)
  const stampable: CandidateRow[] = []
  const ambiguous: Array<{ line: CandidateRow; partIds: string[] }> = []
  for (const rows of byLine.values()) {
    const partIds = [...new Set(rows.map((r) => r.partId))]
    if (partIds.length > 1) ambiguous.push({ line: rows[0]!, partIds })
    else stampable.push(rows[0]!)
  }

  console.log('Line items by how far the catalog-item chain gets:\n')
  for (const org of counts) {
    console.log(`  ${org.organizationName ?? '(unnamed)'}  [${org.organizationId}]`)
    console.log(`    line items                                     ${org.lines}`)
    console.log(`    ├─ no catalog item at all                      ${org.noCatalogItem}`)
    console.log(`    ├─ catalog item has NO part (§6.1)             ${org.catalogItemWithoutPart}`)
    console.log(`    └─ catalog item HAS a part                     ${org.catalogItemWithPart}`)
    console.log(`    already carry line_item_part (left alone)      ${org.alreadyStamped}`)
    for (const d of dangling.filter((row) => row.organizationId === org.organizationId)) {
      console.log(`    ⚠ dangling ${d.kind}: ${d.count} (skipped — target no longer exists)`)
    }
    console.log('')
  }

  const stampableByOrg = new Map<string, CandidateRow[]>()
  for (const row of stampable) {
    const list = stampableByOrg.get(row.organizationId)
    if (list) list.push(row)
    else stampableByOrg.set(row.organizationId, [row])
  }

  console.log(`Lines to stamp: ${stampable.length}\n`)
  for (const [organizationId, rows] of stampableByOrg) {
    const name = counts.find((c) => c.organizationId === organizationId)?.organizationName
    console.log(`  ${name ?? '(unnamed)'}  [${organizationId}]  ${rows.length}`)
    for (const row of rows) {
      console.log(
        `    ${row.lineId}  ${row.lineName ?? '(no name)'}` +
          `  ←  ${row.catalogItemName ?? row.catalogItemId}` +
          `  ⇒  part ${row.partName ?? row.partId} (${row.partId})`
      )
    }
  }

  if (ambiguous.length > 0) {
    console.log(`\n⚠ Ambiguous chains left alone: ${ambiguous.length}`)
    for (const { line, partIds } of ambiguous) {
      console.log(`    ${line.lineId}  org=${line.organizationId}  parts=[${partIds.join(', ')}]`)
    }
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. Nothing was written.')
    process.exit(0)
  }

  let stamped = 0
  let failed = 0
  for (const [organizationId, rows] of stampableByOrg) {
    // 107 added `line_item_part`; an org cache warmed before it would hand the
    // handler a field map without the field, and the write would be dropped.
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    const userId = await SystemUserService.getSystemUserForActions(organizationId)
    const handler = new UnifiedCrudHandler(organizationId, userId, db, undefined, {
      session: seedSession(SESSION_REASON),
    })

    for (const row of rows) {
      try {
        await handler.update(toRecordId(row.lineDefId, row.lineId), {
          line_item_part: toRecordId(row.partDefId, row.partId),
        })
        stamped++
      } catch (error) {
        failed++
        console.error(`  FAILED ${row.lineId}: ${(error as Error).message}`)
      }
    }
  }

  console.log(`\nStamped ${stamped} line items, ${failed} failed.`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
