// packages/lib/src/resources/hooks/__tests__/record-number-hook.test.ts
//
// "Theirs if they bring one, otherwise ours" (plans/money/tasks/39 section 6.5):
// the shared number helper keeps a non-blank incoming document number on create
// and only allocates from RecordSequence when nothing was supplied.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemHookContext } from '../types'

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: vi.fn() },
}))

const { recordNumbering } = await import('../../../records/record-numbering')
const createMock = vi.mocked(recordNumbering.create)

const { keepOrAllocateRecordNumber } = await import('../record-number-hook')

const FIELD_ID = 'field-order-number-1'

function buildContext(overrides: Partial<SystemHookContext> = {}): SystemHookContext {
  return {
    operation: 'create',
    entityDef: { id: 'def-order', entityType: 'order' },
    field: { id: FIELD_ID, type: 'TEXT', systemAttribute: 'order_number' },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [],
    ...overrides,
  } as unknown as SystemHookContext
}

describe('keepOrAllocateRecordNumber', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({ recordNumber: 'ORD-0001', sequenceNumber: 1 })
  })

  it('keeps a number supplied under the field id and allocates nothing', async () => {
    const values = await keepOrAllocateRecordNumber(
      buildContext({ values: { [FIELD_ID]: '#1001', other: 1 } }),
      'order'
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ [FIELD_ID]: '#1001', other: 1 })
  })

  it('keeps a number supplied under the system attribute and allocates nothing', async () => {
    const values = await keepOrAllocateRecordNumber(
      buildContext({ values: { order_number: '#1002' } }),
      'order'
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ order_number: '#1002' })
  })

  it('treats a blank string as nothing supplied and allocates', async () => {
    const values = await keepOrAllocateRecordNumber(
      buildContext({ values: { [FIELD_ID]: '   ' } }),
      'order'
    )

    expect(createMock).toHaveBeenCalledWith('org-1', 'order')
    expect(values[FIELD_ID]).toBe('ORD-0001')
  })

  it('allocates on the given scope when no number is supplied', async () => {
    createMock.mockResolvedValue({ recordNumber: 'PO-0007', sequenceNumber: 7 })

    const values = await keepOrAllocateRecordNumber(
      buildContext({
        field: {
          id: 'field-po',
          type: 'TEXT',
          systemAttribute: 'purchase_order_number',
        } as unknown as SystemHookContext['field'],
        values: { purchase_order_vendor: 'v1' },
      }),
      'purchase_order'
    )

    expect(createMock).toHaveBeenCalledWith('org-1', 'purchase_order')
    expect(values).toEqual({ purchase_order_vendor: 'v1', 'field-po': 'PO-0007' })
  })

  it('ignores a non-string value and allocates', async () => {
    const values = await keepOrAllocateRecordNumber(
      buildContext({ values: { [FIELD_ID]: 1001 } }),
      'order'
    )

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(values[FIELD_ID]).toBe('ORD-0001')
  })

  it('leaves an update untouched, even when a number is supplied', async () => {
    const values = await keepOrAllocateRecordNumber(
      buildContext({ operation: 'update', values: { [FIELD_ID]: '#1003', other: 1 } }),
      'order'
    )

    expect(createMock).not.toHaveBeenCalled()
    expect(values).toEqual({ [FIELD_ID]: '#1003', other: 1 })
  })
})
