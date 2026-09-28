// packages/lib/scripts/repair-connector-managed-fields.ts
//
// One-off repair for contributing connector bindings written before the sink narrowed
// `DataConnectorItem.managedFields` to the fields it actually left a value in:
//   (a) drops from every live item's `managedFields` the refs with no FieldValue row on the
//       bound instance (a blank upstream value, never written), and
//   (b) stamps `managedByConnectorId` on unstamped rows of the healing (overwrite, scalar,
//       non-identity, unpinned) fields the item manages, e.g. addresses the geocode
//       write-back unstamped.
// What it loses: a cell a user genuinely cleared (a) or hand-edited (b) before the repair is
// no longer healed; the connector's next real write for that field re-manages it.
//
//   npx dotenv -- npx tsx packages/lib/scripts/repair-connector-managed-fields.ts \
//     <organizationId> [connectorId] [--dry-run]

import { database, schema } from '@auxx/database'
import { getFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm'
import { resolveConnectorFieldRef } from '../src/agents/bindings/resolve'
import { type SyncFieldShape, wouldHealField } from '../src/data-connectors/sync-state'
import type { FieldMapping } from '../src/data-connectors/types'
import { buildWriteKeyToFieldIdMap } from '../src/field-values/write-key-map'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [organizationId, connectorId] = args.filter((a) => !a.startsWith('--'))
if (!organizationId) {
  console.error(
    'usage: repair-connector-managed-fields.ts <organizationId> [connectorId] [--dry-run]'
  )
  process.exit(1)
}

const BATCH = 1000
const I = schema.DataConnectorItem
const FV = schema.FieldValue

interface DefTally {
  items: number
  unmanaged: Map<string, number>
  stamped: Map<string, number>
}

const tallies = new Map<string, DefTally>()
const tallyFor = (label: string): DefTally => {
  let t = tallies.get(label)
  if (!t) {
    t = { items: 0, unmanaged: new Map(), stamped: new Map() }
    tallies.set(label, t)
  }
  return t
}
const bump = (m: Map<string, number>, key: string, n: number) => m.set(key, (m.get(key) ?? 0) + n)

type Pair = { ref: string; fieldId: string; name: string }

/** Every ref the mapping's items manage or its bindings name, resolved to the row's field id. */
async function resolvePairs(
  mapping: { id: string; entityDefinitionId: string | null; fieldMappings: FieldMapping[] | null },
  connectionId: string | undefined
): Promise<{ all: Pair[]; healing: Pair[] }> {
  if (!mapping.entityDefinitionId) return { all: [], healing: [] }
  const fields = await database
    .select()
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId!),
        eq(schema.CustomField.entityDefinitionId, mapping.entityDefinitionId)
      )
    )
  const keyToId = buildWriteKeyToFieldIdMap(fields)
  const byId = new Map(fields.map((f) => [f.id, f]))

  const stored = await database.execute(sql`
    SELECT DISTINCT jsonb_array_elements_text(${I.managedFields}) AS ref
    FROM ${I} WHERE ${I.mappingId} = ${mapping.id}
  `)
  const bindings = (mapping.fieldMappings ?? []).filter((fm) => fm.targetFieldRef != null)
  const refs = new Set<string>([
    ...(stored.rows ?? []).map((r) => (r as { ref: string }).ref),
    ...bindings.map((fm) => fm.targetFieldRef!),
  ])

  const all: Pair[] = []
  const healing: Pair[] = []
  for (const ref of refs) {
    const concrete = await resolveConnectorFieldRef(
      ref as ResourceFieldId,
      organizationId!,
      connectionId
    )
    const fieldId = concrete ? keyToId.get(getFieldId(concrete)) : undefined
    if (!fieldId) continue
    const field = byId.get(fieldId)!
    const pair = { ref, fieldId, name: field.systemAttribute ?? field.name }
    all.push(pair)
    const binding = bindings.find((fm) => fm.targetFieldRef === ref)
    if (binding && wouldHealField(binding, field as unknown as SyncFieldShape)) healing.push(pair)
  }
  return { all, healing }
}

const pairsSql = (pairs: Pair[]) => sql`unnest(
  ${sql.param(pairs.map((p) => p.ref))}::text[],
  ${sql.param(pairs.map((p) => p.fieldId))}::text[]
) AS h(ref, field_id)`

