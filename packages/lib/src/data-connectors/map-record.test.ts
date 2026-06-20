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
    fieldMappings: [],
    ...rest,
  }
}

function source(fields: unknown): ConnectorRecord {
  return { streamKey: 'order', externalId: 'o1', displayName: 'Order', fields }
}

/** A raw payload with no connector-provided id hint (the generic-rest case). */
function rawPayload(fields: unknown): ConnectorRecord {
  return { streamKey: 'order', fields }
}

describe('mapRecord', () => {
  it('resolves a root mapping field path relative to the whole record', () => {
    const m = mapping({
      fieldMappings: [
        {
          id: 'e1',
          targetFieldRef: 'def1:total',
          expression: '{total_price}',
          sourceFields: { total_price: 'total_price' },
        },
      ],
    })

    const writes = mapRecord([m], source({ total_price: '49.99', customer: { email: 'a@b.com' } }))

    expect(writes).toHaveLength(1)
    expect(writes[0]?.projected?.fields).toEqual({ 'def1:total': '49.99' })
    expect(writes[0]?.projected?.externalId).toBe('o1')
    // No field flagged `match` → no identity candidates (external-id only).
    expect(writes[0]?.projected?.identityCandidates).toEqual([])
  })

  it('fans out an array mapping, resolving field paths relative to each element', () => {
    const m = mapping({
      id: 'li',
      rootPath: 'line_items[]',
      fieldMappings: [
        { id: 'e1', targetFieldRef: 'def1:sku', expression: '{sku}', sourceFields: { sku: 'sku' } },
      ],
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
    expect(writes.map((w) => w.projected?.fields['def1:sku'])).toEqual(['A', 'B'])
    // No natural id on the element → synthetic `${parentExternalId}:${index}`.
    expect(writes.map((w) => w.projected?.externalId)).toEqual(['o1:0', 'o1:1'])
  })

  it('resolves identity candidates from a `match`-flagged field binding', () => {
    const m = mapping({
      id: 'cust',
      rootPath: 'customer',
      targetMode: 'contributing',
      fieldMappings: [
        // The bound field IS the identity match: source path 'email' (relative to
        // rootPath 'customer') → target field 'contact_email', flagged `match`.
        {
          id: 'e1',
          targetFieldRef: 'def1:contact_email',
          expression: '{email}',
          sourceFields: { email: 'email' },
          match: { normalize: 'email' },
        },
      ],
    })

    const writes = mapRecord([m], source({ customer: { email: 'a@b.com', name: 'Acme' } }))

    expect(writes).toHaveLength(1)
    expect(writes[0]?.projected?.identityCandidates).toEqual([
      { targetFieldRef: 'def1:contact_email', value: 'a@b.com', normalize: 'email' },
    ])
  })

  it('fans a top-level array payload out via a `[]` root, deriving ids from each element', () => {
    // The generic-rest case: the raw response IS the array; the root mapping
    // selects records with rootPath `[]`, no connector-provided id hint.
    const m = mapping({
      rootPath: '[]',
      fieldMappings: [
        {
          id: 'e1',
          targetFieldRef: 'def1:title',
          expression: '{title}',
          sourceFields: { title: 'title' },
        },
      ],
    })

    const writes = mapRecord(
      [m],
      rawPayload([
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ])
    )

    expect(writes).toHaveLength(2)
    expect(writes.map((w) => w.projected?.fields['def1:title'])).toEqual(['a', 'b'])
    // Each element's own `id` becomes the externalId (no parent hint needed).
    expect(writes.map((w) => w.projected?.externalId)).toEqual(['1', '2'])
  })

  it('extracts child subtrees RELATIVE to the parent (orders[] → line_items[])', () => {
    const root = mapping({ id: 'order', rootPath: '[]' })
    const child = mapping({
      id: 'li',
      rootPath: 'line_items[]',
      parentMappingId: 'order',
      relationshipFieldKey: 'line_items',
      fieldMappings: [
        { id: 'e1', targetFieldRef: 'def1:sku', expression: '{sku}', sourceFields: { sku: 'sku' } },
      ],
    })

    const writes = mapRecord(
      [root, child],
      rawPayload([{ id: 'o1', line_items: [{ sku: 'A' }, { sku: 'B' }] }])
    )

    const lineItems = writes.filter((w) => w.mapping.row.id === 'li')
    expect(lineItems.map((w) => w.projected?.fields['def1:sku'])).toEqual(['A', 'B'])
    // Children attach to the specific parent instance (o1) they nest under.
    expect(lineItems.every((w) => w.parentRelation?.parentExternalId === 'o1')).toBe(true)
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
