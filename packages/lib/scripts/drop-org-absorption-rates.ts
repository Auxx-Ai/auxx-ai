// packages/lib/scripts/drop-org-absorption-rates.ts
//
// One-off for local/test data: the org-wide `manufacturing.assemblyLaborCostPerUnit` /
// `manufacturing.overheadCostPerUnit` settings were removed, so absorption comes only from
// `part_labor_cost_per_unit` / `part_overhead_cost_per_unit`.
//
// Per org it (1) deletes the two `OrganizationSetting` rows and (2) re-rolls every built part whose
// frozen labour/overhead has no per-part rate behind it, through `rollStandardCost`, so on-hand stock
// gets its revaluation entry from the normal poster. Ancestors widen in automatically.
//
// Dry run by default; `--apply` writes.
//   npx dotenv -- npx tsx packages/lib/scripts/drop-org-absorption-rates.ts [--apply]

import { closePools, database as db, schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { absorbsConversionCost } from '../src/inventory/costing/client'
import { rollStandardCost } from '../src/inventory/costing/standard-cost'
import {
  planStandardCostRoll,
  previewStandardCostRoll,
} from '../src/inventory/costing/standard-cost-queries'

const APPLY = process.argv.includes('--apply')
const DROPPED_KEYS = ['manufacturing.assemblyLaborCostPerUnit', 'manufacturing.overheadCostPerUnit']

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`

/** Built parts carrying frozen labour or overhead that no per-part rate explains. */
async function findOrgAbsorbedParts(organizationId: string) {
  const { stored, allPartIds } = await planStandardCostRoll(db, organizationId, {
    effectiveAt: new Date(),
  })
  const partIds: string[] = []
  for (const partId of allPartIds) {
    const kind = stored.partKinds.get(partId) ?? 'component'
    if (!absorbsConversionCost(kind)) continue
    const strayLabor = stored.standardLaborCosts.has(partId) && !stored.laborRates.has(partId)
    const strayOverhead =
      stored.standardOverheadCosts.has(partId) && !stored.overheadRates.has(partId)
    if (strayLabor || strayOverhead) partIds.push(partId)
  }
  return partIds
}

async function main(): Promise<void> {
  console.log(APPLY ? 'APPLY: writing changes\n' : 'DRY RUN: nothing is written (pass --apply)\n')

  const settingRows = await db
    .select({
      id: schema.OrganizationSetting.id,
      organizationId: schema.OrganizationSetting.organizationId,
      key: schema.OrganizationSetting.key,
      value: schema.OrganizationSetting.value,
    })
    .from(schema.OrganizationSetting)
    .where(inArray(schema.OrganizationSetting.key, DROPPED_KEYS))

  const standardFieldOrgs = await db
    .selectDistinct({ organizationId: schema.CustomField.organizationId })
    .from(schema.CustomField)
    .where(inArray(schema.CustomField.systemAttribute, ['part_standard_labor_cost']))

  const orgIds = new Set([
    ...settingRows.map((row) => row.organizationId),
    ...standardFieldOrgs.map((row) => row.organizationId),
  ])

  const totals = { settings: 0, parts: 0, failed: 0 }

  for (const organizationId of orgIds) {
    const orgSettings = settingRows.filter((row) => row.organizationId === organizationId)
    console.log(`org ${organizationId}`)
    console.log(
      `  settings: ${orgSettings.length === 0 ? 'none' : orgSettings.map((r) => `${r.key}=${JSON.stringify(r.value)}`).join(', ')}`
    )

    if (APPLY && orgSettings.length > 0) {
      await db.delete(schema.OrganizationSetting).where(
        inArray(
          schema.OrganizationSetting.id,
          orgSettings.map((row) => row.id)
        )
      )
      await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
    }
    totals.settings += orgSettings.length

    let partIds: string[]
    try {
      partIds = await findOrgAbsorbedParts(organizationId)
    } catch (error) {
      totals.failed += 1
      console.log(`  parts: could not plan (${(error as Error).message})`)
      continue
    }
    totals.parts += partIds.length
    console.log(`  built parts with org-rate absorption: ${partIds.length}`)
    if (partIds.length === 0) continue

    const effectiveAt = new Date()
    if (!APPLY) {
      const preview = await previewStandardCostRoll(db, organizationId, { partIds, effectiveAt })
      if (preview.isErr()) {
        totals.failed += 1
        console.log(`  preview refused: ${preview.error.message}`)
        continue
      }
      const plan = preview.value
      const changed = plan.lines.filter((line) => line.changed)
      const onHand = changed.filter((line) => line.quantityOnHand !== 0 && !line.isInitial)
      console.log(
        `  re-roll would change ${changed.length} part(s) (incl. ancestors), ${onHand.length} with ` +
          `stock on hand; revaluation ${money(plan.revaluationDelta)}; skipped ${plan.skipped.length}`
      )
      for (const line of changed.slice(0, 15)) {
        console.log(
          `    ${line.partName ?? line.partId} [${line.partKind}] ` +
            `${line.previousStandardCost == null ? '-' : money(line.previousStandardCost)} -> ` +
            `${money(line.standardCost)} (qoh ${line.quantityOnHand})`
        )
      }
      if (changed.length > 15) console.log(`    ... and ${changed.length - 15} more`)
      continue
    }

    const userId = await getOrgCache().get(organizationId, 'systemUser')
    const rolled = await rollStandardCost(db, organizationId, userId, { partIds, effectiveAt })
    if (rolled.isErr()) {
      totals.failed += 1
      console.log(`  roll refused: ${rolled.error.message}`)
      continue
    }
    console.log(
      `  rolled: wrote ${rolled.value.writtenPartIds.length} part(s), revaluation posted ` +
        `${money(rolled.value.revaluationPostedMinor)}`
    )
  }

  console.log(
    `\n${orgIds.size} org(s); ${totals.settings} setting row(s) ${APPLY ? 'deleted' : 'to delete'}; ` +
      `${totals.parts} part(s) ${APPLY ? 're-rolled' : 'to re-roll'}; ${totals.failed} org(s) failed`
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePools()
    process.exit()
  })
