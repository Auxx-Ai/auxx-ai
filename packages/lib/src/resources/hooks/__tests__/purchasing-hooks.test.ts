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
  it('registers no lifecycle guards', () => {
    expect(Object.keys(PURCHASE_ORDER_HOOKS)).toEqual(['purchase_order_number'])
    expect(Object.keys(VENDOR_BILL_HOOKS)).toEqual(['vendor_bill_internal_number'])
  })
})
