// packages/lib/src/data-connectors/__tests__/sink-page-profile.int.test.ts
// Before/after harness for the connector sink: statements and ms per record kind for one
// Shopify-shaped page (see plans/mrp/14-batched-connector-sink.md §3). Env: SINK_PROFILE_RECORDS.

import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectorRecord } from '../connectors/types'
import { sinkSourceRecord } from '../sink-source-record'
import { entitySink } from '../sinks/entity-sink'
import type { SyncCtx } from '../sinks/types'
import {
  buildCtx,
  type Connector,
  seedConnector,
  seedOrg,
  shopifyOrder,
} from './support/shopify-page'

vi.mock('../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

const RECORDS = Number(process.env.SINK_PROFILE_RECORDS ?? 20)
const CUSTOMERS = Math.max(1, Math.ceil(RECORDS / 2))
const SOURCE = '(source: edges + child sets)'

interface Row {
  label: string
  records: number
  created: number
  updated: number
  skipped: number
  statements: number
  ms: number
}

/** Counts every `pg` statement against whichever record is being sunk at the time. */
function createProfiler(c: Connector) {
  const rows = new Map<string, Row>()
  let current: string | null = null
  const row = (label: string): Row => {
    let r = rows.get(label)
    if (!r) {
      r = { label, records: 0, created: 0, updated: 0, skipped: 0, statements: 0, ms: 0 }
      rows.set(label, r)
    }
    return r
  }
  const original = pg.Client.prototype.query
  const querySpy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    if (current) row(current).statements += 1
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as never)
  const upsert = entitySink.upsertRecord.bind(entitySink)
  const upsertSpy = vi
    .spyOn(entitySink, 'upsertRecord')
    .mockImplementation(async (ctx, mapping, record) => {
      const outer = current
      const label = c.labelByMapping.get(mapping.row.id) ?? mapping.row.id
      const before = { ...ctx.counters }
      current = label
      const t0 = performance.now()
      try {
        await upsert(ctx, mapping, record)
      } finally {
        const ms = performance.now() - t0
        current = outer
        const r = row(label)
        r.records += 1
        r.ms += ms
        r.created += ctx.counters.created - before.created
        r.updated += ctx.counters.updated - before.updated
        r.skipped += ctx.counters.skipped - before.skipped
        if (outer) row(outer).ms -= ms
      }
    })

  return {
    rows,
    /** Sink one source record, attributing what falls outside `upsertRecord` to SOURCE. */
    async sink(ctx: SyncCtx, source: ConnectorRecord) {
      current = SOURCE
      const t0 = performance.now()
      try {
        await sinkSourceRecord(ctx, c.mappings, source, 'updated_at')
      } finally {
        const r = row(SOURCE)
        r.records += 1
        r.ms += performance.now() - t0
        current = null
      }
    },
    reset() {
      rows.clear()
    },
    restore() {
      querySpy.mockRestore()
      upsertSpy.mockRestore()
    },
  }
}

function formatTable(title: string, rows: Row[]): string {
  const total: Row = {
    label: 'total',
    records: rows.filter((r) => r.label !== SOURCE).reduce((s, r) => s + r.records, 0),
    created: rows.reduce((s, r) => s + r.created, 0),
    updated: rows.reduce((s, r) => s + r.updated, 0),
    skipped: rows.reduce((s, r) => s + r.skipped, 0),
    statements: rows.reduce((s, r) => s + r.statements, 0),
    ms: rows.reduce((s, r) => s + r.ms, 0),
  }
  const line = (r: Row) =>
    `| ${r.label} | ${r.records} | ${r.created} / ${r.updated} / ${r.skipped} | ${r.statements} | ${(
      r.statements / Math.max(1, r.records)
    ).toFixed(1)} | ${r.ms.toFixed(0)} | ${(r.ms / Math.max(1, r.records)).toFixed(1)} |`
  return [
    `### ${title}`,
    '',
    '| Mapping | Records | Created / updated / skipped | Statements | Stmts / record | ms | ms / record |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(line),
    line(total),
  ].join('\n')
}

describe('sink page profile (plan 14a)', () => {
  it(`sinks a ${RECORDS}-order Shopify page twice and reports statements and ms per mapping`, async () => {
    const o = await seedOrg()
    const c = await seedConnector(o)
    const profiler = createProfiler(c)
    try {
      // Warm the caches a real slice has already loaded by its second page; not measured.
      const warm = await buildCtx(o, c)
      await sinkSourceRecord(warm, c.mappings, shopifyOrder(o, 0, 'warm', CUSTOMERS), 'updated_at')
      expect(warm.counters.errorSample).toEqual([])
      profiler.reset()

      const page = Array.from({ length: RECORDS }, (_, i) => shopifyOrder(o, i, '', CUSTOMERS))
      const order = [...c.labelByMapping.values()]
      const sorted = () =>
        [...profiler.rows.values()].sort(
          (a, b) =>
            (a.label === SOURCE ? 99 : order.indexOf(a.label)) -
            (b.label === SOURCE ? 99 : order.indexOf(b.label))
        )

      const first = await buildCtx(o, c)
      for (const source of page) await profiler.sink(first, source)
      const firstTable = formatTable(`Pass 1: first backfill (${RECORDS} orders)`, sorted())
      const firstCounters = { ...first.counters }
      profiler.reset()

      const second = await buildCtx(o, c)
      for (const source of page) await profiler.sink(second, source)
      const secondTable = formatTable(`Pass 2: same page again (${RECORDS} orders)`, sorted())

      console.log(`\n${firstTable}\n\n${secondTable}\n`)

      expect(firstCounters.errorSample).toEqual([])
      expect(firstCounters.failed).toBe(0)
      expect(firstCounters.created).toBeGreaterThan(0)
      expect(second.counters.errorSample).toEqual([])
      expect(second.counters.failed).toBe(0)
      expect(second.counters.created).toBe(0)
      // The embedded customer has no name, so its projected displayName is the parent order's
      // and its content hash changes per order: contacts update on every pass (plan 14 §3).
      const contact = c.labelByMapping.get(
        c.mappings.find((m) => m.entityDefinitionId === o.defs.get('contact'))!.row.id
      )
      for (const r of profiler.rows.values()) {
        if (r.label === SOURCE || r.label === contact) continue
        expect({ label: r.label, skipped: r.skipped }).toEqual({
          label: r.label,
          skipped: r.records,
        })
      }
    } finally {
      profiler.restore()
    }
  }, 600_000)
})
