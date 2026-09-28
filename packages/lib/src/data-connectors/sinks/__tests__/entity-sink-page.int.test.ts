// packages/lib/src/data-connectors/sinks/__tests__/entity-sink-page.int.test.ts
// Sink equivalence (plans/mrp/14-batched-connector-sink.md §6.1, §7): one Shopify-shaped page sunk
// through `upsertRecord` per record and through `upsertRecords` on fresh orgs stores, binds,
// captures and counts the same. The page cases skip until `entitySink.upsertRecords` exists.

import { schema } from '@auxx/database'
import { stableHash } from '@auxx/utils/hash'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import type { SyncRuleSubscriptions } from '../../../record-rules/subscriptions'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../../../record-rules/sync-manifest-collector'
import {
  buildCtx,
  type Connector,
  db,
  type Kind,
  type Org,
  seedConnector,
  seedOrg,
  shopifyOrder,
} from '../../__tests__/support/shopify-page'
import type { ConnectorRecord } from '../../connectors/types'
import type { DecodedMapping } from '../../service'
import { sinkSourceRecord } from '../../sink-source-record'
import { entitySink } from '../entity-sink'
import type { ProjectedRecord, SyncCtx } from '../types'

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

/** One projected write of a page, in the order the slice loop sinks it. */
interface PageWrite {
  mapping: DecodedMapping
  record: ProjectedRecord
}
type Sink = (ctx: SyncCtx, writes: PageWrite[]) => Promise<void>
interface PageSink {
  upsertRecords(records: PageWrite[], ctx: SyncCtx): Promise<unknown>
}

const pageSink = entitySink as unknown as Partial<PageSink>
const HAS_PAGE_PATH = typeof pageSink.upsertRecords === 'function'
const PAGE = HAS_PAGE_PATH ? 'page path' : 'page path (skipped: no entitySink.upsertRecords yet)'

/** Today's path: `upsertRecord` per projected record, as `sinkSourceRecord` does. */
const sinkPerRecord: Sink = async (ctx, writes) => {
  for (const w of writes) await entitySink.upsertRecord(ctx, w.mapping, w.record)
}

/** The page path (plan 14b); adapt this call if the landed signature differs. */
const sinkPage: Sink = async (ctx, writes) => {
  await (pageSink as PageSink).upsertRecords(writes, ctx)
}

const KINDS: Kind[] = [
  'order',
  'contact',
  'line_item',
  'fulfillment',
  'fulfillment_line',
  'tax_line',
  'customer_transaction',
]

const ORDERS = 6
const CUSTOMERS = 3
/** order, contact, 2 line items, fulfillment, 2 fulfillment lines, 2 tax lines, transaction. */
const RECORDS_PER_ORDER = 10

interface World {
  o: Org
  c: Connector
  writes: PageWrite[]
}

/** The parts of a `shopifyOrder` payload the cases edit. */
interface OrderFields {
  customer: Record<string, unknown>
  line_items: Array<{ id: string }>
  fulfillments: Array<{ line_items: Array<{ id: string }> }>
  tax_lines: Array<{ title: string }>
}
const fieldsOf = (record: ConnectorRecord) => record.fields as unknown as OrderFields

/** Customers carry a `name`, so their projected displayName (and hash) is stable across orders. */
function page(o: Org, orders: number, customers: number): ConnectorRecord[] {
  return Array.from({ length: orders }, (_, i) => {
    const record = shopifyOrder(o, i, '', customers)
    const { customer } = fieldsOf(record)
    customer.name = `Customer ${customer.id}`
    return record
  })
}

