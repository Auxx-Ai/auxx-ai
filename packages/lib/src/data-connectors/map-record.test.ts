// packages/lib/src/data-connectors/map-record.test.ts

import { describe, expect, it } from 'vitest'
import type { ConnectorRecord } from './connectors/types'
import { mapRecord } from './map-record'
import type { DecodedMapping } from './service'

/** Build a DecodedMapping with sensible defaults; override what the test cares about. */
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
    identityStrategy: { kind: 'connectorExternalId' },
    fieldMappings: {},
    mergeStrategies: {},
    ...rest,
  }
}

function source(fields: Record<string, unknown>): ConnectorRecord {
  return { streamKey: 'order', externalId: 'o1', displayName: 'Order', fields }
}

describe('mapRecord', () => {
  it('resolves a root mapping field path relative to the whole record', () => {
    const m = mapping({
      fieldMappings: {
        total: { expression: '{total_price}', sourceFields: { total_price: 'total_price' } },
      },
    })

    const writes = mapRecord([m], source({ total_price: '49.99', customer: { email: 'a@b.com' } }))

    expect(writes).toHaveLength(1)
    expect(writes[0]?.projected?.fields).toEqual({ total: '49.99' })
    expect(writes[0]?.projected?.externalId).toBe('o1')
    // connectorExternalId contributes no identity candidates.
    expect(writes[0]?.projected?.identityCandidates).toEqual([])
  })

  it('fans out an array mapping, resolving field paths relative to each element', () => {
    const m = mapping({
      id: 'li',
      rootPath: 'line_items[]',
      fieldMappings: { sku: { expression: '{sku}', sourceFields: { sku: 'sku' } } },
    })

    const writes = mapRecord(
      [m],
      source({
        line_items: [
          { sku: 'A', price: 1 },
          { sku: 'B', price: 2 },
        ],
      })
    )

    expect(writes).toHaveLength(2)
    expect(writes.map((w) => w.projected?.fields.sku)).toEqual(['A', 'B'])
    // No natural id on the element → synthetic `${parentExternalId}:${index}`.
    expect(writes.map((w) => w.projected?.externalId)).toEqual(['o1:0', 'o1:1'])
  })

  it('resolves matchField identity from the subtree via a relative connectorFieldKey', () => {
    const m = mapping({
      id: 'cust',
      rootPath: 'customer',
      targetMode: 'contributing',
      identityStrategy: {
        kind: 'matchField',
        connectorFieldKey: 'email', // relative to rootPath 'customer'
        targetFieldId: 'contact_email',
        normalize: 'email',
      },
      fieldMappings: {
        contact_email: { expression: '{email}', sourceFields: { email: 'email' } },
      },
    })

    const writes = mapRecord([m], source({ customer: { email: 'a@b.com', name: 'Acme' } }))

    expect(writes).toHaveLength(1)
    expect(writes[0]?.projected?.identityCandidates).toEqual([
      { targetFieldId: 'contact_email', value: 'a@b.com', normalize: 'email' },
    ])
  })

  it('orders the root mapping first and wires child parentRelations', () => {
    const root = mapping({ id: 'root', rootPath: '' })
    const child = mapping({
      id: 'child',
      rootPath: 'customer',
      parentMappingId: 'root',
      relationshipFieldKey: 'customer',
    })

    const writes = mapRecord([child, root], source({ customer: { id: 'c1' } }))

    expect(writes[0]?.mapping.row.id).toBe('root')
    const childWrite = writes.find((w) => w.mapping.row.id === 'child')
    expect(childWrite?.parentRelation).toMatchObject({
      parentMappingId: 'root',
      fieldKey: 'customer',
      targetExternalId: 'c1',
    })
  })
})
