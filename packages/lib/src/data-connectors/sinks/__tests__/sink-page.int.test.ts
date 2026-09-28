// packages/lib/src/data-connectors/sinks/__tests__/sink-page.int.test.ts
// The page's bind map and batched item writes (plans/mrp/14 §4), and `sinkSourcePage` against the
// per-record lane with child sets and a tombstone in the page.

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import {
  buildCtx,
  type Connector,
  db,
  type Org,
  seedConnector,
  seedOrg,
  shopifyOrder,
} from '../../__tests__/support/shopify-page'
import type { ConnectorRecord } from '../../connectors/types'
import {
  type DataConnectorItemRow,
  setItemPendingRelations,
  touchItem,
  type UpsertItemInput,
  upsertItem,
} from '../../service'
import { sinkSourcePage, sinkSourceRecord } from '../../sink-source-record'
import { createSinkPage } from '../sink-page'
import type { SyncCtx } from '../types'

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

const I = schema.DataConnectorItem

async function items(c: Connector): Promise<DataConnectorItemRow[]> {
  return db().select().from(I).where(eq(I.dataConnectorId, c.row.id))
}

async function item(c: Connector, externalId: string): Promise<DataConnectorItemRow> {
  const [row] = await db()
    .select()
    .from(I)
    .where(and(eq(I.dataConnectorId, c.row.id), eq(I.externalId, externalId)))
  return row!
}

/** The columns an item write decides, for comparing two items of one world. */
function written(row: DataConnectorItemRow) {
  const { id, externalId, entityInstanceId, parentExternalId, createdAt, lastSyncedAt, ...rest } =
    row
  return rest
}

/** The columns a touch and a pending-relations write decide. */
function touched(row: DataConnectorItemRow) {
  const { lastSeenRunId, archivedAt, removedUpstreamAt, upstreamUpdatedAt, pendingRelations } = row
  return { lastSeenRunId, archivedAt, removedUpstreamAt, upstreamUpdatedAt, pendingRelations }
}

/** A world after one per-record backfill of `orders` orders. */
async function backfilled(orders = 4): Promise<{ o: Org; c: Connector }> {
  const o = await seedOrg()
  const c = await seedConnector(o)
  const ctx = await buildCtx(o, c)
  for (let i = 0; i < orders; i++) {
    await sinkSourceRecord(ctx, c.mappings, shopifyOrder(o, i, '', 2), 'updated_at')
  }
  expect(ctx.counters.errorSample).toEqual([])
  return { o, c }
}

function inputFor(row: DataConnectorItemRow, ctx: SyncCtx): UpsertItemInput {
  return {
    dataConnectorId: row.dataConnectorId,
    organizationId: row.organizationId,
    mappingId: row.mappingId,
    externalId: row.externalId,
    entityDefinitionId: row.entityDefinitionId,
    entityInstanceId: row.entityInstanceId!,
    contentHash: 'h2',
    managedFields: ['a', 'b'],
    pendingRelations: [{ fieldKey: 'f', targetDef: 'd', targetExternalId: 'x' }],
    upstreamUpdatedAt: new Date('2026-09-03T10:00:00.123Z'),
    lastSeenRunId: ctx.runId,
    mintedInstance: false,
  }
}