/** Project a page through `sinkSourceRecord` with the sink stubbed, keeping what it would sink. */
async function project(o: Org, c: Connector, source: ConnectorRecord[]): Promise<PageWrite[]> {
  const writes: PageWrite[] = []
  const keep = (mapping: DecodedMapping, record: ProjectedRecord) =>
    writes.push({ mapping, record: structuredClone(record) })
  const spies = [
    vi.spyOn(entitySink, 'upsertRecord').mockImplementation(async (_ctx, m, r) => {
      keep(m, r)
    }),
  ]
  if (HAS_PAGE_PATH) {
    spies.push(
      vi.spyOn(pageSink as PageSink, 'upsertRecords').mockImplementation(async (records) => {
        for (const w of records) keep(w.mapping, w.record)
      }) as never
    )
  }
  try {
    const ctx = await buildCtx(o, c)
    for (const record of source) await sinkSourceRecord(ctx, c.mappings, record, 'updated_at')
    expect(ctx.counters.errorSample).toEqual([])
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return writes
}

async function world(build: (o: Org) => ConnectorRecord[]): Promise<World> {
  const o = await seedOrg()
  const c = await seedConnector(o)
  return { o, c, writes: await project(o, c, build(o)) }
}

/** Every mapped field subscribed, so the manifest captures created values and update deltas. */
function subscribeAll(o: Org): SyncRuleSubscriptions {
  return Object.fromEntries(
    KINDS.map((kind) => [
      o.defs.get(kind)!,
      {
        fieldIds: new Set([
          ...[...o.fields.get(kind)!.values()].map((f) => f.id),
          o.identity.get(kind)!,
        ]),
        lifecycle: { created: true, deleted: false },
      },
    ])
  )
}

interface Pass {
  runId: string
  counters: SyncCtx['counters']
  manifest: ReturnType<ManifestCollector['toJson']>
}

/** One run sinking the world's page through `sink`; records are cloned, the sink may mutate. */
async function pass(w: World, sink: Sink): Promise<Pass> {
  const collector = createManifestCollector(subscribeAll(w.o))
  const ctx = await buildCtx(w.o, w.c, collector)
  await sink(
    ctx,
    w.writes.map(({ mapping, record }) => ({ mapping, record: structuredClone(record) }))
  )
  return { runId: ctx.runId, counters: ctx.counters, manifest: collector.toJson() }
}

/** Everything the sink wrote for the world, with ids tokenised and write timestamps dropped. */
async function snapshot(w: World, passes: Pass[]) {
  const { o, c } = w
  const org = o.orgId
  const [defs, fields, instances, values, items] = await Promise.all([
    db()
      .select()
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, org)),
    db().select().from(schema.CustomField).where(eq(schema.CustomField.organizationId, org)),
    db().select().from(schema.EntityInstance).where(eq(schema.EntityInstance.organizationId, org)),
    db().select().from(schema.FieldValue).where(eq(schema.FieldValue.organizationId, org)),
    db()
      .select()
      .from(schema.DataConnectorItem)
      .where(eq(schema.DataConnectorItem.dataConnectorId, c.row.id)),
  ])
  const slug = new Map(defs.map((d) => [d.id, d.apiSlug]))
  const tokens = new Map<string, string>([
    [org, 'ORG'],
    [o.userId, 'USER'],
    [c.row.id, 'CONNECTOR'],
  ])
  for (const d of defs) tokens.set(d.id, `DEF(${d.apiSlug})`)
  for (const f of fields) {
    tokens.set(f.id, `FIELD(${slug.get(f.entityDefinitionId!)}.${f.systemAttribute ?? f.name})`)
  }
  for (const [id, label] of c.labelByMapping) tokens.set(id, `MAPPING(${label})`)
  passes.forEach((p, n) => tokens.set(p.runId, `RUN${n}`))
  for (const i of instances) {
    const bound = items.filter((it) => it.entityInstanceId === i.id).map((it) => it.externalId)
    tokens.set(i.id, `REC(${slug.get(i.entityDefinitionId)}:${[...new Set(bound)].sort()})`)
  }
  for (const it of items) tokens.set(it.id, `ITEM(${it.externalId})`)
  // The hash covers org-specific field ids; name it by the projected record it hashes.
  for (const { record } of w.writes) {
    const hash = stableHash({ fields: record.fields, displayName: record.displayName })
    if (!tokens.has(hash)) tokens.set(hash, `HASH(${record.externalId})`)
  }

  const pattern = new RegExp([...tokens.keys()].sort((a, b) => b.length - a.length).join('|'), 'g')
  const norm = <T>(value: T): T =>
    canonical(JSON.parse(JSON.stringify(value).replace(pattern, (id) => tokens.get(id)!)))
  const rows = <T extends object>(list: T[], drop: string[]) =>
    norm(
      list.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key)))
      )
    ).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  return {
    instances: rows(
      instances.map((i) => ({ rec: i.id, ...i })),
      ['id', 'createdAt', 'updatedAt', 'lastActivityAt']
    ),
    values: rows(values, ['id', 'createdAt', 'updatedAt']),
    items: rows(items, ['id', 'createdAt', 'updatedAt', 'lastSyncedAt']),
    passes: passes.map((p) => {
      const { counters, manifest } = norm({ counters: p.counters, manifest: p.manifest })
      return { counters, manifest: members(manifest) }
    }),
    count: (kind: Kind) =>
      instances.filter((i) => i.entityDefinitionId === o.defs.get(kind) && !i.archivedAt).length,
  }
}

