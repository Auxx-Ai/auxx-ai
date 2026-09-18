// packages/lib/src/resources/registry/__tests__/system-attributes.test.ts
//
// The attribute list a `systemFields` call is scoped by, derived from the
// registry instead of a second `as const` array per module (plan §3b).

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ResourceField } from '../field-types'
import { PART_FIELDS } from '../resources/part-fields'
import { PAYMENT_GATEWAY_FIELDS } from '../resources/payment-gateway-fields'
import { defineResourceFields, pickSystemAttributes, systemAttributes } from '../system-attributes'

describe('systemAttributes', () => {
  it('lists the FieldValue-backed attributes of a declared map', () => {
    const attributes = systemAttributes(PAYMENT_GATEWAY_FIELDS)
    expect([...attributes].sort()).toEqual([
      // `CREATED_BY_FIELD` carries `dbColumn: 'createdById'` but is written to
      // `FieldValue` by the `autoSetCreatedBy` hook, so the picker keeps it.
      'created_by_id',
      'payment_gateway_fee_treatment',
      'payment_gateway_handles',
      'payment_gateway_last_fee_booked_at',
      'payment_gateway_last_settlement_at',
      'payment_gateway_name',
      'payment_gateway_payouts',
      'payment_gateway_status',
    ])
  })

  it('types them as the literals, so a module can drop its own X_ATTRIBUTES array', () => {
    expectTypeOf(systemAttributes(PAYMENT_GATEWAY_FIELDS)).toEqualTypeOf<
      (
        | 'payment_gateway_name'
        | 'payment_gateway_handles'
        | 'payment_gateway_fee_treatment'
        | 'payment_gateway_status'
        | 'payment_gateway_last_settlement_at'
        | 'payment_gateway_last_fee_booked_at'
        | 'payment_gateway_payouts'
      )[]
    >()
  })

  it('drops column-backed fields, which have no stored value to read', () => {
    expect(systemAttributes(PAYMENT_GATEWAY_FIELDS)).not.toContain('id')
    expect(systemAttributes(PAYMENT_GATEWAY_FIELDS)).not.toContain('created_at')
  })

  it('answers never[] for a map that annotated its literals away', () => {
    const widened: Record<string, ResourceField> = PAYMENT_GATEWAY_FIELDS
    expectTypeOf(systemAttributes(widened)).toEqualTypeOf<never[]>()
  })

  it('keeps the declared map assignable everywhere a Record<string, ResourceField> was', () => {
    const fields = defineResourceFields({
      name: PAYMENT_GATEWAY_FIELDS.name as ResourceField,
    })
    const asRecord: Record<string, ResourceField> = fields
    expect(asRecord.name).toBeDefined()
    // Indexing by a runtime string still compiles — the data migrations do this.
    const key = 'name'
    expect(fields[key]).toBeDefined()
  })
})

describe('pickSystemAttributes', () => {
  it('hands back exactly the picked attributes', () => {
    expect(
      pickSystemAttributes(PAYMENT_GATEWAY_FIELDS, [
        'payment_gateway_name',
        'payment_gateway_status',
      ] as const)
    ).toEqual(['payment_gateway_name', 'payment_gateway_status'])
  })

  it('types them as the picked literals, so cell() accepts only those names', () => {
    expectTypeOf(
      pickSystemAttributes(PAYMENT_GATEWAY_FIELDS, [
        'payment_gateway_name',
        'payment_gateway_status',
      ])
    ).toEqualTypeOf<('payment_gateway_name' | 'payment_gateway_status')[]>()
  })

  it('refuses an attribute the map does not declare', () => {
    // @ts-expect-error `payout_status` belongs to another def
    pickSystemAttributes(PAYMENT_GATEWAY_FIELDS, ['payout_status'])
  })

  it('refuses a column-backed field, which has no cell to read', () => {
    // @ts-expect-error `created_at` is an EntityInstance column, not a stored value
    pickSystemAttributes(PAYMENT_GATEWAY_FIELDS, ['created_at'])
  })

  // The seeder's `shouldCreateField` only skips an explicitly-undefined `dbColumn`.
  it('picks a field whose dbColumn is a string, which still stores a FieldValue row', () => {
    // `part_sku` declares `dbColumn: 'sku'`, but `EntityInstance` has no such
    // column and the seeder creates its `CustomField` all the same.
    expectTypeOf(pickSystemAttributes(PART_FIELDS, ['part_sku'])).toEqualTypeOf<'part_sku'[]>()
    expect(systemAttributes(PART_FIELDS)).toContain('part_sku')
  })

  it('refuses a field whose dbColumn is explicitly undefined, which has no CustomField', () => {
    const fields = defineResourceFields({
      body: {
        ...PART_FIELDS.sku,
        systemAttribute: 'body',
        dbColumn: undefined,
      } as ResourceField & {
        systemAttribute: 'body'
        dbColumn: undefined
      },
    })
    // @ts-expect-error a virtual field has no stored value to read
    pickSystemAttributes(fields, ['body'])
    expect(systemAttributes(fields)).toEqual([])
  })
})

describe('the widened-map guard', () => {
  it('keeps the declared map assignable everywhere a Record<string, ResourceField> was', () => {
    const fields = defineResourceFields({
      name: PAYMENT_GATEWAY_FIELDS.name as ResourceField,
    })
    const asRecord: Record<string, ResourceField> = fields
    expect(asRecord.name).toBeDefined()
    // Indexing by a runtime string still compiles — the data migrations do this.
    const key = 'name'
    expect(fields[key]).toBeDefined()
  })
})
