// packages/lib/scripts/replay-orphaned-run-manifests.ts
//
// 🛑 DEV/OPS REPAIR, NOT ROUTINE. Consumes a connector's UNCONSUMED run manifests, so
// the finalize integrity passes run over the records those runs wrote.
//
//   npx dotenv -- npx tsx packages/lib/scripts/replay-orphaned-run-manifests.ts <connectorId>
//   npx dotenv -- npx tsx packages/lib/scripts/replay-orphaned-run-manifests.ts <connectorId> --confirm
//
// Read-only without `--confirm`.
//
// ── Why any run has an unconsumed manifest ──────────────────────────────────
//
// `publishSyncRecordsChanged` fired only at the last stream's connector-level
// finalize. A run parked at the ingest ceiling or a sample cap never reached it, so
// its manifest was persisted and nothing ever consumed it — and a later run does not
// re-publish an older run's manifest. Fixed forward in `finalizeAtPark`
// (plans/money/tasks/51 §9), which leaves the runs that parked BEFORE that fix.
//
// `sync:records:changed` is the only door to the finalize integrity passes, so every
// one of them skipped for those runs: document totals, address normalization, phone
// geo, order demand, interactions, and the derived fulfillment log.
//
// ── 🛑 This is a RE-DELIVERY, not a repair pass ─────────────────────────────
//
// The once-only claim (`claimRunManifestConsumed`) makes this non-DUPLICATING. It does
// not make it harmless. Publishing a run's manifest runs the whole door chain, and
// `handle-sync-record-rules` fires RECORD RULES first, whose own docblock says they
// "carry no idempotency of their own". A `set-field` rule on `created` rewrites a field
// on every record the run created; a `notify` rule mails about records that synced
// hours ago.
//
// So the script REFUSES unless all three preconditions hold, and prints what it found:
//
//   1. No enabled record rule on any def in the manifests.
//   2. `accounting.fulfillmentPosting` is not `auto` — integrity pass 7 enqueues a
//      posting run when pass 6 changes a log.
//   3. Every manifest is large enough to take the LARGE lane
//      (> SYNC_SMALL_RUN_THRESHOLD), where workflow dispatch is tallied and held for
//      approval rather than enqueued. A small manifest auto-dispatches per record.
//
// Workflows are reported, not refused on: the large lane holds at/above
// WORKFLOW_AUTO_DISPATCH_THRESHOLD matched records, so the worst case is a
// `bulk-dispatch` approval request.
//
// ── Ordering ────────────────────────────────────────────────────────────────
//
// Oldest run first, one at a time, awaited. The passes read stored values rather than
// the manifest's snapshots, so a later run's writes must not be overwritten by an
// earlier run's replay.

import { database, schema } from '@auxx/database'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
// Relative imports on purpose: `generate-exports.ts` derives package.json exports from
// consumer imports under apps/ + packages/ and skips packages/lib itself.
import { handleSyncRecordRules } from '../src/events/handlers/handle-sync-record-rules'
import type { SyncChangeManifest } from '../src/record-rules/sync-manifest-types'
import { SYNC_SMALL_RUN_THRESHOLD } from '../src/resources/crud/door-matrix'

interface OrphanRun {
  id: string
  status: string
  startedAt: Date
  manifest: SyncChangeManifest
  /** Distinct records the manifest carries: touched ∪ created ∪ archived. */
  changed: number
  /** Def ids the manifest touches, in the producer's keyspace (CUID for connectors). */
  defIds: Set<string>
}

/** Distinct record + def sets for one manifest, the way `collectChangedSets` counts. */
function summarize(manifest: SyncChangeManifest): { changed: number; defIds: Set<string> } {
  const ids = new Set<string>([
    ...Object.keys(manifest.touched ?? {}),
    ...(manifest.createdRecordIds ?? []),
    ...(manifest.archivedRecordIds ?? []),
  ])
  const defIds = new Set<string>()
  for (const rid of ids) {
    const defId = rid.split(':')[0]
    if (defId) defIds.add(defId)
  }
  return { changed: ids.size, defIds }
}

async function loadOrphans(dataConnectorId: string): Promise<OrphanRun[]> {
  const rows = await database.query.DataConnectorRun.findMany({
    where: and(
      eq(schema.DataConnectorRun.dataConnectorId, dataConnectorId),
      isNull(schema.DataConnectorRun.manifestConsumedAt)
    ),
    orderBy: asc(schema.DataConnectorRun.startedAt),
    columns: { id: true, status: true, startedAt: true, manifest: true },
  })
  const out: OrphanRun[] = []
  for (const row of rows) {
    const manifest = row.manifest as SyncChangeManifest | null
    if (!manifest) continue
    out.push({
      id: row.id,
      status: row.status,
      startedAt: row.startedAt,
      manifest,
      ...summarize(manifest),
    })
  }
  return out
}

/** Enabled record rules on any def the manifests touch — precondition 1. */
async function blockingRules(organizationId: string, defIds: Set<string>) {
  const rules = await database.query.RecordRule.findMany({
    where: and(
      eq(schema.RecordRule.organizationId, organizationId),
      eq(schema.RecordRule.enabled, true)
    ),
    columns: { id: true, name: true, on: true, entityDefinitionId: true, fieldId: true },
  })
  return rules.filter((r) => defIds.has(r.entityDefinitionId))
}

/** `accounting.fulfillmentPosting`, defaulting to `manual` when unset — precondition 2. */
async function fulfillmentPostingMode(organizationId: string): Promise<string> {
  const row = await database.query.OrganizationSetting.findFirst({
    where: and(
      eq(schema.OrganizationSetting.organizationId, organizationId),
      eq(schema.OrganizationSetting.key, 'accounting.fulfillmentPosting')
    ),
    columns: { value: true },
  })
  const value = row?.value
  return typeof value === 'string' ? value : 'manual'
}

