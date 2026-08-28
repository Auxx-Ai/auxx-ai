// packages/lib/src/field-hooks/post/purchase-order-contact-prefill.test.ts
//
// The SECOND door for the vendor -> contact default (purchasing plan 07). The
// `purchase_order_vendor` system hook covers `UnifiedCrudHandler` writes — how an
// order is first drafted against a supplier. Re-pointing an existing order at a
// different supplier goes through `fieldValue.set`, which never reads the
// system-hook registry, so it reaches only this handler.
//
// The rule this pins is the one that separates a prefill from a stamp: replace this
// hook's own prefill, never a human's pick.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  resolveCompanyPrimaryContact: vi.fn(),
  setValueWithType: vi.fn(),
  createFieldValueContext: vi.fn(),
  getValues: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../resources/hooks/purchasing-hooks', () => ({
  resolveCompanyPrimaryContact: h.resolveCompanyPrimaryContact,
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    getValues = h.getValues
  },
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: () => 'RELATIONSHIP' }))

import { prefillContactOnVendorChange } from './purchase-order-contact-prefill'

const PO = 'podef:po-1'
const OLD_VENDOR = 'codef:co-old'
const NEW_VENDOR = 'codef:co-new'
const OLD_PRIMARY = 'ctdef:ct-old'
const NEW_PRIMARY = 'ctdef:ct-new'
const HUMAN_PICK = 'ctdef:ct-human'

function event(overrides: Partial<EntityFieldChangeEvent> = {}): EntityFieldChangeEvent {
  return {
    recordId: PO,
    entityDefinitionId: 'podef',
    entityType: 'purchase_order',
    entitySlug: 'purchase-orders',
    field: { id: 'fld-vendor', systemAttribute: 'purchase_order_vendor', type: 'RELATIONSHIP' },
    oldValue: [{ type: 'relationship', recordId: OLD_VENDOR }],
    newValue: [{ type: 'relationship', recordId: NEW_VENDOR }],
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org_1',
    userId: 'usr_1',
    ...overrides,
  } as unknown as EntityFieldChangeEvent
}

/** The current `purchase_order_contact` on the order, as `getValues` returns it. */
function currentContact(recordId: string | null) {
  h.getValues.mockResolvedValue(
    new Map(recordId ? [['fld-contact', [{ type: 'relationship', recordId }]]] : [])
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue({
    purchase_order_contact: { id: 'fld-contact', type: 'RELATIONSHIP' },
  })
  h.createFieldValueContext.mockResolvedValue({})
  currentContact(null)
})

describe('prefillContactOnVendorChange', () => {
  it('fills an empty contact from the new vendor', async () => {
    h.resolveCompanyPrimaryContact.mockResolvedValue(NEW_PRIMARY)

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        recordId: PO,
        fieldId: 'fld-contact',
        value: { type: 'relationship', recordId: NEW_PRIMARY },
      })
    )
  })

  // The whole reason this is a prefill and not a stamp.
  it('leaves a human’s pick alone', async () => {
    currentContact(HUMAN_PICK)
    h.resolveCompanyPrimaryContact.mockImplementation(async ({ companyRecordId }) =>
      companyRecordId === NEW_VENDOR ? NEW_PRIMARY : OLD_PRIMARY
    )

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('re-derives a contact that was its own earlier prefill', async () => {
    currentContact(OLD_PRIMARY)
    h.resolveCompanyPrimaryContact.mockImplementation(async ({ companyRecordId }) =>
      companyRecordId === NEW_VENDOR ? NEW_PRIMARY : OLD_PRIMARY
    )

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ value: { type: 'relationship', recordId: NEW_PRIMARY } })
    )
  })

  // A prefilled contact names somebody at the PREVIOUS supplier, and this field's only
  // consumer is the address line on an email to the new one.
  it('clears its own prefill when the new vendor names nobody', async () => {
    currentContact(OLD_PRIMARY)
    h.resolveCompanyPrimaryContact.mockImplementation(async ({ companyRecordId }) =>
      companyRecordId === NEW_VENDOR ? null : OLD_PRIMARY
    )

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).toHaveBeenCalledWith({}, expect.objectContaining({ value: null }))
  })

  // `undefined` is "could not resolve" — never clear a good contact on a blip.
  it('writes nothing when the new vendor cannot be resolved', async () => {
    h.resolveCompanyPrimaryContact.mockResolvedValue(undefined)

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('writes nothing when the OLD vendor cannot be resolved', async () => {
    currentContact(OLD_PRIMARY)
    h.resolveCompanyPrimaryContact.mockImplementation(async ({ companyRecordId }) =>
      companyRecordId === NEW_VENDOR ? NEW_PRIMARY : undefined
    )

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('does not touch the contact when the vendor is detached', async () => {
    await prefillContactOnVendorChange(event({ newValue: null }))

    expect(h.resolveCompanyPrimaryContact).not.toHaveBeenCalled()
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('is a no-op when the derived contact is already the current one', async () => {
    currentContact(NEW_PRIMARY)
    h.resolveCompanyPrimaryContact.mockResolvedValue(NEW_PRIMARY)

    await prefillContactOnVendorChange(event())

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('ignores every field but the vendor', async () => {
    await prefillContactOnVendorChange(
      event({
        field: {
          id: 'fld-status',
          systemAttribute: 'purchase_order_status',
          type: 'SINGLE_SELECT',
        },
      } as unknown as Partial<EntityFieldChangeEvent>)
    )

    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  // A default must never fail the vendor write it rides on.
  it('swallows a write failure', async () => {
    h.resolveCompanyPrimaryContact.mockResolvedValue(NEW_PRIMARY)
    h.setValueWithType.mockRejectedValue(new Error('boom'))

    await expect(prefillContactOnVendorChange(event())).resolves.toBeUndefined()
  })
})
