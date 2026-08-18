// packages/lib/src/data-connectors/sink-source-record.test.ts

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../resources'
import type { ConnectorRecord } from './connectors/types'
import type { DecodedMapping } from './service'
import type { ProjectedRecord, SyncCtx } from './sinks/types'

// Capture each projected record the sink would write so we can assert the
// relationship edges that `sinkSourceRecord` stamped onto them. `vi.hoisted` so the
// fn exists before the hoisted `vi.mock` factory references it.
const { upsertRecord } = vi.hoisted(() => ({
  upsertRecord: vi.fn<(ctx: unknown, m: DecodedMapping, r: ProjectedRecord) => Promise<void>>(),
}))
vi.mock('./sinks/entity-sink', () => ({ entitySink: { upsertRecord } }))
vi.mock('./reconciliation', () => ({ archiveExternalId: vi.fn() }))

// Field cache: the order def carries a connector-provisioned `Line Items` has_many
// field whose REAL id differs from its `appFieldKey` ('lineItems') — the exact shape
// `resolveEdge` must resolve via the late-bound `@app:` ref (it matches by appFieldKey,
// never the provisioned id).
const fieldsByDef: Record<string, ResourceField[]> = {}
vi.mock('../cache', () => ({
  getCachedResourceFields: (_org: string, defId: string) =>
    Promise.resolve(fieldsByDef[defId] ?? []),
}))

import { ConnectorRateLimitError } from './connectors/types'
import { newRecordFailureTally, SystemicSyncFailureError } from './record-failure-tally'
import { newRunCounters } from './service'
import { sinkSourceRecord } from './sink-source-record'

function mapping(over: Partial<DecodedMapping> & { id?: string }): DecodedMapping {
  const { id = 'm1', ...rest } = over
  return {
    row: { id } as DecodedMapping['row'],
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: 'def1',
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: [],
    ...rest,
  }
}

function relField(over: Omit<Partial<ResourceField>, 'id'> & { id: string }): ResourceField {
  return {
    key: over.id,
    label: over.id,
    type: 'object',
    fieldType: 'RELATIONSHIP',
    capabilities: {} as ResourceField['capabilities'],
    ...over,
    id: toFieldId(over.id),
  } as ResourceField
}

/** A fresh ctx per test — `counters` and `failureTally` are MUTATED by the fault boundary. */
function makeCtx(): SyncCtx {
  return {
    orgId: 'org1',
    connector: { id: 'conn1' },
    counters: newRunCounters(),
    failureTally: newRecordFailureTally(),
  } as unknown as SyncCtx
}

const ctx = makeCtx()

describe('sinkSourceRecord — relationship edge resolution', () => {
  beforeEach(() => {
    upsertRecord.mockReset().mockResolvedValue(undefined)
    for (const k of Object.keys(fieldsByDef)) delete fieldsByDef[k]
  })

  it('resolves a has_many edge by appFieldKey and side-flips the inverse onto each child', async () => {
    // Order def: `Line Items` has_many, real id `cf_lineItems`, appFieldKey `lineItems`,
    // inverse `Order` (id `cf_order`) on the line-item def.
    fieldsByDef.orderDef = [
      relField({
        id: 'cf_lineItems',
        resourceFieldId: toResourceFieldId('orderDef', 'cf_lineItems'),
        appFieldKey: 'lineItems',
        relationship: {
          relationshipType: 'has_many',
          inverseResourceFieldId: 'lineDef:cf_order',
        } as ResourceField['relationship'],
      }),
    ]

    const order = mapping({ id: 'orderMap', rootPath: '', entityDefinitionId: 'orderDef' })
    const lineItems = mapping({
      id: 'lineMap',
      rootPath: 'line_items[]',
      entityDefinitionId: 'lineDef',
      parentMappingId: 'orderMap',
      // The seeded key is the late-bound `@app:` envelope — its `appFieldKey` segment
      // ('lineItems') matches the provisioned field's appFieldKey, NOT its id. The
      // leading slug is cosmetic; resolveEdge resolves on the parent def.
      relationshipFieldKey: 'shopify_orders:@app:shopify:lineItems',
    })

    const source: ConnectorRecord = {
      streamKey: 'order',
      externalId: 'o1',
      displayName: 'Order',
      fields: { id: 'o1', line_items: [{ sku: 'A' }, { sku: 'B' }] },
    }

    await sinkSourceRecord(ctx, [order, lineItems], source)

    // Two line items written, each carrying the inverse `Order` (cf_order) belongs_to
    // edge pointing back at the order — NOT a bogus `lineItems` edge on the order.
    const writes = upsertRecord.mock.calls.map(([, , r]) => r)
    const children = writes.filter((r) => r.externalId.startsWith('o1:'))
    expect(children).toHaveLength(2)
    for (const child of children) {
      expect(child.pendingRelations).toEqual([
        { fieldKey: 'cf_order', targetDef: 'orderDef', targetExternalId: 'o1' },
      ])
    }
    // The order instance itself gets NO relationship edge stamped (the has_many side
    // flips to the children; the inverse collection syncs from the child writes).
    const parent = writes.find((r) => r.externalId === 'o1')
    expect(parent?.pendingRelations).toEqual([])
  })
})

