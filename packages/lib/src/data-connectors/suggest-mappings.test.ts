// packages/lib/src/data-connectors/suggest-mappings.test.ts
// Tier 2 mapping suggester (create-sync-flow §3.2): scalar-leaf extraction from a
// source schema + the name/type heuristic that proposes source→field bindings.

import { describe, expect, it } from 'vitest'
import { collectSchemaLeaves } from '../json-schema'
import type { ResourceField } from '../resources'
import { suggestFieldMappings } from './suggest-mappings'

/** Minimal writable target field; override `capabilities`/`fieldType` per case. */
function field(partial: Partial<ResourceField> & { id: string; key: string }): ResourceField {
  return {
    label: partial.key,
    type: 'string',
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
    ...partial,
  } as ResourceField
}

describe('collectSchemaLeaves', () => {
  it('collects scalar leaves, recurses objects, skips arrays', () => {
    const leaves = collectSchemaLeaves({
      type: 'object',
      properties: {
        email: { type: 'string' },
        age: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        customer: { type: 'object', properties: { city: { type: 'string' } } },
      },
    })
    expect(leaves).toEqual([
      { path: 'email', jsonType: 'string' },
      { path: 'age', jsonType: 'number' },
      { path: 'customer.city', jsonType: 'string' },
    ])
  })

  it('descends an array-root schema into its element shape (record-relative paths)', () => {
    const leaves = collectSchemaLeaves({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } } },
    })
    expect(leaves).toEqual([{ path: 'id', jsonType: 'string' }])
  })

  it('surfaces scalar arrays when includeScalarArrays is set, still skipping object arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'number' } },
        items: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } },
      },
    }
    expect(collectSchemaLeaves(schema)).toEqual([])
    expect(collectSchemaLeaves(schema, { includeScalarArrays: true })).toEqual([
      { path: 'ids', jsonType: 'number' },
    ])
  })

  it('emits an `x-auxx-fieldType` struct node as one leaf (carrying the type, not its components)', () => {
    const leaves = collectSchemaLeaves({
      type: 'object',
      properties: {
        shipping_address: {
          type: 'object',
          'x-auxx-fieldType': 'ADDRESS_STRUCT',
          properties: { city: { type: 'string' } },
        },
      },
    })
    expect(leaves).toEqual([
      { path: 'shipping_address', jsonType: 'object', fieldType: 'ADDRESS_STRUCT' },
    ])
  })
})

describe('suggestFieldMappings', () => {
  const DEF = 'def_contact'

  it('matches snake/camel-normalized names and emits one-click bindings', () => {
    const targets = [
      field({ id: 'email', key: 'email', label: 'Email' }),
      field({ id: 'fld_first', key: 'firstName', label: 'First name' }),
    ]
    const proposals = suggestFieldMappings(
      DEF,
      { type: 'object', properties: { email: { type: 'string' }, first_name: { type: 'string' } } },
      targets
    )
    expect(proposals).toHaveLength(2)
    const byRef = Object.fromEntries(proposals.map((p) => [p.targetFieldRef, p]))
    expect(byRef[`${DEF}:email`]).toMatchObject({
      expression: '{email}',
      sourceFields: { email: 'email' },
    })
    expect(byRef[`${DEF}:fld_first`]).toMatchObject({
      expression: '{first_name}',
      sourceFields: { first_name: 'first_name' },
    })
  })

  it('skips non-writable target fields', () => {
    const targets = [
      field({
        id: 'rid',
        key: 'recordId',
        capabilities: {
          filterable: true,
          sortable: true,
          creatable: false,
          updatable: false,
          configurable: false,
          computed: true,
        },
      }),
    ]
    const proposals = suggestFieldMappings(
      DEF,
      { type: 'object', properties: { record_id: { type: 'string' } } },
      targets
    )
    expect(proposals).toEqual([])
  })

  it('rejects a name match when the target type is incompatible', () => {
    // RELATIONSHIP never sinks a foreign type, so a string source can't bind.
    const targets = [field({ id: 'fld_owner', key: 'owner', fieldType: 'RELATIONSHIP' })]
    const proposals = suggestFieldMappings(
      DEF,
      { type: 'object', properties: { owner: { type: 'string' } } },
      targets
    )
    expect(proposals).toEqual([])
  })

  it('binds a struct leaf to a same-named ADDRESS_STRUCT target (and not to a TEXT one)', () => {
    const schema = {
      type: 'object',
      properties: {
        shipping_address: {
          type: 'object',
          'x-auxx-fieldType': 'ADDRESS_STRUCT',
          properties: { city: { type: 'string' } },
        },
      },
    }
    // TEXT target → struct source incompatible, no proposal.
    expect(
      suggestFieldMappings(DEF, schema, [
        field({ id: 'addr', key: 'shippingAddress', label: 'Shipping Address', fieldType: 'TEXT' }),
      ])
    ).toEqual([])
    // ADDRESS_STRUCT target → binds the whole-object leaf.
    const proposals = suggestFieldMappings(DEF, schema, [
      field({
        id: 'addr',
        key: 'shippingAddress',
        label: 'Shipping Address',
        fieldType: 'ADDRESS_STRUCT',
      }),
    ])
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      targetFieldRef: `${DEF}:addr`,
      expression: '{shipping_address}',
      sourceFields: { shipping_address: 'shipping_address' },
    })
  })

  it('binds at most one source per target field', () => {
    const targets = [field({ id: 'email', key: 'email', label: 'Email' })]
    const proposals = suggestFieldMappings(
      DEF,
      // Two source leaves normalize to "email" — only the first wins the target.
      { type: 'object', properties: { email: { type: 'string' }, e_mail: { type: 'string' } } },
      targets
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.sourceFields).toEqual({ email: 'email' })
  })
})