/** (a) Refs managed on these items with no FieldValue row on the bound instance. */
async function unmanageBatch(ids: string[], pairs: Pair[], connector: string, t: DefTally) {
  if (pairs.length === 0) return
  const orphanCte = sql`
    SELECT ${I.id} AS item_id, h.ref
    FROM ${I} CROSS JOIN ${pairsSql(pairs)}
    WHERE ${I.id} = ANY(${sql.param(ids)}::text[])
      AND ${I.dataConnectorId} = ${connector}
      AND ${I.managedFields} ? h.ref
      AND NOT EXISTS (
        SELECT 1 FROM ${FV}
        WHERE ${FV.organizationId} = ${organizationId}
          AND ${FV.entityId} = ${I.entityInstanceId}
          AND ${FV.fieldId} = h.field_id
      )`
  const counts = await database.execute(sql`
    SELECT o.ref, count(*)::int AS n FROM (${orphanCte}) o GROUP BY o.ref
  `)
  const nameOf = new Map(pairs.map((p) => [p.ref, p.name]))
  for (const r of (counts.rows ?? []) as Array<{ ref: string; n: number }>) {
    bump(t.unmanaged, nameOf.get(r.ref) ?? r.ref, r.n)
  }
  if (dryRun || (counts.rows ?? []).length === 0) return
  await database.execute(sql`
    WITH orphan AS (${orphanCte}),
    dropped AS (SELECT item_id, array_agg(ref) AS refs FROM orphan GROUP BY item_id)
    UPDATE ${I} SET "managedFields" = ${I.managedFields} - dropped.refs
    FROM dropped WHERE ${I.id} = dropped.item_id
  `)
}

/** (b) Unstamped rows of healing fields these items manage (and have not paused). */
async function stampBatch(ids: string[], pairs: Pair[], connector: string, t: DefTally) {
  if (pairs.length === 0) return
  const unstamped = sql`
    SELECT ${FV.id} AS fv_id, h.field_id
    FROM ${I} CROSS JOIN ${pairsSql(pairs)}
    JOIN ${FV} ON ${FV.entityId} = ${I.entityInstanceId} AND ${FV.fieldId} = h.field_id
    WHERE ${I.id} = ANY(${sql.param(ids)}::text[])
      AND ${I.dataConnectorId} = ${connector}
      AND ${I.managedFields} ? h.ref
      AND NOT (${I.pinnedFields} ? h.field_id)
      AND ${FV.organizationId} = ${organizationId}
      AND ${FV.managedByConnectorId} IS NULL`
  const counts = await database.execute(sql`
    SELECT u.field_id, count(DISTINCT u.fv_id)::int AS n FROM (${unstamped}) u GROUP BY u.field_id
  `)
  const nameOf = new Map(pairs.map((p) => [p.fieldId, p.name]))
  for (const r of (counts.rows ?? []) as Array<{ field_id: string; n: number }>) {
    bump(t.stamped, nameOf.get(r.field_id) ?? r.field_id, r.n)
  }
  if (dryRun || (counts.rows ?? []).length === 0) return
  await database.execute(sql`
    UPDATE ${FV} SET "managedByConnectorId" = ${connector}
    WHERE ${FV.id} IN (SELECT u.fv_id FROM (${unstamped}) u)
      AND ${FV.managedByConnectorId} IS NULL
  `)
}

async function main() {
  const connectors = await database
    .select()
    .from(schema.DataConnector)
    .where(
      and(
        eq(schema.DataConnector.organizationId, organizationId!),
        connectorId ? eq(schema.DataConnector.id, connectorId) : undefined
      )
    )
  if (connectors.length === 0) throw new Error('no connector found for that organization')
  console.log(dryRun ? 'DRY RUN: nothing is written' : 'WRITING')

  for (const connector of connectors) {
    const mappings = await database
      .select({
        id: schema.DataConnectorMapping.id,
        targetMode: schema.DataConnectorMapping.targetMode,
        entityDefinitionId: schema.DataConnectorMapping.entityDefinitionId,
        fieldMappings: schema.DataConnectorMapping.fieldMappings,
        slug: schema.EntityDefinition.apiSlug,
      })
      .from(schema.DataConnectorMapping)
      .innerJoin(
        schema.DataConnectorStream,
        eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
      )
      .leftJoin(
        schema.EntityDefinition,
        eq(schema.EntityDefinition.id, schema.DataConnectorMapping.entityDefinitionId)
      )
      .where(eq(schema.DataConnectorStream.dataConnectorId, connector.id))

    for (const mapping of mappings) {
      // Owned mappings never stamp cells and are not drift-checked.
      if (mapping.targetMode !== 'contributing') continue
      const { all, healing } = await resolvePairs(
        mapping as never,
        connector.credentialId ?? undefined
      )
      const t = tallyFor(`${connector.name} / ${mapping.slug ?? mapping.entityDefinitionId}`)
      let cursor = ''
      for (;;) {
        const batch = await database
          .select({ id: I.id })
          .from(I)
          .where(
            and(
              eq(I.mappingId, mapping.id),
              isNull(I.archivedAt),
              isNotNull(I.entityInstanceId),
              gt(I.id, cursor)
            )
          )
          .orderBy(asc(I.id))
          .limit(BATCH)
        if (batch.length === 0) break
        const ids = batch.map((b) => b.id)
        cursor = ids[ids.length - 1]!
        t.items += ids.length
        await unmanageBatch(ids, all, connector.id, t)
        await stampBatch(ids, healing, connector.id, t)
      }
    }
  }

  const verb = dryRun ? 'would ' : ''
  for (const [label, t] of tallies) {
    console.log(`\n${label}: ${t.items} live items`)
    for (const [name, n] of t.unmanaged) console.log(`  ${verb}unmanage ${name}: ${n}`)
    for (const [name, n] of t.stamped) console.log(`  ${verb}stamp ${name}: ${n}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
