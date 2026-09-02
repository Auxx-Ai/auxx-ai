// packages/lib/scripts/repair-empty-vendor-parts.ts
//
// Repair or delete supplier offers (`vendor_part`) that have NO supplier.
//
// WHY THEY EXIST
//
//   The importer's relation auto-create stored the minted company's bare
//   instance id, the write path refused it, and the create swallowed the
//   refusal, so the offer landed with a part, a SKU and a price but no
//   supplier (plans/importer/09-relation-create-record-id.md §1). A re-run
//   could not match those offers by (part, supplier) and created a second,
//   correct offer next to each one.
//
// WHAT THIS DOES, PER EMPTY OFFER
//
//   The intended supplier is still recoverable: the offer's `ImportPlanRow`
//   names its row, the row's raw Supplier cell hashes to the job's resolution,
//   and that resolution still holds the bare company id. With that in hand:
//
//   - the (part, company) pair ALREADY has an offer with a supplier
//       => DELETE the empty one; it is the duplicate.
//   - the pair has no other offer and the company still exists
//       => REPAIR: write the supplier link.
//   - the company no longer exists, or the offer has no import row at all
//       => REPORTED and left alone. Decide those by hand.
//
// EVERY WRITE GOES THROUGH `UnifiedCrudHandler` under the default interactive
// session, so the `mfg-vendor-parts-deleted` lifecycle rule and the field
// seams fire and part cost is recalculated by the rules engine. The script
// ALSO calls `recalculateAffectedParts` for the touched parts at the end, so
// the cost is right even if the events lane is down when it runs.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/repair-empty-vendor-parts.ts --org <orgId> [--dry-run]
//
// Run it with `--dry-run` first and read the plan it prints.

import { database as db } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { sql } from 'drizzle-orm'
import { recalculateAffectedParts } from '../src/bom'
import { UnifiedCrudHandler } from '../src/resources/crud'
import { SystemUserService } from '../src/users/system-user-service'

const DRY_RUN = process.argv.includes('--dry-run')

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** One empty offer whose import row still names its supplier. */
interface ChainRow extends Record<string, unknown> {
  offerId: string
  offerDefId: string
  partId: string | null
  jobId: string
  rowIndex: number
  supplierCell: string | null
  companyId: string | null
  companyDefId: string | null
  pairHasGoodOffer: boolean
}

/** One empty offer with no import row behind it. */
interface OrphanRow extends Record<string, unknown> {
  offerId: string
  createdAt: string
}

async function findChain(organizationId: string): Promise<ChainRow[]> {
  const { rows } = await db.execute<ChainRow>(sql`
    with orphans as (
      select ei.id, ei."entityDefinitionId" as def_id
      from "EntityInstance" ei
      join "EntityDefinition" ed on ed.id = ei."entityDefinitionId" and ed."entityType" = 'vendor_part'
      join "CustomField" cf on cf."entityDefinitionId" = ed.id and cf."systemAttribute" = 'vendor_part_contact'
      left join "FieldValue" fv on fv."entityId" = ei.id and fv."fieldId" = cf.id
      where ei."organizationId" = ${organizationId} and ei."archivedAt" is null and fv.id is null
    ),
    chain as (
      select o.id as offer_id, o.def_id, j.id as job_id, pr."rowIndex" as row_index,
             rd.value as supplier_cell,
             r."resolvedValues"->0->>'value' as company_id
      from orphans o
      join "ImportPlanRow" pr on pr."resultRecordId" = o.id
      join "ImportPlanStrategy" ps on ps.id = pr."importPlanStrategyId"
      join "ImportPlan" p on p.id = ps."importPlanId"
      join "ImportJob" j on j.id = p."importJobId"
      join "ImportMapping" m on m.id = j."importMappingId"
      join "ImportMappingProperty" mp on mp."importMappingId" = m.id and mp."targetFieldKey" = 'vendor_part_contact'
      join "ImportJobRawData" rd on rd."importJobId" = j.id and rd."rowIndex" = pr."rowIndex" and rd."columnIndex" = mp."sourceColumnIndex"
      join "ImportJobProperty" jp on jp."importJobId" = j.id and jp."importMappingPropertyId" = mp.id
      join "ImportValueResolution" r on r."importJobPropertyId" = jp.id and r."hashedValue" = rd."valueHash"
    )
    select
      c.offer_id as "offerId",
      c.def_id as "offerDefId",
      pfv."relatedEntityId" as "partId",
      c.job_id as "jobId",
      c.row_index as "rowIndex",
      c.supplier_cell as "supplierCell",
      company.id as "companyId",
      company."entityDefinitionId" as "companyDefId",
      exists (
        select 1 from "EntityInstance" x
        join "FieldValue" sfv on sfv."entityId" = x.id and sfv."fieldId" = scf.id and sfv."relatedEntityId" = company.id
        join "FieldValue" pfv2 on pfv2."entityId" = x.id and pfv2."fieldId" = pcf.id and pfv2."relatedEntityId" = pfv."relatedEntityId"
        where x."entityDefinitionId" = c.def_id and x."archivedAt" is null and x.id <> c.offer_id
      ) as "pairHasGoodOffer"
    from chain c
    join "CustomField" pcf on pcf."entityDefinitionId" = c.def_id and pcf."systemAttribute" = 'vendor_part_part'
    join "CustomField" scf on scf."entityDefinitionId" = c.def_id and scf."systemAttribute" = 'vendor_part_contact'
    left join "FieldValue" pfv on pfv."entityId" = c.offer_id and pfv."fieldId" = pcf.id
    left join "EntityInstance" company
      on company.id = split_part(c.company_id, ':', array_length(string_to_array(c.company_id, ':'), 1))
     and company."organizationId" = ${organizationId} and company."archivedAt" is null
    order by c.job_id, c.row_index
  `)
  return rows
}

