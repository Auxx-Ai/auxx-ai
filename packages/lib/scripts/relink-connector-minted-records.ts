// packages/lib/scripts/relink-connector-minted-records.ts
//
// Rebuild the "this connector CREATED this record" provenance that a `rebind`
// mapping edit destroyed, from the one source that survived it.
//
// ## What went wrong
//
// `DataConnectorItem` is the only carrier of `mintedInstance`, and it is keyed by
// `(dataConnectorId, mappingId, externalId)`. Until the fix alongside this
// script, `applyMappingEditSafety` DELETED those rows on a `rebind` (an
// identity-match change) so the next backfill would re-bind cleanly. For an
// OWNED mapping that is fine — the records are archived and re-created. For a
// CONTRIBUTING mapping the records are user-owned and stay put, so the delete
// threw away the only evidence that the connector had created them. A re-bind
// then writes `mintedInstance` from `justCreated`, which is `false` because the
// record already exists, so the fact never comes back on its own.
//
// Observed on one dev connector: 22,845 records written by the connector, of
// which 20,806 contacts, and only 10 contacts still flagged as minted. A
// teardown would have removed 1,796 records and stranded ~20,400.
//
// ## Why this can be reconstructed at all
//
// `RecordIdentity` is written by the sink's `mirrorIdentityWrites` on every
// identity-flagged field, is keyed by `(source, connectionId, externalId)`, and
// is NOT touched by the rebind. So the upstream-id → record mapping survived
// intact even though the binding did not.
//
// What `RecordIdentity` does NOT record is whether the connector CREATED the
// record or merely matched it, which is the one bit that actually matters. That
// is what `--created-after` supplies: a record that already existed before the
// connector's first run cannot have been created by it. Everything at or after
// that instant, carrying this connector's identity, is treated as minted.
//
// 🛑 **A surviving `DataConnectorItem` always wins.** Rows that still carry a
// binding were never destroyed and are authoritative in BOTH directions — a
// `mintedInstance = false` there is a positive statement that the connector
// matched a pre-existing record, and this script must never overrule it. That
// is what keeps a user's own contact from being re-labelled connector-created
// and swept up by the next teardown.
//
//   # what would change, touching nothing (default)
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/relink-connector-minted-records.ts \
//     --connector uk3kk1pbbopodx5ycksvq2qo --created-after 2026-09-02T21:25:00Z
//
//   # write it
//   … --connector <id> --created-after <iso> --apply

import { database, schema } from '@auxx/database'
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm'

interface Args {
  connectorId: string
  createdAfter: Date
  apply: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const value = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const connectorId = value('--connector')
  const createdAfter = value('--created-after')
  if (!connectorId || !createdAfter) {
    console.error(
      'usage: --connector <id> --created-after <iso8601> [--apply]\n' +
        "  --created-after is the connector's FIRST run. A record older than this\n" +
        '  cannot have been created by it, so it is left alone.'
    )
    process.exit(1)
  }
  const at = new Date(createdAfter)
  if (Number.isNaN(at.getTime())) {
    console.error(`--created-after is not a date: ${createdAfter}`)
    process.exit(1)
  }
  return { connectorId, createdAfter: at, apply: argv.includes('--apply') }
}

