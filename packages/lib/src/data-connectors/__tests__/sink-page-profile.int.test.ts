// packages/lib/src/data-connectors/__tests__/sink-page-profile.int.test.ts
// Before/after harness for the connector sink: statements and ms per record kind for one
// Shopify-shaped page (see plans/mrp/14-batched-connector-sink.md §3). Env: SINK_PROFILE_RECORDS.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { and, eq, inArray } from 'drizzle-orm'
import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../cache'
import { loadManifestCollector } from '../../record-rules/sync-manifest-collector'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { WriteSession } from '../../resources/crud/write-origin'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../seed/entity-seeder/link-display-fields'
import { linkNameFields } from '../../seed/entity-seeder/link-name-fields'
import { linkRelationships } from '../../seed/entity-seeder/link-relationships'
import type { ConnectorRecord } from '../connectors/types'
import { newRecordFailureTally } from '../record-failure-tally'
import {
  type DataConnectorRow,
  type DecodedMapping,
  decodeMapping,
  newRunCounters,
  openRun,
} from '../service'
import { sinkSourceRecord } from '../sink-source-record'
import { entitySink } from '../sinks/entity-sink'
import type { SyncCtx } from '../sinks/types'
import type { FieldMapping } from '../types'

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

const db = () => getTestDb() as unknown as Database
const RECORDS = Number(process.env.SINK_PROFILE_RECORDS ?? 20)
const SOURCE = '(source: edges + child sets)'

type Kind =
  | 'order'
  | 'contact'
  | 'line_item'
  | 'fulfillment'
  | 'fulfillment_line'
  | 'tax_line'
  | 'customer_transaction'
  | 'part'

interface Org {
  orgId: string
  userId: string
  defs: Map<Kind, string>
  /** `kind` → systemAttribute → the seeded CustomField row. */
  fields: Map<Kind, Map<string, typeof schema.CustomField.$inferSelect>>
  /** `kind` → the app-style identity field (`appSlug: 'shopify'`, `isIdentity`). */
  identity: Map<Kind, string>
}

/** An org with the registry's own defs and fields, as the entity seeder writes them. */
async function seedOrg(): Promise<Org> {
  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Sync Operator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))
  const defMap = await createEntityDefinitions(db(), org.id)
  const fieldMap = await createAllFields(db(), org.id, defMap)
  await linkRelationships(db(), defMap, fieldMap)
  await linkNameFields(db(), fieldMap)
  await linkDisplayFields(db(), defMap, fieldMap)

  const kinds: Kind[] = [
    'order',
    'contact',
    'line_item',
    'fulfillment',
    'fulfillment_line',
    'tax_line',
    'customer_transaction',
    'part',
  ]
  const defs = new Map<Kind, string>()
  for (const kind of kinds) {
    const def = defMap.get(kind)
    if (!def) throw new Error(`fixture: no ${kind} definition was seeded`)
    defs.set(kind, def.id)
  }
  const rows = await db()
    .select()
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, org.id),
        inArray(schema.CustomField.entityDefinitionId, [...defs.values()])
      )
    )
  const fields = new Map<Kind, Map<string, typeof schema.CustomField.$inferSelect>>()
  const identity = new Map<Kind, string>()
  for (const kind of kinds) {
    const own = rows.filter((r) => r.entityDefinitionId === defs.get(kind))
    fields.set(
      kind,
      new Map(own.flatMap((r) => (r.systemAttribute ? [[r.systemAttribute, r]] : [])))
    )
    // The Shopify app provisions an identity field per def; this is its shape without the install.
    const [idField] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: defs.get(kind)!,
        modelType: own[0]!.modelType,
        name: 'Shopify ID',
        type: 'TEXT',
        options: {},
        sortOrder: 'zz',
        isCustom: true,
        isIdentity: true,
        appSlug: 'shopify',
        appFieldKey: 'id',
        updatedAt: new Date(),
      })
      .returning()
    identity.set(kind, idField!.id)
  }
  await getOrgCache().invalidateAndRecompute(org.id, [
    'customFields',
    'resources',
    'entityDefs',
  ] as never)
  return { orgId: org.id, userId: user.id, defs, fields, identity }
}