async function main() {
  const [dataConnectorId] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const confirm = process.argv.includes('--confirm')
  if (!dataConnectorId) {
    console.error('usage: replay-orphaned-run-manifests.ts <connectorId> [--confirm]')
    process.exit(1)
  }

  const connector = await database.query.DataConnector.findFirst({
    where: eq(schema.DataConnector.id, dataConnectorId),
    columns: { id: true, organizationId: true, type: true, status: true },
  })
  if (!connector) {
    console.error(`no connector ${dataConnectorId}`)
    process.exit(1)
  }
  const organizationId = connector.organizationId
  console.log(`connector ${connector.id} (${connector.type}, ${connector.status})`)
  console.log(`org        ${organizationId}\n`)

  const orphans = await loadOrphans(dataConnectorId)
  if (orphans.length === 0) {
    console.log('no unconsumed manifests — nothing to replay')
    return
  }

  const allDefIds = new Set<string>()
  for (const run of orphans) for (const d of run.defIds) allDefIds.add(d)

  console.log(`${orphans.length} unconsumed manifest(s), oldest first:\n`)
  for (const run of orphans) {
    const flags = [
      run.manifest.detailTruncated ? 'detailTruncated' : null,
      run.manifest.membershipTruncated ? 'membershipTruncated' : null,
    ].filter(Boolean)
    console.log(
      `  ${run.id}  ${run.status.padEnd(9)}  ${run.startedAt.toISOString()}  ` +
        `changed=${String(run.changed).padStart(6)}  defs=${run.defIds.size}` +
        (flags.length > 0 ? `  ⚠️ ${flags.join(',')}` : '')
    )
  }

  // ── Preconditions ─────────────────────────────────────────────────────────
  console.log('\npreconditions:')
  const refusals: string[] = []

  const rules = await blockingRules(organizationId, allDefIds)
  if (rules.length > 0) {
    for (const r of rules) {
      console.log(`  🛑 enabled record rule "${r.name}" (${r.id}) on ${r.entityDefinitionId}`)
    }
    refusals.push(
      `${rules.length} enabled record rule(s) on a def in these manifests — a replay fires them`
    )
  } else {
    console.log('  ✅ no enabled record rule on any def in these manifests')
  }

  const mode = await fulfillmentPostingMode(organizationId)
  if (mode === 'auto') {
    refusals.push('accounting.fulfillmentPosting is `auto` — integrity pass 7 would post')
    console.log('  🛑 accounting.fulfillmentPosting = auto')
  } else {
    console.log(`  ✅ accounting.fulfillmentPosting = ${mode}`)
  }

  const small = orphans.filter((r) => r.changed <= SYNC_SMALL_RUN_THRESHOLD)
  if (small.length > 0) {
    refusals.push(
      `${small.length} manifest(s) at or below the small-lane threshold ` +
        `(${SYNC_SMALL_RUN_THRESHOLD}) — workflow dispatch auto-enqueues per record there`
    )
    console.log(`  🛑 ${small.length} manifest(s) would take the SMALL lane`)
  } else {
    console.log(`  ✅ every manifest takes the LARGE lane (workflow dispatch is held)`)
  }

  const workflows = await database.query.Workflow.findMany({
    where: and(
      eq(schema.Workflow.organizationId, organizationId),
      eq(schema.Workflow.enabled, true)
    ),
    columns: { id: true, name: true, triggerType: true },
  })
  const resourceTriggered = workflows.filter(
    (w) => w.triggerType === 'created' || w.triggerType === 'updated'
  )
  console.log(
    `  ℹ️  ${resourceTriggered.length} enabled resource-triggered workflow(s): ` +
      (resourceTriggered.map((w) => w.name).join(', ') || 'none') +
      ' — held for approval on the large lane, not enqueued'
  )

  if (refusals.length > 0) {
    console.error('\n🛑 refusing to replay:')
    for (const r of refusals) console.error(`   - ${r}`)
    process.exit(1)
  }

  if (!confirm) {
    console.log('\nread-only. re-run with --confirm to replay.')
    return
  }

  // ── Replay ────────────────────────────────────────────────────────────────
  console.log('\nreplaying, oldest first:\n')
  for (const run of orphans) {
    const started = Date.now()
    await handleSyncRecordRules({
      data: {
        type: 'sync:records:changed',
        data: {
          source: 'connector',
          organizationId,
          ref: run.id,
          runId: run.id,
          dataConnectorId,
        },
      } as never,
    })
    const claimed = await database.query.DataConnectorRun.findFirst({
      where: eq(schema.DataConnectorRun.id, run.id),
      columns: { manifestConsumedAt: true },
    })
    const ok = claimed?.manifestConsumedAt != null
    console.log(
      `  ${ok ? '✅' : '🛑'} ${run.id}  changed=${run.changed}  ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s  ` +
        `consumedAt=${claimed?.manifestConsumedAt?.toISOString() ?? 'NULL'}`
    )
  }

  const remaining = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.DataConnectorRun)
    .where(
      and(
        eq(schema.DataConnectorRun.dataConnectorId, dataConnectorId),
        isNull(schema.DataConnectorRun.manifestConsumedAt),
        sql`${schema.DataConnectorRun.manifest} IS NOT NULL`
      )
    )
  console.log(`\nunconsumed manifests remaining: ${remaining[0]?.n ?? '?'}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
