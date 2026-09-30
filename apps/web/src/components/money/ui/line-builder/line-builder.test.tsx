// apps/web/src/components/money/ui/line-builder/line-builder.test.tsx

import type { Line } from '@auxx/lib/accounting/documents/lines/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LineBuilder } from './line-builder'

const state = vi.hoisted(() => ({
  lines: [] as unknown[],
  resolveCreate: (_lines: unknown[]) => {},
  writes: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async () => []),
    reorder: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@auxx/ui/components/toast', () => ({ toastError: vi.fn() }))
vi.mock('~/trpc/react', () => ({
  api: { lines: { list: { useQuery: () => ({ data: state.lines, isLoading: false }) } } },
}))
vi.mock('./lines-cache', () => ({
  useLinesSync: () => {},
  useLineWrites: () => state.writes,
}))
vi.mock('./totals-footer', () => ({ TotalsFooter: () => null }))
vi.mock('./catalog-picker', () => ({ CatalogPicker: () => null }))
vi.mock('~/components/resources', async () => {
  const { parseRecordId, toRecordId } = await import('@auxx/lib/resources/client')
  return {
    parseRecordId,
    toRecordId,
    useResource: () => ({ resource: { id: 'def_line' } }),
    useResourceFields: () => ({ fields: [] }),
  }
})
vi.mock('~/components/resources/store/resource-store', () => {
  const storeState = { resourceMap: new Map() }
  const useResourceStore = (select: (s: typeof storeState) => unknown) => select(storeState)
  useResourceStore.getState = () => storeState
  useResourceStore.subscribe = () => () => {}
  return { useResourceStore }
})
vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: () => ({ values: {}, isLoading: false }),
}))
vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({ saveFieldValue: vi.fn(), saveMultipleAsync: vi.fn() }),
}))
vi.mock('~/components/money/hooks/use-catalog-parts', () => ({
  useCatalogParts: () => ({ parts: [], partMap: new Map(), isLoading: false }),
}))
vi.mock('~/components/money/hooks/use-catalog-groups', () => ({
  useCatalogGroups: () => ({ groups: [], isLoading: false }),
}))
vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => null }) }))

function createdLine(overrides: Partial<Line>): Line {
  return {
    id: 'line_1',
    documentType: 'quote',
    documentId: 'q1',
    sortOrder: 0,
    name: null,
    description: null,
    category: null,
    unit: null,
    qty: 1,
    unitPrice: null,
    discount: null,
    taxable: true,
    lineTotal: null,
    netTotal: null,
    taxTotal: null,
    optional: null,
    optionalSelected: null,
    partId: null,
    visitId: null,
    sourceLineId: null,
    fulfilledAt: null,
    fulfilledQty: null,
    shipmentCount: null,
    sourceLineItemId: null,
    disposition: null,
    vendorPartId: null,
    quantityReceived: null,
    quantityBilled: null,
    weight: null,
    glAccountId: null,
    landedBillId: null,
    purchaseOrderLineId: null,
    vendorCode: null,
    returnsStock: null,
    ...overrides,
  }
}

function cellInput(container: HTMLElement, row: number, col: number): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `[data-line-row="${row}"][data-line-col="${col}"] input`
  )
  if (!input) throw new Error(`no input at row ${row}, col ${col}`)
  return input
}

describe('LineBuilder draft → line', () => {
  beforeEach(() => {
    state.lines = []
    state.writes.create.mockImplementation(
      () => new Promise((resolve) => (state.resolveCreate = resolve))
    )
  })

  it('keeps the typed-in row mounted through the create and commits its text to the line', async () => {
    const { container } = render(
      <TooltipProvider>
        <LineBuilder documentRecordId='def_quote:q1' documentType='quote' />
      </TooltipProvider>
    )

    // The rate commit creates the line; qty is typed while that create is in flight.
    const price = cellInput(container, 0, 2)
    fireEvent.focus(price)
    fireEvent.change(price, { target: { value: '5' } })
    fireEvent.blur(price)
    expect(state.writes.create).toHaveBeenCalledTimes(1)

    const qty = cellInput(container, 0, 1)
    fireEvent.focus(qty)
    fireEvent.change(qty, { target: { value: '3' } })

    await act(async () => {
      const line = createdLine({ unitPrice: 500 })
      state.lines = [line]
      state.resolveCreate([line])
    })

    expect(qty.isConnected).toBe(true)
    expect(cellInput(container, 0, 1)).toBe(qty)
    expect(qty.value).toBe('3')

    fireEvent.blur(qty)
    expect(state.writes.update).toHaveBeenCalledWith('line_1', { qty: 3 })
    expect(state.writes.create).toHaveBeenCalledTimes(1)
  })
})