async function findWithoutImportRow(organizationId: string): Promise<OrphanRow[]> {
  const { rows } = await db.execute<OrphanRow>(sql`
    select ei.id as "offerId", ei."createdAt" as "createdAt"
    from "EntityInstance" ei
    join "EntityDefinition" ed on ed.id = ei."entityDefinitionId" and ed."entityType" = 'vendor_part'
    join "CustomField" cf on cf."entityDefinitionId" = ed.id and cf."systemAttribute" = 'vendor_part_contact'
    left join "FieldValue" fv on fv."entityId" = ei.id and fv."fieldId" = cf.id
    left join "ImportPlanRow" pr on pr."resultRecordId" = ei.id
    where ei."organizationId" = ${organizationId} and ei."archivedAt" is null and fv.id is null and pr.id is null
    order by ei."createdAt"
  `)
  return rows
}

async function main() {
  const organizationId = argValue('--org')
  if (!organizationId) {
    console.error('Usage: repair-empty-vendor-parts.ts --org <orgId> [--dry-run]')
    process.exit(2)
  }

  console.log(DRY_RUN ? 'DRY RUN: nothing is written\n' : 'APPLYING\n')

  const chain = await findChain(organizationId)
  const noRow = await findWithoutImportRow(organizationId)

  const toDelete = chain.filter((r) => r.companyId && r.pairHasGoodOffer)
  const toRepair = chain.filter((r) => r.companyId && !r.pairHasGoodOffer && r.partId)
  const unresolved = chain.filter((r) => !r.companyId || !r.partId)

  console.log(`Empty supplier offers in org ${organizationId}: ${chain.length + noRow.length}\n`)
  console.log(`  delete (pair already has a good offer)   ${toDelete.length}`)
  console.log(`  repair (write the supplier link)         ${toRepair.length}`)
  console.log(`  left alone: company or part not found    ${unresolved.length}`)
  console.log(`  left alone: no import row                ${noRow.length}\n`)

  for (const r of toDelete) {
    console.log(`  DELETE ${r.offerId}  row ${r.rowIndex}  "${r.supplierCell}"  ${r.companyId}`)
  }
  for (const r of toRepair) {
    console.log(`  REPAIR ${r.offerId}  row ${r.rowIndex}  "${r.supplierCell}"  -> ${r.companyId}`)
  }
  for (const r of unresolved) {
    console.log(`  SKIP   ${r.offerId}  row ${r.rowIndex}  "${r.supplierCell}"  (unresolved)`)
  }
  for (const r of noRow) {
    console.log(`  SKIP   ${r.offerId}  created ${r.createdAt}  (no import row)`)
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. Nothing was written.')
    process.exit(0)
  }

  const userId = await SystemUserService.getSystemUserForActions(organizationId)
  // Default interactive session on purpose: the lifecycle rules that keep
  // part cost right listen on the events this lane publishes.
  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const touchedParts = new Set<string>()
  let deleted = 0
  let repaired = 0
  let failed = 0

  for (const r of toDelete) {
    try {
      await handler.delete(toRecordId(r.offerDefId, r.offerId))
      if (r.partId) touchedParts.add(r.partId)
      deleted++
    } catch (error) {
      failed++
      console.error(`  FAILED delete ${r.offerId}: ${(error as Error).message}`)
    }
  }

  for (const r of toRepair) {
    try {
      await handler.update(toRecordId(r.offerDefId, r.offerId), {
        vendor_part_contact: toRecordId(r.companyDefId as string, r.companyId as string),
      })
      if (r.partId) touchedParts.add(r.partId)
      repaired++
    } catch (error) {
      failed++
      console.error(`  FAILED repair ${r.offerId}: ${(error as Error).message}`)
    }
  }

  if (touchedParts.size > 0) {
    const changed = await recalculateAffectedParts(organizationId, [...touchedParts])
    console.log(`\nRecalculated ${touchedParts.size} parts, ${changed.length} cost values changed.`)
  }

  console.log(`\nDeleted ${deleted}, repaired ${repaired}, ${failed} failed.`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
