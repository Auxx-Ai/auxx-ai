// packages/lib/src/data-connectors/contributing-match-bindings.test.ts
import { toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { buildContributingMatchBindings, type ContributingTargetField } from './app-catalog'

const DEF = 'def_contact'
const DEF_PART = 'def_part'

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

/** A part def carrying an sku field, matched by normalized name. */
const PART_FIELDS: ContributingTargetField[] = [
  { id: 'fld_sku', name: 'SKU', systemAttribute: 'part_sku', type: 'TEXT' },
  { id: 'fld_option', name: 'Option value', systemAttribute: null, type: 'TEXT' },
]

/** The Shopify `product` stream's variant subtree (subset) — 02 §1.4's worked example. */
const PRODUCT_VARIANT_FIELDS = [
  { fieldKey: 'variants.sku', sourcePath: 'variants[].sku', type: 'TEXT', name: 'SKU' },
  {
    fieldKey: 'variants.option_value',
    sourcePath: 'variants[].options[].value',
    type: 'TEXT',
    name: 'Option value',
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

  // A named array root relativizes deterministically ('variants[].sku' under
  // 'variants[]' is 'sku') — the same rule the owned partitioner syncs on. Only a
  // NESTED array (a `[]` surviving in the subtree-relative path) is unresolvable
  // per record, because `mapRecord.getByPath` only matches indexed `[digit]` segments.
  // See plans/products/06-contributing-array-root-binding.md and 02 §1.4.

  it('binds a match key under a named array root (variants[] + sku)', () => {
    const [binding, ...rest] = buildContributingMatchBindings(
      DEF_PART,
      'variants[]',
      ['sku'],
      PRODUCT_VARIANT_FIELDS,
      PART_FIELDS
    )
    expect(rest).toHaveLength(0)
    expect(binding).toMatchObject({
      targetFieldRef: toResourceFieldId(DEF_PART, 'fld_sku'),
      // Stored subtree-relative — 'sku', not 'variants[].sku'.
      expression: '{sku}',
      sourceFields: { sku: 'sku' },
      identityRole: { kind: 'match', normalize: 'none' },
    })
  })

  it('skips a key whose subtree-relative path crosses a NESTED array', () => {
    // 'options[].value' under 'variants[]' keeps a digit-less `[]` — unresolvable.
    expect(
      buildContributingMatchBindings(
        DEF_PART,
        'variants[]',
        ['options[].value'],
        PRODUCT_VARIANT_FIELDS,
        PART_FIELDS
      )
    ).toEqual([])
  })

  it('returns nothing for an empty matchFieldKeys list', () => {
    expect(
      buildContributingMatchBindings(DEF, 'customer', [], ORDER_FIELDS, CONTACT_FIELDS)
    ).toEqual([])
  })
})
