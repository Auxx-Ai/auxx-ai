// packages/lib/scripts/backfill-connector-item-parents.ts
//
// One-off: stamp `DataConnectorItem.parentExternalId` on bindings written before the column
// existed, for every child mapping that replaces its child set (`replacesChildSet`). The
// parent is read through the child record's relationship to an instance the parent mapping
// binds; a child resolving to more than one parent is left null. After this, the next sync of
// each parent retires the children its payload no longer carries.
//
// Idempotent. DRY-RUN by default; pass --write to apply.
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-connector-item-parents.ts [--connector <id>] [--write]

import { database as db, schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { replacesChildSet } from '../src/data-connectors/map-record'
import type { DecodedMapping } from '../src/data-connectors/service'

const WRITE = process.argv.includes('--write')
const connectorArg = process.argv.indexOf('--connector')
const CONNECTOR = connectorArg > -1 ? process.argv[connectorArg + 1] : undefined

async function main() {
  const rows = await db
    .select({
      id: schema.DataConnectorMapping.id,
      rootPath: schema.DataConnectorMapping.rootPath,
      linkMode: schema.DataConnectorMapping.linkMode,
      orphanBehavior: schema.DataConnectorMapping.orphanBehavior,
      parentMappingId: schema.DataConnectorMapping.parentMappingId,
      connectorId: schema.DataConnectorStream.dataConnectorId,
    })
    .from(schema.DataConnectorMapping)
    .innerJoin(
      schema.DataConnectorStream,
      eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
    )
  const mappings = rows.filter(
    (m) =>
      (!CONNECTOR || m.connectorId === CONNECTOR) &&
      replacesChildSet({ ...m, row: { id: m.id } } as unknown as DecodedMapping)
  )
  console.log(`${mappings.length} child mapping(s) replace their set${WRITE ? '' : ' (dry run)'}`)

  for (const m of mappings) {
    const resolved = sql`
      select ci.id, min(pi."externalId") as parent
      from "DataConnectorItem" ci
      join "FieldValue" fv on fv."entityId" = ci."entityInstanceId" and fv."relatedEntityId" is not null
      join "DataConnectorItem" pi on pi."dataConnectorId" = ci."dataConnectorId"
        and pi."mappingId" = ${m.parentMappingId} and pi."entityInstanceId" = fv."relatedEntityId"
      where ci."mappingId" = ${m.id} and ci."parentExternalId" is null
      group by ci.id
      having count(distinct pi."externalId") = 1`
    const result = WRITE
      ? await db.execute(sql`
          update "DataConnectorItem" t set "parentExternalId" = r.parent
          from (${resolved}) r where t.id = r.id`)
      : await db.execute(sql`select count(*)::int as n from (${resolved}) r`)
    const count = WRITE ? result.rowCount : (result.rows[0] as { n: number }).n
    console.log(`  ${m.rootPath} (${m.id}): ${count} ${WRITE ? 'stamped' : 'would stamp'}`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
