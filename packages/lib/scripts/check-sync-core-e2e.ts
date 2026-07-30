// packages/lib/scripts/check-sync-core-e2e.ts
//
// Runtime validation for the sync-core sliced-backfill engine (Milestones 1 & 2 of
// plans/data-connectors/v3/sync-core-implementation-progress.md). Drives a REAL
// generic-rest connector against a local mock HTTP server, through the REAL sync
// core, into REAL entity rows in the dev DB — the end-to-end run the tracker flags
// as "code-complete; runtime validation against a real 5k+ dataset still pending".
//
// What it exercises (all real code, no mocks below the HTTP boundary):
//   • generic-rest pagination → per-page checkpoints → SLICE_BUDGET chunking
//     (multi-slice resume across DataConnectorStream.state.backfillCursor)
//   • runSyncSlice (cursor-safety, checkpoint-after-slice, finalizeBackfill gate)
//   • the three DC adapters (SyncStateStore / RunLedger / SyncSource) + entity sink
//   • B1 multi-stream completion latch (first stream defers, last stream finalizes)
//   • phase machine: backfill ONCE → steady watermark deltas (G2)
//   • content-hash idempotent replay (an unchanged record re-seen in steady is skipped)
//
// What it does NOT exercise: the BullMQ enqueue/dequeue glue (enqueueBackfillSlice +
// the run-not-running guard in runBackfillSlice). To stay deterministic and to NOT
// contaminate the shared dev Redis queue (a local dev worker would race our jobs),
// this harness drives the chain IN-PROCESS, mirroring startConnectorSync's setup and
// runBackfillSlice's directive handling — and running slices CONCURRENTLY per round
// to match the worker's concurrency=2 (otherwise stream A would finalize the run
// before stream B starts). The orchestration logic under test is 100% the real code.
//
// Cleans up everything it creates (entity def + instances + fields + connector graph).
//
// Run from repo root under the worker runtime (the @auxx/lib import chain needs the
// `source` condition per project_tsx_scripts_filetype_esm):
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/check-sync-core-e2e.ts [organizationId]
//
// Env knobs:
//   RECORDS   widgets backfill size (default 5000) — the headline volume.
//   PAGE_SIZE records per page (default 100). Lower it for a fast smoke that still
//             chunks: RECORDS=300 PAGE_SIZE=10 → 30 pages → 2 slices.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(here, '../../../.env') })

const { database: db, schema } = await import('@auxx/database')
const { and, count, eq, isNotNull } = await import('drizzle-orm')
const { generateId } = await import('@auxx/utils')
const { createEntityDefinition } = await import('@auxx/services/entity-definitions')

const { SLICE_BUDGET, sweepStaleConnectorRuns } = await import(
  '../src/data-connectors/slice-orchestrator'
)
const { loadConnector, claimForSync, openRun, initConnectorBackfillLatch, persistStreamState } =
  await import('../src/data-connectors/service')
const { materializeConnectorTargets } = await import('../src/data-connectors/provisioning')
const { prepareConnectorFetch } = await import('../src/data-connectors/connector-runtime')
const { createConnectorStreamSyncSource } = await import(
  '../src/data-connectors/connector-sync-source'
)
const { createStreamSyncStateStore, createConnectorRunLedger } = await import(
  '../src/data-connectors/sync-core-adapters'
)
const { runSyncSlice } = await import('../src/sync-core/slice-runner')

// ── Config ────────────────────────────────────────────────────────────────────

const organizationId = process.argv[2] ?? 'mysfrfer86ri74v5fld8rq1x' // Acme Corp
const WIDGETS = Number(process.env.RECORDS ?? 5000)
const GADGETS = Number(process.env.GADGETS ?? 8) // second stream — exercises the B1 multi-stream latch
const STEADY_NEW = 50 // new widgets added before the steady run
const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? 100)
const NO_THROTTLE = { run: (fn: () => unknown) => fn() } as const

const BASE_TS = Date.parse('2026-01-01T00:00:00.000Z')
const tsFor = (n: number) => new Date(BASE_TS + n * 1000).toISOString()

