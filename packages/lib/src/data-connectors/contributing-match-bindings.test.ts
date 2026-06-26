// packages/lib/src/data-connectors/contributing-match-bindings.test.ts
import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { buildContributingMatchBindings, type ContributingTargetField } from './app-catalog'

const DEF = 'def_contact'

/** A contact def carrying a system email field (systemAttribute differs from the key). */
const CONTACT_FIELDS: ContributingTargetField[] = [
  { id: 'fld_email', name: 'Email', systemAttribute: 'primary_email', type: 'EMAIL' },
  { id: 'fld_phone', name: 'Phone', systemAttribute: 'primary_phone', type: 'PHONE_INTL' },
]

/** The Shopify `order` stream's declared source fields (subset). */
const ORDER_FIELDS = [
  { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'Order ID' },
  {
    fieldKey: 'customer.email',
    sourcePath: 'customer.email',
    type: 'EMAIL',
    name: 'Customer Email',
  },
]

describe('buildContributingMatchBindings', () => {
  it('binds a match key when both source path and target field resolve', () => {
    const [binding, ...rest] = buildContributingMatchBindings(
      DEF,
      'customer',
      ['email'],
      ORDER_FIELDS,
      CONTACT_FIELDS
    )
    expect(rest).toHaveLength(0)
    expect(binding).toMatchObject({
      // Resolves 'email' → the field named 'Email' (normalized name match).
      targetFieldRef: toResourceFieldId(DEF, 'fld_email'),
      // Source path is stored subtree-relative ('email', not 'customer.email').
      expression: '{email}',
      sourceFields: { email: 'email' },
      // EMAIL field type → email normalize, carried on the `match` identity role.
      identityRole: { kind: 'match', normalize: 'email' },
    })
  })

  it('drops a key with no declared source field under the rootPath', () => {
    // matchFieldKeys 'phone' has a target field but no `customer.phone` source field.
    expect(
      buildContributingMatchBindings(DEF, 'customer', ['phone'], ORDER_FIELDS, CONTACT_FIELDS)
    ).toEqual([])
  })

  it('drops a key with no matching target field', () => {
    expect(
      buildContributingMatchBindings(DEF, 'customer', ['nope'], ORDER_FIELDS, CONTACT_FIELDS)
    ).toEqual([])
  })

  it('skips array roots (no single deterministic source path)', () => {
    expect(
      buildContributingMatchBindings(DEF, 'line_items[]', ['email'], ORDER_FIELDS, CONTACT_FIELDS)
    ).toEqual([])
  })

  it('returns nothing for an empty matchFieldKeys list', () => {
    expect(
      buildContributingMatchBindings(DEF, 'customer', [], ORDER_FIELDS, CONTACT_FIELDS)
    ).toEqual([])
  })
})