describe('sink page binds (plan 14b)', () => {
  it('a deferred same-binding upsert writes what upsertItem writes', async () => {
    const { o, c } = await backfilled()
    const ctx = await buildCtx(o, c)
    const stale = {
      archivedAt: new Date(),
      removedUpstreamAt: new Date(),
      error: 'x',
      pendingRelations: null,
    }
    await db().update(I).set(stale).where(eq(I.externalId, '1000-L0'))
    await db().update(I).set(stale).where(eq(I.externalId, '1001-L0'))
    const [a, b] = [await item(c, '1000-L0'), await item(c, '1001-L0')]

    await upsertItem(ctx.db, inputFor(a, ctx))
    const page = createSinkPage(ctx)
    await page.loadItems([
      { mappingId: b.mappingId, defId: b.entityDefinitionId, externalId: b.externalId },
    ])
    await page.upsertItem(ctx.db, inputFor(b, ctx))
    // Deferred: nothing reaches the row until the page flushes.
    expect((await item(c, b.externalId)).contentHash).toBe(b.contentHash)
    await page.flush()

    expect(written(await item(c, b.externalId))).toEqual(written(await item(c, a.externalId)))
  }, 120_000)

  it('batched touches and pending relations write what touchItem and setItemPendingRelations write', async () => {
    const { o, c } = await backfilled()
    const ctx = await buildCtx(o, c)
    await db().update(I).set({ archivedAt: new Date() }).where(eq(I.externalId, '1000-T0'))
    await db().update(I).set({ archivedAt: new Date() }).where(eq(I.externalId, '1001-T0'))
    const [a, b] = [await item(c, '1000-T0'), await item(c, '1001-T0')]
    const upstream = new Date('2026-09-05T10:00:00.456Z')
    const pending = [{ fieldKey: 'f', targetDef: 'd', targetExternalId: 'y' }]

    await touchItem(ctx.db, a.id, ctx.runId, upstream)
    await setItemPendingRelations(ctx.db, a.id, pending)
    const page = createSinkPage(ctx)
    await page.loadItems([
      { mappingId: b.mappingId, defId: b.entityDefinitionId, externalId: b.externalId },
    ])
    await page.touchItem(ctx.db, b.id, ctx.runId, upstream)
    await page.setItemPendingRelations(ctx.db, b.id, pending)
    await page.flush()

    expect(touched(await item(c, b.externalId))).toEqual(touched(await item(c, a.externalId)))
  }, 120_000)

  it('an in-page duplicate key binds once and later writes land on that item', async () => {
    const { o, c } = await backfilled(1)
    const ctx = await buildCtx(o, c)
    const order = await item(c, '1000')
    const page = createSinkPage(ctx)
    const key = { mappingId: order.mappingId, defId: order.entityDefinitionId, externalId: 'dup' }
    await page.loadItems([key, key])
    const first = { ...inputFor(order, ctx), externalId: 'dup', contentHash: 'first' }

    await page.upsertItem(ctx.db, first)
    // A new binding is written at once; the second sighting reads it from memory.
    expect((await items(c)).filter((r) => r.externalId === 'dup')).toHaveLength(1)
    const bound = await page.findItem(ctx.db, c.row.id, order.mappingId, 'dup')
    expect(bound?.contentHash).toBe('first')
    const byDef = await page.findItemByDef(ctx.db, c.row.id, order.entityDefinitionId, 'dup')
    expect(byDef?.id).toBe(bound?.id)

    await page.upsertItem(ctx.db, { ...first, contentHash: 'second' })
    await page.flush()
    const rows = (await items(c)).filter((r) => r.externalId === 'dup')
    expect(rows.map((r) => r.contentHash)).toEqual(['second'])
  }, 120_000)

  it('flushForItemReads writes only when a deferred write clears an archive or moves a stamp', async () => {
    const { o, c } = await backfilled(1)
    const ctx = await buildCtx(o, c)
    const [live, archived] = [await item(c, '1000-T0'), await item(c, '1000-T1')]
    await db().update(I).set({ archivedAt: new Date() }).where(eq(I.id, archived.id))
    const page = createSinkPage(ctx)
    await page.loadItems(
      [live, archived].map((r) => ({
        mappingId: r.mappingId,
        defId: r.entityDefinitionId,
        externalId: r.externalId,
      }))
    )

    await page.touchItem(ctx.db, live.id, ctx.runId)
    await page.flushForItemReads()
    expect((await item(c, live.externalId)).lastSeenRunId).not.toBe(ctx.runId)

    await page.touchItem(ctx.db, archived.id, ctx.runId)
    await page.flushForItemReads()
    const [liveRow, archivedRow] = [
      await item(c, live.externalId),
      await item(c, archived.externalId),
    ]
    expect(liveRow.lastSeenRunId).toBe(ctx.runId)
    expect(archivedRow).toMatchObject({ lastSeenRunId: ctx.runId, archivedAt: null })
  }, 120_000)
})

/** Pass 2 drops order 1's second line (its child set retires it) and deletes order 2 mid-page. */
function secondPass(o: Org): ConnectorRecord[] {
  const page = Array.from({ length: 5 }, (_, i) => shopifyOrder(o, i, '', 2))
  const one = page[1]!.fields as {
    line_items: unknown[]
    fulfillments: Array<{ line_items: unknown[] }>
  }
  one.line_items.pop()
  one.fulfillments[0]!.line_items.pop()
  page[2] = { ...page[2]!, deleted: true }
  return page
}