let failures = 0
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    failures += 1
    console.error(`  ❌ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

// ── Mock HTTP server (the only thing below the real transport that we control) ──

interface Rec {
  id: string
  name: string
  email: string
  updated_at: string
}
// Mutable per-stream datasets so the steady run can add fresh records.
const data: Record<string, Rec[]> = {
  widgets: Array.from({ length: WIDGETS }, (_, i) => {
    const n = i + 1
    return { id: `w${n}`, name: `Widget ${n}`, email: `w${n}@example.com`, updated_at: tsFor(n) }
  }),
  gadgets: Array.from({ length: GADGETS }, (_, i) => {
    const n = i + 1
    return { id: `g${n}`, name: `Gadget ${n}`, email: `g${n}@example.com`, updated_at: tsFor(n) }
  }),
}

let pageHits = 0
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const streamKey = url.pathname.replace(/^\//, '') // /widgets → widgets
  const page = Number(url.searchParams.get('page') ?? '1')
  const limit = Number(url.searchParams.get('limit') ?? String(PAGE_SIZE))
  const since = url.searchParams.get('since') // injected only on steady (incremental) runs
  pageHits += 1

  let rows = data[streamKey] ?? []
  // Steady delta floor: `>=` so the boundary (max-watermark) record re-appears,
  // proving the content-hash skip path (idempotent replay), alongside the new rows.
  if (since) rows = rows.filter((r) => r.updated_at >= since)
  rows = [...rows].sort((a, b) =>
    a.updated_at === b.updated_at
      ? a.id.localeCompare(b.id)
      : a.updated_at.localeCompare(b.updated_at)
  )
  const start = (page - 1) * limit
  const items = rows.slice(start, start + limit)

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ items }))
})
await new Promise<void>((resolve) => server.listen(0, resolve))
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
console.log(`mock server on ${baseUrl}`)

// ── Setup: entity def + connector graph ─────────────────────────────────────────

// A real org member — the entity sink stamps `createdById` (User FK), so 'system'
// would violate the constraint. Pick any member of the target org.
const member = await db.query.OrganizationMember.findFirst({
  where: eq(schema.OrganizationMember.organizationId, organizationId),
  columns: { userId: true },
})
if (!member) throw new Error(`no OrganizationMember for org ${organizationId}`)
const createdById = member.userId
console.log(`using member ${createdById}`)

const slug = `sync_e2e_${Date.now()}`
const defResult = await createEntityDefinition({
  organizationId,
  apiSlug: slug,
  singular: 'SyncE2E',
  plural: 'SyncE2Es',
  icon: 'Box',
  color: 'blue',
  entityType: 'standard',
  standardType: 'custom',
})
if (defResult.isErr()) throw new Error(`createEntityDefinition failed: ${defResult.error.message}`)
const entityDefinitionId = defResult.value.id
console.log(`created entity def ${entityDefinitionId} (${slug})`)

const [connector] = await db
  .insert(schema.DataConnector)
  .values({
    organizationId,
    type: 'generic-rest',
    definitionKind: 'builtin',
    createdById,
    name: `sync-core-e2e ${slug}`,
    config: {
      endpoint: {
        baseUrl,
        auth: 'none',
        pagination: { kind: 'page', pageParam: 'page', limitParam: 'limit', pageSize: PAGE_SIZE },
      },
    },
    syncBehavior: 'manual',
    status: 'pending',
  })
  .returning()
const dataConnectorId = connector!.id

// Two incremental streams under one connector → the B1 latch has something to gate.
async function makeStream(streamKey: string) {
  const [stream] = await db
    .insert(schema.DataConnectorStream)
    .values({
      dataConnectorId,
      organizationId,
      streamKey,
      enabled: true,
      schemaSource: 'manual',
      syncMode: 'incremental',
      requestConfig: {
        path: `/${streamKey}`,
        method: 'GET',
        pagination: { kind: 'page', pageParam: 'page', limitParam: 'limit', pageSize: PAGE_SIZE },
        incremental: { sinceParam: 'since', watermarkField: 'updated_at', watermarkFormat: 'iso' },
      },
      state: {},
    })
    .returning()
  await db.insert(schema.DataConnectorMapping).values({
    dataConnectorStreamId: stream!.id,
    organizationId,
    rootPath: 'items[]',
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId,
    orphanBehavior: 'archive',
    fieldMappings: [
      {
        id: generateId(),
        targetFieldRef: null,
        expression: '{name}',
        sourceFields: { name: 'name' },
        provision: { name: `${streamKey}_name`, type: 'TEXT' },
      },
      {
        id: generateId(),
        targetFieldRef: null,
        expression: '{email}',
        sourceFields: { email: 'email' },
        provision: { name: `${streamKey}_email`, type: 'TEXT' },
      },
    ],
  })
  return stream!.id
}
await makeStream('widgets')
await makeStream('gadgets')
console.log(`created connector ${dataConnectorId} with 2 incremental streams`)

// ── Drive: mirror startConnectorSync setup + runBackfillSlice (in-process) ───────

function freshBackfillState(prev: Record<string, unknown>, startedAtIso: string) {
  return {
    ...prev,
    phase: 'backfill',
    backfillCursor: undefined,
    backfillStartedAt: startedAtIso,
    recordsSeen: 0,
    watermark: undefined,
    backfillComplete: false,
  }
}

/** Mirror of slice-orchestrator.startConnectorSync (minus the BullMQ enqueue). */
async function startChain(trigger: 'manual' | 'backfill') {
  await sweepStaleConnectorRuns(db, { dataConnectorId })
  // BEFORE loadConnector (matches the real orchestrator): materialize persists the
  // provisioned refs, and loadConnector below reads them back resolved.
  await materializeConnectorTargets(db, organizationId, dataConnectorId)
  const loaded = await loadConnector(db, organizationId, dataConnectorId)
  if (!loaded) throw new Error('loadConnector returned null')
  const { connector: conn, streams } = loaded

  if (!(await claimForSync(db, dataConnectorId)))
    throw new Error('claimForSync failed (already syncing)')

  const incrementalConnector = streams.every((s) => s.syncMode === 'incremental')
  const streamStates = streams.map((s) => (s.stream.state as Record<string, unknown>) ?? {})
  const phase: 'backfill' | 'steady' =
    incrementalConnector && streamStates.every((st) => st.phase === 'steady')
      ? 'steady'
      : 'backfill'

  const startedAtIso = new Date().toISOString()
  if (phase === 'backfill') {
    for (const [i, s] of streams.entries()) {
      const st = streamStates[i] ?? {}
      const resumable = incrementalConnector && st.phase === 'backfill' && !!st.backfillCursor
      if (!resumable)
        await persistStreamState(db, s.stream.id, freshBackfillState(st, startedAtIso))
    }
  }

  const snapshot = {
    streams: streams.map((s) => ({
      streamId: s.stream.id,
      streamKey: s.stream.streamKey ?? '',
      syncMode: s.syncMode,
      requestConfig: s.stream.requestConfig ?? undefined,
      mappings: s.mappings,
    })),
  }
  const run = await openRun(db, {
    dataConnectorId,
    organizationId,
    trigger,
    mode: phase === 'steady' ? 'incremental' : 'snapshot',
    phase,
    chainSnapshot: snapshot as unknown as Record<string, unknown>,
    cursorBefore: conn.state,
  })
  await initConnectorBackfillLatch(db, dataConnectorId, streams.length)
  return { runId: run.id, streamIds: streams.map((s) => s.stream.id), phase }
}

/** Mirror of runBackfillSlice: run ONE slice for a stream and return the directive. */
async function runOneSlice(streamId: string, runId: string) {
  const run = await db.query.DataConnectorRun.findFirst({
    where: eq(schema.DataConnectorRun.id, runId),
  })
  if (!run || run.status !== 'running') return { action: 'stopped', status: run?.status } as const

  const snapshot = run.chainSnapshot as { streams: any[] } | null
  const streamSnap = snapshot?.streams.find((s) => s.streamId === streamId)
  if (!streamSnap) return { action: 'stopped', status: 'no-snapshot' } as const

  const conn = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, dataConnectorId),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
  })
  if (!conn) return { action: 'stopped', status: 'connector-gone' } as const

  const { definition, credential } = await prepareConnectorFetch(
    db,
    organizationId,
    conn,
    conn.createdById ?? 'system'
  )
  const source = createConnectorStreamSyncSource({
    db,
    organizationId,
    connector: conn,
    definition,
    credential,
    config: conn.config,
    run: { id: runId, startedAt: run.startedAt },
    stream: streamSnap,
    allStreams: snapshot?.streams ?? [streamSnap],
  })
  const outcome = await runSyncSlice({
    source,
    stateStore: createStreamSyncStateStore(db, streamId),
    ledger: createConnectorRunLedger(db, { id: runId, startedAt: run.startedAt }, streamId),
    throttle: NO_THROTTLE,
    budget: SLICE_BUDGET,
    signal: new AbortController().signal,
  })
  if (outcome.action === 'complete' && outcome.completedPhase === 'steady') {
    await source.finalizeSteady()
  }
  return outcome
}

/**
 * Drive the whole chain to completion, running one slice per active stream per round
 * CONCURRENTLY (mirrors the worker's concurrency=2 — all active streams load the run
 * while it's still 'running', then process). Returns per-stream slice counts.
 */
async function driveChain(runId: string, streamIds: string[]) {
  const active = new Set(streamIds)
  const slices: Record<string, number> = Object.fromEntries(streamIds.map((id) => [id, 0]))
  let round = 0
  while (active.size > 0) {
    round += 1
    if (round > 10_000) throw new Error('drive loop runaway')
    const ids = [...active]
    const outcomes = await Promise.all(ids.map((id) => runOneSlice(id, runId)))
    for (const [i, outcome] of outcomes.entries()) {
      const id = ids[i]!
      slices[id] += 1
      if (outcome.action === 'failed')
        throw new Error(`stream ${id} failed: ${(outcome as any).error?.message}`)
      if (outcome.action !== 'reenqueue') active.delete(id)
    }
  }
  return slices
}

// ── Small DB read helpers ───────────────────────────────────────────────────────

const instanceCount = async () =>
  (
    await db
      .select({ n: count() })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
        )
      )
  )[0]!.n
const itemCount = async () =>
  (
    await db
      .select({ n: count() })
      .from(schema.DataConnectorItem)
      .where(eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId))
  )[0]!.n
const getRun = (runId: string) =>
  db.query.DataConnectorRun.findFirst({ where: eq(schema.DataConnectorRun.id, runId) })
const getConnector = () =>
  db.query.DataConnector.findFirst({ where: eq(schema.DataConnector.id, dataConnectorId) })
const getStreamState = async (streamKey: string) => {
  const s = await db.query.DataConnectorStream.findFirst({
    where: and(
      eq(schema.DataConnectorStream.dataConnectorId, dataConnectorId),
      eq(schema.DataConnectorStream.streamKey, streamKey)
    ),
  })
  return (s?.state ?? {}) as Record<string, any>
}

try {
  // ── RUN 1 — backfill ──────────────────────────────────────────────────────────
  console.log(
    `\n=== RUN 1: backfill (${WIDGETS} widgets + ${GADGETS} gadgets, pageSize ${PAGE_SIZE}) ===`
  )
  const t0 = Date.now()
  const chain1 = await startChain('backfill')
  check('run opened in backfill phase, snapshot mode', chain1.phase === 'backfill')
  const slices1 = await driveChain(chain1.runId, chain1.streamIds)
  console.log(
    `  drove in ${((Date.now() - t0) / 1000).toFixed(1)}s — slices: ${JSON.stringify(slices1)}`
  )

  const run1 = await getRun(chain1.runId)
  const conn1 = await getConnector()
  const total1 = WIDGETS + GADGETS
  check('run completed', run1?.status === 'completed', run1?.status)
  check('run.created == total records', run1?.created === total1, {
    created: run1?.created,
    total: total1,
  })
  check('run.fetched == total records', run1?.fetched === total1, run1?.fetched)
  check('entity instances == total records', (await instanceCount()) === total1)
  check('DataConnectorItem bindings == total records', (await itemCount()) === total1)

  // ── Field Lock & Provenance (owned mode) ──────────────────────────────────────
  // Owned provisioning stamps CustomField.dataConnectorId on every provisioned
  // field (drives the "Managed by <connector>" column lock) and writes via the
  // owned path — which must NOT set the per-cell contributing marker.
  const provisionedFieldCount = (
    await db
      .select({ n: count() })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.dataConnectorId, dataConnectorId))
  )[0]!.n
  check(
    'owned: provisioned CustomFields carry dataConnectorId (4 fields)',
    provisionedFieldCount === 4,
    provisionedFieldCount
  )
  const ownedManagedMarkers = (
    await db
      .select({ n: count() })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityDefinitionId, entityDefinitionId),
          isNotNull(schema.FieldValue.managedByConnectorId)
        )
      )
  )[0]!.n
  check('owned: no FieldValue.managedByConnectorId markers set', ownedManagedMarkers === 0, {
    markers: ownedManagedMarkers,
  })
  // Chunking: the big widgets stream must have spanned MORE THAN ONE slice.
  const widgetsSliceCount = slices1[chain1.streamIds[0]!]!
  const expectMultiSlice = Math.ceil(WIDGETS / PAGE_SIZE) > SLICE_BUDGET.maxPages
  check(
    `widgets backfill chunked across multiple slices (${widgetsSliceCount})`,
    !expectMultiSlice || widgetsSliceCount > 1,
    {
      slices: widgetsSliceCount,
      pages: Math.ceil(WIDGETS / PAGE_SIZE),
      budget: SLICE_BUDGET.maxPages,
    }
  )
  // Phase machine: both streams flipped to steady after backfill.
  check('widgets stream flipped to steady', (await getStreamState('widgets')).phase === 'steady')
  check('gadgets stream flipped to steady', (await getStreamState('gadgets')).phase === 'steady')
  // Watermark primed during backfill = max updated_at across the dataset.
  check(
    'widgets watermark == max updated_at',
    (await getStreamState('widgets')).watermark === tsFor(WIDGETS),
    { got: (await getStreamState('widgets')).watermark, want: tsFor(WIDGETS) }
  )
  // B1 latch fully drained + connector released.
  check('B1 latch drained to 0', (conn1?.state as any)?.backfillStreamsRemaining === 0)
  check('connector status == live', conn1?.status === 'live', conn1?.status)
  check('connector itemCount == total', conn1?.itemCount === total1, conn1?.itemCount)

  // ── RUN 2 — steady delta + idempotent replay ────────────────────────────────────
  console.log(`\n=== RUN 2: steady (add ${STEADY_NEW} new widgets; re-see the boundary record) ===`)
  for (let i = 1; i <= STEADY_NEW; i++) {
    const n = WIDGETS + i
    data.widgets.push({
      id: `w${n}`,
      name: `Widget ${n}`,
      email: `w${n}@example.com`,
      updated_at: tsFor(WIDGETS + 1000 + i), // strictly newer than the backfill max
    })
  }
  const instancesBefore = await instanceCount()
  const chain2 = await startChain('manual')
  check('run opened in steady phase, incremental mode', chain2.phase === 'steady')
  const run2open = await getRun(chain2.runId)
  check('run2 mode == incremental', run2open?.mode === 'incremental', run2open?.mode)
  const slices2 = await driveChain(chain2.runId, chain2.streamIds)
  console.log(`  slices: ${JSON.stringify(slices2)}`)

  const run2 = await getRun(chain2.runId)
  const conn2 = await getConnector()
  check('run2 completed', run2?.status === 'completed', run2?.status)
  check('steady created == new records only', run2?.created === STEADY_NEW, run2?.created)
  // The boundary (max-watermark) record of EACH stream re-appears under `>=` and is
  // unchanged → content-hash skip. Proves idempotent replay (no double-write).
  check('steady skipped unchanged records (content-hash)', (run2?.skipped ?? 0) >= 1, run2?.skipped)
  check('no rows updated (nothing changed)', run2?.updated === 0, run2?.updated)
  check(
    'entity instances grew by exactly the new records',
    (await instanceCount()) === instancesBefore + STEADY_NEW
  )
  check(
    'widgets watermark advanced past backfill max',
    (await getStreamState('widgets')).watermark === tsFor(WIDGETS + 1000 + STEADY_NEW),
    (await getStreamState('widgets')).watermark
  )
  check('connector still live after steady', conn2?.status === 'live', conn2?.status)

  console.log(`\n${failures === 0 ? '🎉 ALL CHECKS PASSED' : `💥 ${failures} CHECK(S) FAILED`}`)
} finally {
  // ── Cleanup (connector graph first — mappings restrict-FK the def) ──────────────
  console.log('\ncleaning up…')
  await db
    .delete(schema.DataConnectorItem)
    .where(eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId))
  await db
    .delete(schema.DataConnectorRun)
    .where(eq(schema.DataConnectorRun.dataConnectorId, dataConnectorId))
  await db.delete(schema.DataConnector).where(eq(schema.DataConnector.id, dataConnectorId)) // cascades streams + mappings
  await db.delete(schema.EntityDefinition).where(eq(schema.EntityDefinition.id, entityDefinitionId)) // cascades instances + fields + values
  server.close()
}

process.exit(failures === 0 ? 0 : 1)
