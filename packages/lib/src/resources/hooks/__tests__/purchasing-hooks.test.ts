// packages/lib/src/resources/hooks/__tests__/purchasing-hooks.test.ts
//
// Same failure mode as `order-hooks.test.ts` pins for `order_number`: the four
// purchasing number/roll-up fields were declared `creatable: false` ("the hook is
// the ONLY writer") in a change that shipped no hook and no registration, so every
// row would have been created with a NULL number that no human could fill either.
// `HOOKS_BY_ENTITY_TYPE` returns `{}` for an unregistered entityType rather than
// throwing, so only a registration assertion catches it.

import { describe, expect, it, vi } from 'vitest'
import type { SystemHookContext } from '../types'

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: vi.fn() },
}))

const h = vi.hoisted(() => ({ bySystemAttributes: vi.fn(), getValues: vi.fn() }))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    getValues = h.getValues
  },
}))

const { recordNumbering } = await import('../../../records/record-numbering')
const createMock = vi.mocked(recordNumbering.create)

const { PURCHASE_ORDER_HOOKS, VENDOR_BILL_HOOKS } = await import('../purchasing-hooks')
const { getSystemHooks, getHooksForAttribute } = await import('../system-hooks')

function buildContext(
  entityType: string,
  systemAttribute: string,
  fieldId: string,
  overrides: Partial<SystemHookContext> = {}
): SystemHookContext {
  return {
    operation: 'create',
    entityDef: { id: `def-${entityType}`, entityType },
    field: { id: fieldId, type: 'TEXT', systemAttribute },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [],
    ...overrides,
  } as unknown as SystemHookContext
}

describe('purchase_order_number issuance', () => {
  it('stamps a RecordSequence number on create', async () => {
    createMock.mockResolvedValue({ recordNumber: 'PO-0001', sequenceNumber: 1 })

    const values = await PURCHASE_ORDER_HOOKS.purchase_order_number![0]!(
      buildContext('purchase_order', 'purchase_order_number', 'field-po-number')
    )

    expect(createMock).toHaveBeenCalledWith('org-1', 'purchase_order')
    expect(values['field-po-number']).toBe('PO-0001')
  })

  it('does not re-issue on update — the number is stable for the record’s life', async () => {
    createMock.mockClear()

    const values = await PURCHASE_ORDER_HOOKS.purchase_order_number![0]!(
      buildContext('purchase_order', 'purchase_order_number', 'field-po-number', {
        operation: 'update',
        values: { other: 1 },
      })
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ other: 1 })
  })
})

describe('vendor_bill_internal_number issuance', () => {
  it('stamps a RecordSequence number on create, on the `vendor_bill` scope', async () => {
    createMock.mockClear()
    createMock.mockResolvedValue({ recordNumber: 'BILL-0001', sequenceNumber: 1 })

    const values = await VENDOR_BILL_HOOKS.vendor_bill_internal_number![0]!(
      buildContext('vendor_bill', 'vendor_bill_internal_number', 'field-bill-internal')
    )

    expect(createMock).toHaveBeenCalledWith('org-1', 'vendor_bill')
    expect(values['field-bill-internal']).toBe('BILL-0001')
  })

  it('does not re-issue on update', async () => {
    createMock.mockClear()

    const values = await VENDOR_BILL_HOOKS.vendor_bill_internal_number![0]!(
      buildContext('vendor_bill', 'vendor_bill_internal_number', 'field-bill-internal', {
        operation: 'update',
        values: { other: 1 },
      })
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ other: 1 })
  })
})

const CONTACT_FIELD = { id: 'fld-contact', systemAttribute: 'purchase_order_contact' }
const VENDOR_FIELD = { id: 'fld-vendor', systemAttribute: 'purchase_order_vendor' }
const VENDOR = 'codef:co-1'
const PRIMARY = 'ctdef:ct-1'

/** What `company_primary_contact` resolves to for the vendor in the write. */
function primaryContactIs(recordId: string | null) {
  h.bySystemAttributes.mockResolvedValue({ company_primary_contact: { id: 'fld-cpc' } })
  h.getValues.mockResolvedValue(
    new Map(recordId ? [['fld-cpc', [{ type: 'relationship', recordId }]]] : [])
  )
}

function vendorContext(overrides: Record<string, unknown> = {}): SystemHookContext {
  return buildContext('purchase_order', 'purchase_order_vendor', VENDOR_FIELD.id, {
    values: { [VENDOR_FIELD.id]: VENDOR },
    allFields: [CONTACT_FIELD, VENDOR_FIELD],
    ...overrides,
  } as unknown as Partial<SystemHookContext>)
}

