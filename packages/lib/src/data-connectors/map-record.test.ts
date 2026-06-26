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
          identityRole: { kind: 'match', normalize: 'email' },
        },
      ],
    })

    const writes = mapRecord([m], source({ customer: { email: 'a@b.com', name: 'Acme' } }))

    expect(writes).toHaveLength(1)
    expect(writes[0]?.projected?.identityCandidates).toEqual([
      { targetFieldRef: 'def1:contact_email', value: 'a@b.com', normalize: 'email' },
    ])
  })

  it('evaluates a multi-source FORMULA as a `match` key (not just one raw field)', () => {
    const m = mapping({
      id: 'order',
      rootPath: '',
      targetMode: 'contributing',
      fieldMappings: [
        // A computed match key over two source fields — the candidate value must be the
        // EVALUATED expression, not an arbitrary single `sourceFields` path.
        {
          id: 'e1',
          targetFieldRef: 'def1:order_key',
          expression: 'concat({store}, "-", {order_no})',
          sourceFields: { store: 'store', order_no: 'order_no' },
          identityRole: { kind: 'match', normalize: 'none' },
        },
      ],
    })

    const writes = mapRecord([m], source({ store: 'us', order_no: '1001' }))

    expect(writes[0]?.projected?.identityCandidates).toEqual([
      { targetFieldRef: 'def1:order_key', value: 'us-1001', normalize: 'none' },
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

  it('stamps upstreamUpdatedAt on the ROOT record from updatedAtPath (parsed)', () => {
    const root = mapping({ id: 'order', rootPath: '[]' })
    const child = mapping({
      id: 'li',
      rootPath: 'line_items[]',
      parentMappingId: 'order',
      relationshipFieldKey: 'line_items',
    })

    const writes = mapRecord(
      [root, child],
      rawPayload([{ id: 'o1', updated_at: '2026-06-22T00:00:00Z', line_items: [{ id: 'l1' }] }]),
      'updated_at'
    )

    const rootWrite = writes.find((w) => w.mapping.row.id === 'order')
    const childWrite = writes.find((w) => w.mapping.row.id === 'li')
    expect(rootWrite?.projected?.upstreamUpdatedAt?.toISOString()).toBe('2026-06-22T00:00:00.000Z')
    // Children version with the parent event — no independent stamp.
    expect(childWrite?.projected?.upstreamUpdatedAt).toBeUndefined()
  })

  it('leaves upstreamUpdatedAt undefined without an updatedAtPath or when the field is absent', () => {
    const m = mapping({ rootPath: '[]' })
    const noPath = mapRecord([m], rawPayload([{ id: '1', updated_at: '2026-01-01T00:00:00Z' }]))
    expect(noPath[0]?.projected?.upstreamUpdatedAt).toBeUndefined()

    const missingField = mapRecord([m], rawPayload([{ id: '1' }]), 'updated_at')
    expect(missingField[0]?.projected?.upstreamUpdatedAt).toBeNull()
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
    // map-record emits a cardinality-NEUTRAL relation (sink-source resolves the
    // belongs_to/has_many side against the cache). The child carries its own
    // external id + the authored relationship ref + its own (related) def.
    expect(childWrite?.parentRelation).toMatchObject({
      parentMappingId: 'root',
      relationshipRef: 'customer',
      childExternalId: 'c1',
      relatedDef: 'def1',
    })
  })

  // ── Drilled relationship linking (v3 §9) ─────────────────────────────────────

  it('id-only reference emits a neutral edge carrying the related def + child id', () => {
    // Order has a `customer_id` scalar FK drilled to the `customer` relationship; the
    // reference mapping's own def IS the related (Customer) def — DEF-KEYED, so the
    // two-pass resolves against (connector, relatedDef, childExternalId), not a frozen
    // mapping pointer.
    const root = mapping({ id: 'order', rootPath: '[]' })
    const ref = mapping({
      id: 'order-customer-ref',
      rootPath: 'customer_id',
      parentMappingId: 'order',
      linkMode: 'reference',
      relationshipFieldKey: 'order:customer',
      entityDefinitionId: 'cust_def',
    })

    const writes = mapRecord([root, ref], rawPayload([{ id: 'o1', customer_id: 'c1' }]))

    const refWrite = writes.find((w) => w.mapping.row.id === 'order-customer-ref')
    // A reference writes nothing — it only registers the pending edge on the parent.
    expect(refWrite?.projected).toBeNull()
    expect(refWrite?.parentRelation).toEqual({
      parentMappingId: 'order',
      parentExternalId: 'o1',
      childMappingId: 'order-customer-ref',
      childExternalId: 'c1',
      relationshipRef: 'order:customer',
      relatedDef: 'cust_def',
    })
  })

  it('emits a CLEAR edge when a reference FK is empty (clear-on-empty)', () => {
    const root = mapping({ id: 'order', rootPath: '[]' })
    const ref = mapping({
      id: 'order-customer-ref',
      rootPath: 'customer_id',
      parentMappingId: 'order',
      linkMode: 'reference',
      relationshipFieldKey: 'order:customer',
      entityDefinitionId: 'cust_def',
    })

    // FK absent, null, and empty-string all clear the edge (null childExternalId).
    for (const payload of [
      { id: 'o1' },
      { id: 'o1', customer_id: null },
      { id: 'o1', customer_id: '' },
    ]) {
      const writes = mapRecord([root, ref], rawPayload([payload]))
      const refWrite = writes.find((w) => w.mapping.row.id === 'order-customer-ref')
      expect(refWrite?.projected).toBeNull()
      expect(refWrite?.parentRelation).toEqual({
        parentMappingId: 'order',
        parentExternalId: 'o1',
        childMappingId: 'order-customer-ref',
        childExternalId: null,
        relationshipRef: 'order:customer',
        relatedDef: 'cust_def',
      })
    }
  })

  it('an embedded upsert child carries its OWN def as the related def (def-keyed)', () => {
    const root = mapping({ id: 'root', rootPath: '' })
    const child = mapping({
      id: 'child',
      rootPath: 'customer',
      parentMappingId: 'root',
      relationshipFieldKey: 'order:customer',
      entityDefinitionId: 'cust_def',
    })

    const writes = mapRecord([child, root], source({ customer: { id: 'c1' } }))
    const childWrite = writes.find((w) => w.mapping.row.id === 'child')
    expect(childWrite?.parentRelation?.relatedDef).toBe('cust_def')
    expect(childWrite?.parentRelation?.childExternalId).toBe('c1')
  })

  // ── Explicit External-ID designation (v3 §9.3a) ──────────────────────────────

  it('uses a designated External-ID field over the heuristic guess', () => {
    const m = mapping({
      rootPath: 'customer',
      fieldMappings: [
        {
          id: 'e1',
          targetFieldRef: null,
          expression: '{email}',
          sourceFields: { email: 'email' },
          identityRole: { kind: 'externalId' },
        },
      ],
    })
    // The subtree has a natural `id`, but the designated `email` wins.
    const writes = mapRecord([m], source({ customer: { id: 'cust_1', email: 'a@b.com' } }))
    expect(writes[0]?.projected?.externalId).toBe('a@b.com')
  })

  it('External-ID supports an ordered first-non-null fallback chain', () => {
    const m = mapping({
      rootPath: 'customer',
      fieldMappings: [
        {
          id: 'primary',
          targetFieldRef: null,
          expression: '{id}',
          sourceFields: { id: 'id' },
          identityRole: { kind: 'externalId', order: 0 },
        },
        {
          id: 'fallback',
          targetFieldRef: null,
          expression: '{email}',
          sourceFields: { email: 'email' },
          identityRole: { kind: 'externalId', order: 1 },
        },
      ],
    })
    // `id` is null → falls through to `email`.
    const writes = mapRecord([m], source({ customer: { id: null, email: 'a@b.com' } }))
    expect(writes[0]?.projected?.externalId).toBe('a@b.com')
  })

  it('an UPSERT mapping with an empty subtree is skipped (no clear)', () => {
    const m = mapping({ id: 'cust', rootPath: 'customer' })
    const writes = mapRecord([m], source({ customer: null }))
    expect(writes).toHaveLength(0)
  })
})
