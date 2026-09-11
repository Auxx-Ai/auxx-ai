// packages/lib/scripts/reset-bank-and-journals.ts
//
// Delete an org's bank transactions and journal entries, and NOTHING else.
//
//     npx dotenv -- node --conditions source --import tsx/esm \
//       packages/lib/scripts/reset-bank-and-journals.ts DemoOrg1 --confirm
//
// Read-only without `--confirm`.
//
// ── Why this exists next to reset-org-books.ts ──────────────────────────────
//
// `reset-org-books.ts` is all-or-nothing: its `DELETE_WAVES` take orders, line
// items, credit memos and parts' connector bindings with them. That is right
// for a full re-drive and wrong when the demo data is the point and only the
// ledger inputs need clearing. This is the narrow version: two entity types,
// their connector bindings, and the streams that produced them.
//
// ── It uses the same low-level delete, and bypasses the same guards ─────────
//
// `deleteEntityInstances` sweeps `FieldValue` on BOTH ends of every relation
// plus the record's `TimelineEvent` rows, and `RecordIdentity` cascades behind
// it. The guard chain lives one layer up in `bulkDeleteEntities` and would
// refuse a posted journal entry on purpose — correct in the product, wrong in
// a dev reset, which is why this is a script.
//
// ── The bindings go with the records, deliberately ─────────────────────────
//
// `DataConnectorItem`'s instance pointers are ON DELETE **SET NULL**, not
// cascade. Left alone, the binding outlives the record with a NULL instance
// and its `contentHash` still matches, so the next sync counts the record
// `skipped` and re-creates nothing. So the binding is deleted too and the
// stream is put back to backfill, which is what makes these records able to
// come back. The parts-SKU guard in `reset-org-books.ts` does not apply: the
// part mapping is untouched here, and a bank transaction is matched on its own
// external id, not a SKU.

import { database as db, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { onCacheEvent } from '../src/cache/invalidate'
import { deleteEntityInstances } from '../src/entity-instances'

/** The only types this script touches. Order matters: nothing here points at the other. */
const TYPES = ['bank_transaction', 'journal_entry'] as const

const args = process.argv.slice(2)
const ORG_ARG = args.find((a) => !a.startsWith('--'))
const CONFIRM = args.includes('--confirm')
const KEEP_CONNECTOR_ITEMS = args.includes('--keep-connector-items')

if (!ORG_ARG) {
  console.error(
    'usage: reset-bank-and-journals.ts <organizationId|name> [options]\n\n' +
      '  options:\n' +
      '    --keep-connector-items  leave DataConnectorItem + stream watermarks alone.\n' +
      '                            🛑 Deleted records then do NOT come back on the\n' +
      '                            next sync.\n' +
      '    --confirm               actually write. Without it this is a dry run.\n'
  )
  process.exit(1)
}

async function resolveOrg(arg: string): Promise<{ id: string; name: string | null }> {
  const [byId] = await db
    .select({ id: schema.Organization.id, name: schema.Organization.name })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, arg))
    .limit(1)
  if (byId) return byId

  const [byName] = await db
    .select({ id: schema.Organization.id, name: schema.Organization.name })
    .from(schema.Organization)
    .where(eq(schema.Organization.name, arg))
    .limit(1)
  if (byName) return byName

  console.error(`no organization matched "${arg}"`)
  process.exit(1)
}