/** Items, instances and cells of a world with its org-specific ids replaced by stable tokens. */
async function snapshot(o: Org, c: Connector, runIds: string[]) {
  const [defs, fields, instances, values, rows] = await Promise.all([
    db()
      .select()
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, o.orgId)),
    db().select().from(schema.CustomField).where(eq(schema.CustomField.organizationId, o.orgId)),
    db()
      .select()
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.organizationId, o.orgId)),
    db().select().from(schema.FieldValue).where(eq(schema.FieldValue.organizationId, o.orgId)),
    items(c),
  ])
  const tokens = new Map<string, string>([
    [o.orgId, 'ORG'],
    [o.userId, 'USER'],
    [c.row.id, 'CONNECTOR'],
  ])
  const slug = new Map(defs.map((d) => [d.id, d.apiSlug]))
  for (const d of defs) tokens.set(d.id, `DEF(${d.apiSlug})`)
  for (const f of fields)
    tokens.set(f.id, `FIELD(${slug.get(f.entityDefinitionId!)}.${f.systemAttribute ?? f.name})`)
  for (const [id, label] of c.labelByMapping) tokens.set(id, `MAPPING(${label})`)
  runIds.forEach((id, n) => tokens.set(id, `RUN${n}`))
  for (const i of instances) {
    const bound = rows.filter((r) => r.entityInstanceId === i.id).map((r) => r.externalId)
    tokens.set(i.id, `REC(${[...new Set(bound)].sort()})`)
  }
  // Hashes cover org-specific field ids; compare which items share one, not the value.
  const hashes = new Map<string, string>()
  const sorted = [...rows].sort((a, b) =>
    `${c.labelByMapping.get(a.mappingId)}${a.externalId}`.localeCompare(
      `${c.labelByMapping.get(b.mappingId)}${b.externalId}`
    )
  )
  for (const r of sorted)
    if (r.contentHash && !hashes.has(r.contentHash)) hashes.set(r.contentHash, `HASH${hashes.size}`)
  for (const [hash, token] of hashes) tokens.set(hash, token)
  for (const r of rows) tokens.set(r.id, `ITEM(${r.externalId})`)

  const pattern = new RegExp([...tokens.keys()].sort((a, b) => b.length - a.length).join('|'), 'g')
  const norm = <T extends object>(list: T[], drop: string[]) =>
    list
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(row)
              .filter(([k]) => !drop.includes(k))
              // Write times differ between worlds; whether one is set does not.
              .map(([k, v]) => [k, k.endsWith('At') && k !== 'upstreamUpdatedAt' && v ? 'SET' : v])
              .sort(([a], [b]) => a.localeCompare(b))
          )
        ).replace(pattern, (id) => tokens.get(id)!)
      )
      .sort()
  return {
    items: norm(rows, ['id', 'createdAt', 'lastSyncedAt']),
    instances: norm(instances, ['id', 'createdAt', 'updatedAt', 'lastActivityAt']),
    values: norm(values, ['id', 'createdAt', 'updatedAt']),
  }
}

async function run(lane: 'record' | 'page') {
  const o = await seedOrg()
  const c = await seedConnector(o)
  const runIds: string[] = []
  const counters: unknown[] = []
  const pages = [Array.from({ length: 5 }, (_, i) => shopifyOrder(o, i, '', 2)), secondPass(o)]
  for (const page of pages) {
    const ctx = await buildCtx(o, c)
    if (lane === 'page') await sinkSourcePage(ctx, c.mappings, page, 'updated_at')
    else for (const source of page) await sinkSourceRecord(ctx, c.mappings, source, 'updated_at')
    runIds.push(ctx.runId)
    const { errorSample, byMapping, ...totals } = ctx.counters
    counters.push({ ...totals, errorSample, byMapping: Object.values(byMapping) })
  }
  return { counters, ...(await snapshot(o, c, runIds)) }
}

describe('sinkSourcePage (plan 14b)', () => {
  it('stores and counts what the per-record lane does, across child sets and a tombstone', async () => {
    const perRecord = await run('record')
    const page = await run('page')
    expect(page.counters).toEqual(perRecord.counters)
    expect(page.items).toEqual(perRecord.items)
    expect(page.instances).toEqual(perRecord.instances)
    expect(page.values).toEqual(perRecord.values)
    // The second pass really retired something and deleted something.
    expect(page.items.some((r) => r.includes('"archivedAt":"SET"'))).toBe(true)
  }, 300_000)
})
