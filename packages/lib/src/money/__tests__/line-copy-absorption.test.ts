// packages/lib/src/money/__tests__/line-copy-absorption.test.ts
//
// T-1b (plans/events/04-in-transaction-write-semantics-plan.md §4): one of the
// two sites that opt into create absorption. `copyLineOntoInvoice` must declare
// the invoice it is copying onto — and must NOT thread a `publishEvents`
// boolean any more (plan 04 §7.3, B-18: the ambient write session decides).

import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it, vi } from 'vitest'
import { copyLineOntoInvoice } from '../gather'

const INVOICE_RECORD_ID = 'invoice:inv_1' as RecordId

function fakeHandler() {
  return {
    getFieldValues: vi.fn(async () => new Map()),
    create: vi.fn(async () => ({ instance: { id: 'line_copy_1' } })),
  }
}

describe('copyLineOntoInvoice — T-1b', () => {
  it('declares the invoice as the absorbing parent and passes no door boolean', async () => {
    const handler = fakeHandler()

    await copyLineOntoInvoice({
      handler: handler as never,
      fieldValueService: {} as never,
      lineCf: {} as never,
      lineFieldIds: [],
      lineInstanceId: 'line_1',
      invoiceRecordId: INVOICE_RECORD_ID,
    })

    expect(handler.create).toHaveBeenCalledTimes(1)
    const [defId, , options] = handler.create.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(defId).toBe('line_item')
    expect(options).toEqual({ absorbInto: INVOICE_RECORD_ID })
    expect(options).not.toHaveProperty('skipEvents')
  })

  it('still stamps the invoice link on the copy', async () => {
    const handler = fakeHandler()

    await copyLineOntoInvoice({
      handler: handler as never,
      fieldValueService: {} as never,
      lineCf: {} as never,
      lineFieldIds: [],
      lineInstanceId: 'line_1',
      invoiceRecordId: INVOICE_RECORD_ID,
      extraValues: { line_item_visit_id: 'visit_1' },
    })

    const [, values] = handler.create.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(values.line_item_invoice).toBe(INVOICE_RECORD_ID)
    expect(values.line_item_visit_id).toBe('visit_1')
  })
})