// ── Per-record fault isolation ───────────────────────────────────────────────────
// Before this boundary existed, ~11 unprotected DB calls per record sat outside the
// sink's one narrow try/catch, so ANY of them escalated one bad row into a failed RUN
// (the slice loop rethrows whatever it doesn't recognise). One malformed phone number
// in a 4222-contact address book ended the whole import that way.

describe('sinkSourceRecord — per-record fault isolation', () => {
  const source: ConnectorRecord = {
    streamKey: 'contact',
    externalId: 'c1',
    displayName: 'C',
    fields: { id: 'c1' },
  }
  const m = mapping({ id: 'm1' })

  beforeEach(() => {
    upsertRecord.mockReset().mockResolvedValue(undefined)
  })

  it('counts a throwing record and does NOT rethrow', async () => {
    const c = makeCtx()
    upsertRecord.mockRejectedValueOnce(new Error('lookup exploded'))

    await expect(sinkSourceRecord(c, [m], source)).resolves.toBeUndefined()

    expect(c.counters.failed).toBe(1)
    expect(c.counters.errorSample).toEqual([
      { externalId: 'c1', error: 'lookup exploded', tier: 'rejected' },
    ])
  })

  it('keeps going — a later good record still writes', async () => {
    const c = makeCtx()
    upsertRecord.mockRejectedValueOnce(new Error('bad row'))
    await sinkSourceRecord(c, [m], source)
    await sinkSourceRecord(c, [m], { ...source, externalId: 'c2' })

    expect(c.counters.failed).toBe(1)
    // The second record reached the sink rather than being skipped by a dead run.
    expect(upsertRecord).toHaveBeenCalledTimes(2)
  })

  it('caps errorSample at 50 while still counting every failure', async () => {
    const c = makeCtx()
    // Fail 1 in 3 — enough failures to overrun the 50-entry sample, but a clear
    // MINORITY, so this exercises the cap and not the circuit breaker.
    for (let i = 0; i < 180; i++) {
      upsertRecord.mockReset()
      if (i % 3 === 0) upsertRecord.mockRejectedValue(new Error('boom'))
      else upsertRecord.mockResolvedValue(undefined)
      await sinkSourceRecord(c, [m], { ...source, externalId: `c${i}` })
    }
    expect(c.counters.failed).toBe(60)
    expect(c.counters.errorSample).toHaveLength(50)
  })

  it('RETHROWS a throttle — that is the slice loop’s to handle, not a bad record', async () => {
    const c = makeCtx()
    upsertRecord.mockRejectedValueOnce(new ConnectorRateLimitError('429'))

    await expect(sinkSourceRecord(c, [m], source)).rejects.toBeInstanceOf(ConnectorRateLimitError)
    expect(c.counters.failed).toBe(0)
  })

  it('RETHROWS on a graceful abort instead of swallowing it as a record failure', async () => {
    const controller = new AbortController()
    const c = { ...makeCtx(), signal: controller.signal } as SyncCtx
    controller.abort()
    upsertRecord.mockRejectedValueOnce(new Error('cancelled mid-write'))

    await expect(sinkSourceRecord(c, [m], source)).rejects.toThrow('cancelled mid-write')
    expect(c.counters.failed).toBe(0)
  })

  it('trips the breaker on a systemic failure and fails the RUN', async () => {
    const c = makeCtx()
    upsertRecord.mockRejectedValue(new Error('field not found on contact'))

    let thrown: unknown
    for (let i = 0; i < 40; i++) {
      try {
        await sinkSourceRecord(c, [m], { ...source, externalId: `c${i}` })
      } catch (e) {
        thrown = e
        break
      }
    }
    expect(thrown).toBeInstanceOf(SystemicSyncFailureError)
    expect((thrown as Error).message).toContain('field not found on contact')
    // Stopped early rather than burning every record in the crawl.
    expect(c.counters.failed).toBeLessThan(40)
  })
})