/** The CRUD door for the vendor -> contact default (purchasing plan 07). */
describe('purchase_order_contact default', () => {
  const hook = () => PURCHASE_ORDER_HOOKS.purchase_order_vendor![0]!

  it('defaults the contact from the vendor\u2019s primary contact on create', async () => {
    primaryContactIs(PRIMARY)

    const values = await hook()(vendorContext())

    expect(values[CONTACT_FIELD.id]).toBe(PRIMARY)
  })

  // A caller that named a person is not asking for a default. `values` is accepted keyed by
  // field id OR by systemAttribute, so both keys have to be honoured.
  it('never overwrites a contact named in the same write', async () => {
    primaryContactIs(PRIMARY)

    const byId = await hook()(
      vendorContext({ values: { [VENDOR_FIELD.id]: VENDOR, [CONTACT_FIELD.id]: 'ctdef:mine' } })
    )
    const byAttribute = await hook()(
      vendorContext({
        values: { [VENDOR_FIELD.id]: VENDOR, purchase_order_contact: 'ctdef:mine' },
      })
    )

    expect(byId[CONTACT_FIELD.id]).toBe('ctdef:mine')
    expect(byAttribute[CONTACT_FIELD.id]).toBeUndefined()
  })

  // Re-pointing an existing order is the field-change twin's job \u2014 it is the only one of
  // the two given `oldValue`, which is what tells this hook's own prefill from a human's pick.
  it('does nothing on update', async () => {
    primaryContactIs(PRIMARY)

    const values = await hook()(vendorContext({ operation: 'update' }))

    expect(values[CONTACT_FIELD.id]).toBeUndefined()
  })

  it('leaves the contact unset when the vendor names nobody', async () => {
    primaryContactIs(null)

    const values = await hook()(vendorContext())

    expect(values[CONTACT_FIELD.id]).toBeUndefined()
  })

  it('leaves the contact unset when the write carries no vendor', async () => {
    primaryContactIs(PRIMARY)

    const values = await hook()(vendorContext({ values: {} }))

    expect(values[CONTACT_FIELD.id]).toBeUndefined()
  })

  // An org that has not run migration 108's contact half has no field to write.
  it('is inert on an org with no contact field', async () => {
    primaryContactIs(PRIMARY)

    const values = await hook()(vendorContext({ allFields: [VENDOR_FIELD] }))

    expect(values).toEqual({ [VENDOR_FIELD.id]: VENDOR })
  })
})

describe('purchasing hook registration', () => {
  // The miss that made native-order phase 1 ship numberless orders.
  it('is reachable through the entity-type registry, not just the module export', () => {
    expect(getSystemHooks('purchase_order')).toBe(PURCHASE_ORDER_HOOKS)
    expect(getSystemHooks('vendor_bill')).toBe(VENDOR_BILL_HOOKS)
    expect(getHooksForAttribute('purchase_order', 'purchase_order_number')).toHaveLength(1)
    expect(getHooksForAttribute('vendor_bill', 'vendor_bill_internal_number')).toHaveLength(1)
  })

  // `vendor_bill_number` is the VENDOR's invoice number — human-entered, required, and
  // creatable. A hook on it would overwrite what was keyed off their document.
  it('leaves the vendor’s own invoice number alone', () => {
    expect(getHooksForAttribute('vendor_bill', 'vendor_bill_number')).toHaveLength(0)
  })

  // The scopes themselves are guarded by the type system: `recordNumbering.create`'s
  // second parameter is the `SequenceScope` union, so `'purchase_order'` / `'vendor_bill'`
  // only compile because both scopes (and their `PO` / `BILL` prefixes) exist.
  //
  // `purchase_order_status` gained a lifecycle guard with Send
  // (plans/purchasing/07-purchase-order-send-and-status.md §3.4): `issued` is what sending
  // DOES, not a value somebody picks. The guard's own behaviour is covered in
  // `lifecycle-status-guard.test.ts`; this only pins that it is registered and reachable.
  it('guards purchase_order_status and nothing else on the order', () => {
    expect(Object.keys(PURCHASE_ORDER_HOOKS).sort()).toEqual([
      'purchase_order_number',
      'purchase_order_status',
      'purchase_order_vendor',
    ])
    expect(getHooksForAttribute('purchase_order', 'purchase_order_status')).toHaveLength(1)
  })

  // The contact default is keyed on the VENDOR, never on the contact: `runPreHooks` skips a
  // hook on update unless its own systemAttribute is in `values`, so keyed on the contact it
  // could never see which supplier the order was placed with.
  it('keys the contact default on the vendor, not the contact', () => {
    expect(getHooksForAttribute('purchase_order', 'purchase_order_vendor')).toHaveLength(1)
    expect(getHooksForAttribute('purchase_order', 'purchase_order_contact')).toHaveLength(0)
  })

  // `vendor_bill_status` is recomputed by the match hook on every create/update, so a manual
  // write is OVERWRITTEN rather than rejected — a guard here would fight that writer.
  it('registers no lifecycle guard on the vendor bill', () => {
    expect(Object.keys(VENDOR_BILL_HOOKS)).toEqual(['vendor_bill_internal_number'])
  })
})