/** `defId:fieldId` for a seeded system attribute. */
function ref(o: Org, kind: Kind, attr: string): ResourceFieldId {
  const field = o.fields.get(kind)?.get(attr)
  if (!field) throw new Error(`fixture: ${kind} has no ${attr}`)
  return toResourceFieldId(o.defs.get(kind)!, field.id)
}

/** The first seeded option value of a select, so the page writes a value the field accepts. */
function firstOption(o: Org, kind: Kind, attr: string): string {
  const opts = (o.fields.get(kind)?.get(attr)?.options as { options?: { value: string }[] })
    ?.options
  const value = opts?.[0]?.value
  if (!value) throw new Error(`fixture: ${kind}.${attr} has no options`)
  return value
}

/** One plain binding: `{path}` → the field. */
function bind(target: ResourceFieldId, path: string, extra: Partial<FieldMapping> = {}) {
  return {
    id: `fm_${path}`,
    targetFieldRef: target,
    expression: `{${path}}`,
    sourceFields: { [path]: path },
    ...extra,
  } satisfies FieldMapping
}

/** The `externalId`-role binding onto the def's identity field. */
function idBind(o: Org, kind: Kind, path = 'id'): FieldMapping {
  return bind(toResourceFieldId(o.defs.get(kind)!, o.identity.get(kind)!), path, {
    id: `fm_ext_${path}`,
    identityRole: { kind: 'externalId' },
  })
}

interface Connector {
  row: DataConnectorRow
  mappings: DecodedMapping[]
  labelByMapping: Map<string, string>
}

