// packages/lib/src/data-connectors/sink-source-record.test.ts

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

function relField(over: Partial<ResourceField> & { id: string }): ResourceField {
  return {
    key: over.id,
    label: over.id,
    type: 'object',
    fieldType: 'RELATIONSHIP',
    capabilities: {} as ResourceField['capabilities'],
    ...over,
  } as ResourceField
}

const ctx = { orgId: 'org1', connector: { id: 'conn1' } } as unknown as SyncCtx

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
        resourceFieldId: 'orderDef:cf_lineItems',
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
