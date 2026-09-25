// apps/web/src/components/manufacturing/ui/settings/opening-stock-list.test.tsx

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OpeningStockRow } from '../../hooks/use-opening-stock'

vi.mock('~/trpc/react', () => ({ api: {} }))
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }))
vi.mock('~/components/fields/inputs/field-input-adapter', () => ({
  FieldInputAdapter: ({ value }: { value: unknown }) => (
    <input readOnly value={value == null ? '' : String(value)} />
  ),
}))
vi.mock('~/components/resources/ui/record-badge', () => ({
  RecordBadge: ({ recordId }: { recordId: string }) => <span>{recordId}</span>,
}))
vi.mock('~/components/global/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('~/components/list-selection', () => ({
  useBulkMode: () => false,
  useIsPending: () => false,
  useIsSelected: () => false,
  usePendingLabel: () => '',
  useListSelection: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ toggle: vi.fn(), setItemIds: vi.fn() }),
}))
vi.mock('@auxx/ui/components/tree-row', () => ({
  GridTreeRow: ({ title, cells }: { title: ReactNode; cells?: ReactNode[] }) => (
    <div data-testid='row'>
      {title}
      {cells}
    </div>
  ),
}))

import { formatDelta, OpeningStockList } from './opening-stock-list'

function row(overrides: Partial<OpeningStockRow> = {}): OpeningStockRow {
  return {
    partId: 'lift',
    recordId: null,
    title: 'Attic Lift',
    sku: 'AL-1',
    storedKind: 'finished_good',
    kind: 'finished_good',
    kindIsUnconfirmed: false,
    accountLabel: '1330 Finished Goods',
    accountCode: '1330',
    accountRole: 'inventory_finished_goods',
    isUnclassified: false,
    standardCost: 34696,
    quantity: 42,
    unitCost: null,
    date: '2026-09-25T00:00:00.000Z',
    hasOwnDate: false,
    state: 'uncounted',
    netToday: -830,
    hasBom: false,
    unbuiltSales: 0,
    earliest: new Date('2024-10-01T00:00:00.000Z'),
    delta: 872,
    ...overrides,
  }
}

function renderList(rows: OpeningStockRow[], onBackflush = vi.fn()) {
  render(
    <OpeningStockList
      rows={rows}
      counts={{
        all: rows.length,
        notCounted: 0,
        counted: 0,
        uncounted: 0,
        unclassified: 0,
        uncosted: 0,
      }}
      kindCounts={new Map()}
      isLoading={false}
      currencyCode='USD'
      bulkMode={false}
      onBulkModeChange={vi.fn()}
      canSetKind
      isSettingKind={false}
      onSetKind={vi.fn(async () => {})}
      onQuantityChange={vi.fn()}
      onUnitCostChange={vi.fn()}
      onDateChange={vi.fn()}
      onBackflush={onBackflush}
    />
  )
  return { onBackflush }
}

describe('OpeningStockList', () => {
  it('shows the delta the row writes and whether it is a first count', () => {
    renderList([row()])
    expect(screen.getByTestId('on-hand').textContent).toBe('-830')
    expect(screen.getByTestId('delta').textContent).toBe('+872first count')
  })

  it('labels an anchored part as an adjustment', () => {
    renderList([row({ state: 'counted', netToday: 40, delta: 2 })])
    expect(screen.getByTestId('delta').textContent).toBe('+2adjusts')
    expect(screen.getByText('Counted')).toBeTruthy()
  })

  it('shows the Q25 banner only for a BOM part with unbuilt sales', () => {
    const { onBackflush } = renderList([
      row({ partId: 'lift', hasBom: true, unbuiltSales: 830 }),
      row({ partId: 'motor', title: 'Motor', hasBom: false, unbuiltSales: 0, netToday: -830 }),
      row({ partId: 'frame', title: 'Frame', hasBom: true, unbuiltSales: 0, netToday: 12 }),
    ])
    expect(screen.getAllByText(/unbuilt sales/)).toHaveLength(1)
    fireEvent.click(screen.getByText('Backflush past sales'))
    expect(onBackflush).toHaveBeenCalledWith(expect.objectContaining({ partId: 'lift' }))
  })
})

describe('formatDelta', () => {
  it('signs the number and dashes the unknown', () => {
    expect(formatDelta(3)).toBe('+3')
    expect(formatDelta(-2.5)).toBe('−2.5')
    expect(formatDelta(0)).toBe('0')
    expect(formatDelta(null)).toBe('–')
  })
})