/** Manifest membership lists are sets: a batched create may capture them in another order. */
function members(manifest: Pass['manifest']) {
  if (!manifest) return manifest
  const sorted = (ids: readonly string[]) => [...ids].sort()
  return {
    ...manifest,
    createdRecordIds: sorted(manifest.createdRecordIds),
    archivedRecordIds: sorted(manifest.archivedRecordIds),
  }
}

/** Objects with sorted keys, so map insertion order does not count. */
function canonical<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((key) => [key, walk((v as Record<string, unknown>)[key])])
      )
    }
    return v
  }
  return walk(value) as T
}

/** Sink the page into two fresh worlds, one run per sink in each list, and diff the snapshots. */
async function compare(
  build: (o: Org) => ConnectorRecord[],
  left: Sink[],
  right: Sink[]
): Promise<{ a: Awaited<ReturnType<typeof snapshot>>; b: Awaited<ReturnType<typeof snapshot>> }> {
  const run = async (sinks: Sink[]) => {
    const w = await world(build)
    const passes: Pass[] = []
    for (const sink of sinks) passes.push(await pass(w, sink))
    return snapshot(w, passes)
  }
  const a = await run(left)
  const b = await run(right)
  expect(b.instances).toEqual(a.instances)
  expect(b.values).toEqual(a.values)
  expect(b.items).toEqual(a.items)
  expect(b.passes).toEqual(a.passes)
  return { a, b }
}

/** Pass-1 invariants of the base page: one instance per upstream record, nothing failed. */
function expectFirstBackfill(s: Awaited<ReturnType<typeof snapshot>>) {
  expect(s.passes[0]!.counters.errorSample).toEqual([])
  expect(s.passes[0]!.counters.failed).toBe(0)
  expect(s.count('order')).toBe(ORDERS)
  expect(s.count('contact')).toBe(CUSTOMERS)
  expect(s.count('line_item')).toBe(ORDERS * 2)
  expect(s.count('fulfillment')).toBe(ORDERS)
  expect(s.count('fulfillment_line')).toBe(ORDERS * 2)
  expect(s.count('tax_line')).toBe(ORDERS * 2)
  expect(s.count('customer_transaction')).toBe(ORDERS)
}

/** Every item was seen by the second run, and it wrote nothing. */
function expectAllSkips(s: Awaited<ReturnType<typeof snapshot>>, records: number) {
  const second = s.passes[1]!.counters
  expect(second.errorSample).toEqual([])
  expect({ created: second.created, updated: second.updated, skipped: second.skipped }).toEqual({
    created: 0,
    updated: 0,
    skipped: records,
  })
  expect(s.items.length).toBeGreaterThan(0)
  for (const item of s.items) expect(item.lastSeenRunId).toBe('RUN1')
}