async function main() {
  const { connectorId, createdAfter, apply } = parseArgs()

  const connector = await database.query.DataConnector.findFirst({
    where: eq(schema.DataConnector.id, connectorId),
    columns: { id: true, name: true, organizationId: true, credentialId: true, status: true },
  })
  if (!connector) throw new Error(`No connector ${connectorId}`)

  console.log(`connector : ${connector.name} (${connector.id}) [${connector.status}]`)
  console.log(`org       : ${connector.organizationId}`)
  console.log(`created ≥ : ${createdAfter.toISOString()}`)
  console.log(`mode      : ${apply ? 'APPLY' : 'dry run'}\n`)

  // The connector's own identities: scoped by `connectionId` so a second
  // connector on the same Shopify store is not swept in. `credentialId` is the
  // connection the sink stamps onto every `RecordIdentity` row it mirrors.
  if (!connector.credentialId) {
    throw new Error('Connector has no bound credential; cannot scope RecordIdentity safely.')
  }

  // Instances that (a) carry this connection's identity, (b) were created at or
  // after the first run, and (c) have NO surviving binding for this connector.
  // (c) is the important one: a surviving row is authoritative either way.
  const candidates = await database
    .select({
      instanceId: schema.RecordIdentity.entityInstanceId,
      defId: schema.RecordIdentity.entityDefinitionId,
      externalId: schema.RecordIdentity.externalId,
      apiSlug: schema.EntityDefinition.apiSlug,
    })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId)
    )
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.RecordIdentity.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, connector.organizationId),
        eq(schema.RecordIdentity.connectionId, connector.credentialId),
        gte(schema.EntityInstance.createdAt, createdAfter),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.DataConnectorItem} di
          WHERE di."dataConnectorId" = ${connectorId}
            AND (di."entityInstanceId" = ${schema.RecordIdentity.entityInstanceId}
              OR di."mintedInstanceId" = ${schema.RecordIdentity.entityInstanceId})
        )`
      )
    )

  const byDef = new Map<string, number>()
  for (const row of candidates) byDef.set(row.apiSlug, (byDef.get(row.apiSlug) ?? 0) + 1)

  console.log('records to re-mark as connector-created:')
  for (const [slug, count] of [...byDef].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(16)} ${count}`)
  }
  console.log(`  ${'TOTAL'.padEnd(16)} ${candidates.length}\n`)

  // What is deliberately left alone, so the dry run shows both halves.
  const [kept] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.dataConnectorId, connectorId),
        eq(schema.DataConnectorItem.mintedInstance, false),
        isNotNull(schema.DataConnectorItem.entityInstanceId)
      )
    )
  console.log(
    `left alone: ${kept?.n ?? 0} record(s) whose surviving binding says the connector` +
      ' MATCHED them rather than created them.\n'
  )

  if (!apply) {
    console.log('dry run — nothing written. Re-run with --apply.')
    return
  }

  // One mapping per definition, so the reconstructed rows land on a real
  // mapping and the unique key `(connector, mapping, externalId)` holds. A
  // definition with several mappings takes the first by id, deterministically:
  // the row exists to carry provenance, not to drive the next sync, which
  // re-binds through its own mapping anyway.
  const mappings = await database
    .select({
      id: schema.DataConnectorMapping.id,
      entityDefinitionId: schema.DataConnectorMapping.entityDefinitionId,
    })
    .from(schema.DataConnectorMapping)
    .innerJoin(
      schema.DataConnectorStream,
      eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
    )
    .where(eq(schema.DataConnectorStream.dataConnectorId, connectorId))
    .orderBy(schema.DataConnectorMapping.id)

  const mappingByDef = new Map<string, string>()
  for (const m of mappings) {
    if (m.entityDefinitionId && !mappingByDef.has(m.entityDefinitionId)) {
      mappingByDef.set(m.entityDefinitionId, m.id)
    }
  }

  let written = 0
  let skippedNoMapping = 0
  const CHUNK = 500

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK)
    const values = chunk.flatMap((row) => {
      const mappingId = mappingByDef.get(row.defId)
      if (!mappingId) {
        skippedNoMapping += 1
        return []
      }
      return [
        {
          dataConnectorId: connectorId,
          organizationId: connector.organizationId,
          mappingId,
          externalId: row.externalId,
          entityDefinitionId: row.defId,
          // 🛑 `mintedInstanceId`, NOT `entityInstanceId`. This row records a
          // historical fact; it must not claim to be a live binding, or the next
          // sync would skip re-matching the record (`entity-sink.ts` reads
          // `bound?.entityInstanceId` first and only matches when it is absent).
          mintedInstanceId: row.instanceId,
          mintedInstance: false,
        },
      ]
    })
    if (values.length === 0) continue

    await database
      .insert(schema.DataConnectorItem)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.DataConnectorItem.dataConnectorId,
          schema.DataConnectorItem.mappingId,
          schema.DataConnectorItem.externalId,
        ],
        // A row reappeared between the scan and the write: only fill the
        // provenance, never touch a live binding.
        set: {
          mintedInstanceId: sql`COALESCE(EXCLUDED."mintedInstanceId", "DataConnectorItem"."mintedInstanceId")`,
        },
      })
    written += values.length
    console.log(`  … ${Math.min(i + CHUNK, candidates.length)}/${candidates.length}`)
  }

  console.log(`\nwrote ${written} provenance row(s).`)
  if (skippedNoMapping > 0) {
    console.log(`skipped ${skippedNoMapping} — their definition has no mapping on this connector.`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