async function main() {
  const org = await resolveOrg(ORG_ARG!)

  console.log(`organization ${org.name} (${org.id})`)
  console.log(`scope        ${TYPES.join(' + ')}`)
  console.log(`mode         ${CONFIRM ? 'DELETE' : 'dry run (pass --confirm to write)'}\n`)

  const idsByType = new Map<string, string[]>()
  for (const type of TYPES) {
    const rows = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
      )
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, org.id),
          eq(schema.EntityDefinition.entityType, type)
        )
      )
    idsByType.set(
      type,
      rows.map((r) => r.id)
    )
    console.log(`  ${type.padEnd(18)} ${rows.length}`)
  }

  const allIds = [...idsByType.values()].flat()
  if (allIds.length === 0) {
    console.log('\nnothing to delete.\n')
    process.exit(0)
  }

  // A GlPosting against one of these is a posted entry. The product refuses to
  // delete it; this script does not, but it must SAY so rather than surprise.
  const [postings] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.GlPosting)
    .where(eq(schema.GlPosting.organizationId, org.id))
  console.log(`\n  GlPosting on this org: ${postings?.n ?? 0}`)

  const bindings = await db
    .select({ id: schema.DataConnectorItem.id })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, org.id),
        inArray(schema.DataConnectorItem.entityInstanceId, allIds)
      )
    )
  console.log(`  connector bindings on these records: ${bindings.length}`)

  const streamRows = bindings.length
    ? await db
        .selectDistinct({
          id: schema.DataConnectorStream.id,
          streamKey: schema.DataConnectorStream.streamKey,
          state: schema.DataConnectorStream.state,
          connectorName: schema.DataConnector.name,
        })
        .from(schema.DataConnectorItem)
        // `DataConnectorItem` points at the CONNECTOR, not at the stream, so
        // the stream is reached through the connector. Joining on a
        // `dataConnectorStreamId` that does not exist is how the first run of
        // this script reported zero streams while deleting 270 bindings.
        .innerJoin(
          schema.DataConnectorStream,
          eq(schema.DataConnectorStream.dataConnectorId, schema.DataConnectorItem.dataConnectorId)
        )
        .innerJoin(
          schema.DataConnector,
          eq(schema.DataConnector.id, schema.DataConnectorStream.dataConnectorId)
        )
        .where(
          and(
            eq(schema.DataConnectorItem.organizationId, org.id),
            inArray(schema.DataConnectorItem.entityInstanceId, allIds)
          )
        )
    : []
  for (const s of streamRows) {
    console.log(`    stream ${s.connectorName} · ${s.streamKey ?? '(no key)'}`)
  }

  if (!CONFIRM) {
    console.log('\ndry run — nothing was written. Re-run with --confirm.\n')
    process.exit(0)
  }

  // No foreign key onto the instance, so it is cleared explicitly.
  await db
    .delete(schema.RecordRuleRun)
    .where(
      and(
        eq(schema.RecordRuleRun.organizationId, org.id),
        inArray(schema.RecordRuleRun.entityInstanceId, allIds)
      )
    )

  if (!KEEP_CONNECTOR_ITEMS && bindings.length > 0) {
    await db.delete(schema.DataConnectorItem).where(
      inArray(
        schema.DataConnectorItem.id,
        bindings.map((b) => b.id)
      )
    )
    console.log(`deleted ${bindings.length} connector binding(s)`)
  } else if (KEEP_CONNECTOR_ITEMS) {
    console.log('--keep-connector-items: bindings left alone.')
    console.log('🛑 These records will NOT come back on the next sync.')
  }

  let deleted = 0
  for (const type of TYPES) {
    const ids = idsByType.get(type) ?? []
    if (ids.length === 0) continue
    const result = await deleteEntityInstances({ ids, organizationId: org.id })
    if (result.isErr()) {
      console.error(`\n🛑 failed on ${type}: ${result.error.message}`)
      process.exit(1)
    }
    deleted += result.value.count
    console.log(`deleted ${result.value.count} ${type} record(s)`)
  }

  // The records are gone; anything that cached a count or a list of them is
  // now wrong. `resources` and `customFields` carry per-def counts.
  await onCacheEvent('org.settings.changed', { orgId: org.id, broadcastUserKeys: true })
  await getOrgCache().invalidateAndRecompute(org.id, ['resources', 'customFields', 'orgSettings'])
  console.log('org cache invalidated')

  console.log(`\ndone. ${deleted} record(s) deleted.`)
  if (!KEEP_CONNECTOR_ITEMS && streamRows.length > 0) {
    console.log(
      `${streamRows.length} stream(s) still hold their watermark — re-run the connector's\n` +
        'backfill if these records should come back.'
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