/** Two orders share one line item external id (and so one fulfillment line target). */
function withSharedLine(o: Org): ConnectorRecord[] {
  const records = page(o, ORDERS, CUSTOMERS)
  const [first, second] = records.map(fieldsOf)
  const shared = first!.line_items[0]!.id
  second!.line_items[0]!.id = shared
  second!.fulfillments[0]!.line_items[0]!.id = shared
  return records
}

/** Order 2's first tax line has a NUL byte in its title, which Postgres refuses to store. */
function withBadRow(o: Org): ConnectorRecord[] {
  const records = page(o, ORDERS, CUSTOMERS)
  fieldsOf(records[2]!).tax_lines[0]!.title = 'State\u0000'
  return records
}

const base = (o: Org) => page(o, ORDERS, CUSTOMERS)

describe('entity sink page equivalence (plan 14b)', () => {
  describe('per-record path (harness self-check: two orgs normalise to the same snapshot)', () => {
    it('(a) first backfill on a fresh org', async () => {
      const { a } = await compare(base, [sinkPerRecord], [sinkPerRecord])
      expectFirstBackfill(a)
    }, 300_000)

    it('(b) the same page again is all skips and stamps every item', async () => {
      const { a } = await compare(
        base,
        [sinkPerRecord, sinkPerRecord],
        [sinkPerRecord, sinkPerRecord]
      )
      expectAllSkips(a, ORDERS * RECORDS_PER_ORDER)
    }, 300_000)

    it('(c) in-page duplicate customers and line ids converge on one instance', async () => {
      const { a } = await compare(withSharedLine, [sinkPerRecord], [sinkPerRecord])
      expect(a.count('contact')).toBe(CUSTOMERS)
      expect(a.count('line_item')).toBe(ORDERS * 2 - 1)
      expect(a.passes[0]!.counters.errorSample).toEqual([])
    }, 300_000)

    it('(d) one bad row: the rest land and it is one errorSample entry', async () => {
      const { a } = await compare(withBadRow, [sinkPerRecord], [sinkPerRecord])
      expect(a.passes[0]!.counters.errorSample).toMatchObject([
        { externalId: '1002-T0', tier: 'rejected' },
      ])
      expect(a.passes[0]!.counters.failed).toBe(1)
      expect(a.passes[0]!.counters.created).toBe(ORDERS * RECORDS_PER_ORDER - CUSTOMERS - 1)
      expect(a.count('tax_line')).toBe(ORDERS * 2 - 1)
    }, 300_000)
  })

  describe(PAGE, () => {
    it.skipIf(!HAS_PAGE_PATH)(
      '(a) first backfill on a fresh org',
      async () => {
        const { b } = await compare(base, [sinkPerRecord], [sinkPage])
        expectFirstBackfill(b)
      },
      300_000
    )

    it.skipIf(!HAS_PAGE_PATH)(
      '(b) the same page again is all skips and stamps every item',
      async () => {
        const { b } = await compare(base, [sinkPerRecord, sinkPerRecord], [sinkPage, sinkPage])
        expectAllSkips(b, ORDERS * RECORDS_PER_ORDER)
      },
      300_000
    )

    it.skipIf(!HAS_PAGE_PATH)(
      '(c) in-page duplicates: the same instance count',
      async () => {
        const { b } = await compare(withSharedLine, [sinkPerRecord], [sinkPage])
        expect(b.count('contact')).toBe(CUSTOMERS)
        expect(b.count('line_item')).toBe(ORDERS * 2 - 1)
      },
      300_000
    )

    it.skipIf(!HAS_PAGE_PATH)(
      '(d) one bad row: the same sample entry and tier',
      async () => {
        const { b } = await compare(withBadRow, [sinkPerRecord], [sinkPage])
        expect(b.passes[0]!.counters.errorSample).toMatchObject([
          { externalId: '1002-T0', tier: 'rejected' },
        ])
        expect(b.count('tax_line')).toBe(ORDERS * 2 - 1)
      },
      300_000
    )
  })
})