/** One app connector, one `order` stream, the Shopify order mapping tree (contributing). */
async function seedConnector(o: Org): Promise<Connector> {
  const [row] = await db()
    .insert(schema.DataConnector)
    .values({
      organizationId: o.orgId,
      type: 'app:shopify',
      definitionKind: 'app',
      name: 'Shopify',
      createdById: o.userId,
    })
    .returning()
  const [stream] = await db()
    .insert(schema.DataConnectorStream)
    .values({ dataConnectorId: row!.id, organizationId: o.orgId, streamKey: 'order' })
    .returning()

  const mappings: DecodedMapping[] = []
  const labelByMapping = new Map<string, string>()
  const add = async (
    kind: Kind,
    rootPath: string,
    parent: DecodedMapping | null,
    relationship: ResourceFieldId | null,
    fieldMappings: FieldMapping[],
    linkMode: 'upsert' | 'reference' = 'upsert'
  ): Promise<DecodedMapping> => {
    const [m] = await db()
      .insert(schema.DataConnectorMapping)
      .values({
        dataConnectorStreamId: stream!.id,
        organizationId: o.orgId,
        targetMode: 'contributing',
        linkMode,
        entityDefinitionId: o.defs.get(kind)!,
        rootPath,
        parentMappingId: parent?.row.id ?? null,
        relationshipFieldKey: relationship,
        orphanBehavior: rootPath.includes('[]') ? 'archive' : 'ignore',
        fieldMappings,
      })
      .returning()
    const decoded = decodeMapping(m!)
    mappings.push(decoded)
    labelByMapping.set(m!.id, rootPath ? `${kind} (${rootPath})` : kind)
    return decoded
  }

  const order = await add('order', '', null, null, [
    idBind(o, 'order'),
    bind(ref(o, 'order', 'order_placed_at'), 'created_at'),
    bind(ref(o, 'order', 'order_financial_status'), 'financial_status'),
    bind(ref(o, 'order', 'order_currency'), 'currency'),
    bind(ref(o, 'order', 'order_note'), 'note'),
    bind(ref(o, 'order', 'order_shipping_total'), 'shipping_total'),
    bind(ref(o, 'order', 'order_discount_value'), 'discount'),
  ])
  await add('contact', 'customer', order, ref(o, 'order', 'order_contact'), [
    idBind(o, 'contact'),
    bind(ref(o, 'contact', 'first_name'), 'first_name'),
    bind(ref(o, 'contact', 'last_name'), 'last_name'),
    bind(ref(o, 'contact', 'primary_email'), 'email', {
      identityRole: { kind: 'match', normalize: 'email' },
    }),
  ])
  const line = await add('line_item', 'line_items[]', order, ref(o, 'order', 'order_line_items'), [
    idBind(o, 'line_item'),
    bind(ref(o, 'line_item', 'line_item_name'), 'title'),
    bind(ref(o, 'line_item', 'line_item_qty'), 'quantity'),
    bind(ref(o, 'line_item', 'line_item_unit_price'), 'price'),
    bind(ref(o, 'line_item', 'line_item_taxable'), 'taxable'),
    bind(ref(o, 'line_item', 'line_item_discount'), 'discount'),
    bind(ref(o, 'line_item', 'line_item_sort_order'), 'position'),
  ])
  await add(
    'part',
    'variant_id',
    line,
    ref(o, 'line_item', 'line_item_part'),
    [{ id: 'fm_variant', targetFieldRef: null, expression: '{source}', sourceFields: {} }],
    'reference'
  )
  const fulfillment = await add(
    'fulfillment',
    'fulfillments[]',
    order,
    ref(o, 'order', 'order_fulfillments'),
    [
      idBind(o, 'fulfillment'),
      bind(ref(o, 'fulfillment', 'fulfillment_name'), 'name'),
      bind(ref(o, 'fulfillment', 'fulfillment_status'), 'status'),
      bind(ref(o, 'fulfillment', 'fulfillment_shipped_at'), 'created_at'),
      bind(ref(o, 'fulfillment', 'fulfillment_tracking_number'), 'tracking_number'),
      bind(ref(o, 'fulfillment', 'fulfillment_tracking_company'), 'tracking_company'),
    ]
  )
  const fline = await add(
    'fulfillment_line',
    'line_items[]',
    fulfillment,
    ref(o, 'fulfillment', 'fulfillment_lines'),
    [
      idBind(o, 'fulfillment_line', 'line_key'),
      bind(ref(o, 'fulfillment_line', 'fulfillment_line_quantity'), 'quantity'),
    ]
  )
  await add(
    'line_item',
    'id',
    fline,
    ref(o, 'fulfillment_line', 'fulfillment_line_line_item'),
    [{ id: 'fm_line', targetFieldRef: null, expression: '{source}', sourceFields: {} }],
    'reference'
  )
  await add('tax_line', 'tax_lines[]', order, ref(o, 'order', 'order_tax_lines'), [
    idBind(o, 'tax_line', 'key'),
    bind(ref(o, 'tax_line', 'tax_line_title'), 'title'),
    bind(ref(o, 'tax_line', 'tax_line_rate'), 'rate'),
    bind(ref(o, 'tax_line', 'tax_line_price'), 'price'),
    bind(ref(o, 'tax_line', 'tax_line_channel_liable'), 'channel_liable'),
  ])
  const tx = (attr: string) => ref(o, 'customer_transaction', `customer_transaction_${attr}`)
  await add(
    'customer_transaction',
    'paymentTransactions[]',
    order,
    ref(o, 'order', 'order_payment_transactions'),
    [
      idBind(o, 'customer_transaction'),
      bind(tx('external_id'), 'id'),
      bind(tx('provider_key'), 'provider'),
      bind(tx('kind'), 'kind'),
      bind(tx('status'), 'status'),
      bind(tx('amount'), 'amount'),
      bind(tx('currency'), 'currency'),
      bind(tx('gateway'), 'gateway'),
      bind(tx('processed_at'), 'processed_at'),
      bind(tx('order_external_id'), 'order_id'),
    ]
  )
  return { row: row!, mappings, labelByMapping }
}

/** Order `i` of the page; customers repeat every `RECORDS / 2` orders. CURRENCY is minor units. */
function shopifyOrder(o: Org, i: number, prefix: string): ConnectorRecord {
  const oid = `${prefix}${1000 + i}`
  const customers = Math.max(1, Math.ceil(RECORDS / 2))
  const cid = `${prefix}c${i % customers}`
  const lines = [0, 1].map((n) => ({
    id: `${oid}-L${n}`,
    title: `Widget ${n}`,
    quantity: n + 1,
    price: 1950 + n * 100,
    taxable: true,
    discount: 0,
    position: n,
    variant_id: `v${n}`,
  }))
  return {
    streamKey: 'order',
    externalId: oid,
    displayName: `#${oid}`,
    fields: {
      id: oid,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T12:00:00Z',
      financial_status: firstOption(o, 'order', 'order_financial_status'),
      currency: 'USD',
      note: `order ${i}`,
      shipping_total: 500,
      discount: 0,
      customer: {
        id: cid,
        first_name: 'Customer',
        last_name: cid,
        email: `${cid}@example.com`,
      },
      line_items: lines,
      fulfillments: [
        {
          id: `${oid}-F0`,
          name: `#${oid}.1`,
          status: firstOption(o, 'fulfillment', 'fulfillment_status'),
          created_at: '2026-09-02T10:00:00Z',
          tracking_number: `1Z${oid}`,
          tracking_company: 'UPS',
          line_items: lines.map((l) => ({
            id: l.id,
            line_key: `${oid}-F0-${l.id}`,
            quantity: l.quantity,
          })),
        },
      ],
      tax_lines: [
        { key: `${oid}-T0`, title: 'State', rate: 0.06, price: 240, channel_liable: false },
        { key: `${oid}-T1`, title: 'County', rate: 0.01, price: 40, channel_liable: false },
      ],
      paymentTransactions: [
        {
          id: `${oid}-P0`,
          provider: 'shopify',
          kind: 'sale',
          status: 'success',
          amount: '45.80',
          currency: 'USD',
          gateway: 'shopify_payments',
          processed_at: '2026-09-01T10:00:05Z',
          order_id: oid,
        },
      ],
    },
  }
}

/** A sink context shaped like `connector-sync-source`'s `buildCtx`, on a real run. */
async function buildCtx(o: Org, c: Connector): Promise<SyncCtx> {
  const run = await openRun(db(), {
    dataConnectorId: c.row.id,
    organizationId: o.orgId,
    trigger: 'manual',
    mode: 'snapshot',
    phase: 'backfill',
  })
  const manifest = await loadManifestCollector(o.orgId)
  const session: WriteSession = {
    origin: { kind: 'sync', source: 'connector', ref: run.id, collector: manifest },
    depth: 0,
  }
  const crud = new UnifiedCrudHandler(o.orgId, o.userId, db(), undefined, { session })
  const ownedCrud = new UnifiedCrudHandler(o.orgId, o.userId, db(), undefined, {
    bypassFieldGuards: new Set<never>(),
    session,
  })
  for (const defId of new Set(c.mappings.map((m) => m.entityDefinitionId))) {
    await crud.warmCache(defId)
    await ownedCrud.warmCache(defId)
  }
  return {
    db: db(),
    orgId: o.orgId,
    connector: c.row,
    runId: run.id,
    userId: o.userId,
    crud,
    ownedCrud,
    counters: newRunCounters(),
    failureTally: newRecordFailureTally(),
    manifest,
    touchedDefs: new Set<string>(),
    sweep: false,
    connectionMeta: null,
  }
}

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
      await sinkSourceRecord(warm, c.mappings, shopifyOrder(o, 0, 'warm'), 'updated_at')
      expect(warm.counters.errorSample).toEqual([])
      profiler.reset()

      const page = Array.from({ length: RECORDS }, (_, i) => shopifyOrder(o, i, ''))
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
