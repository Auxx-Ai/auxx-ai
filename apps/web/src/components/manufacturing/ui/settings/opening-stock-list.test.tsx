// apps/web/src/components/manufacturing/ui/settings/opening-stock-list.test.tsx

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OpeningStockRow } from '../../hooks/use-opening-stock'

vi.mock('~/trpc/react', () => ({ api: {} }))
const queryState = vi.hoisted(() => ({ filter: null as string | null }))
vi.mock('nuqs', () => ({
  useQueryState: (key: string) => [key === 'filter' ? queryState.filter : null, vi.fn()],
}))
vi.mock('~/components/resources/utils/get-record-link', () => ({
  useRecordLink: (recordId: string | null) => (recordId ? `/app/records/${recordId}` : null),
}))
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
  SelectAllCheckbox: () => null,
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
    standardSource: null,
    standardOrigin: null,
    quantity: 42,
    unitCost: 34696,
    unitCostSuggested: false,
    unitCostTyped: false,
    suggestion: null,
    sendsUnitCost: false,
    date: '2026-09-25T00:00:00.000Z',
    state: 'uncounted',
    netToday: -830,
    hasBom: false,
    uncostedLeafCount: 0,
    usedIn: 0,
    unbuiltSales: 0,
    built: 0,
    earliest: new Date('2024-10-01T00:00:00.000Z'),
    delta: 872,
    ...overrides,
  }
}

function renderList(rows: OpeningStockRow[], onUseSuggestions = vi.fn()) {
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
        uncostedOrProvisional: 0,
        unbuilt: 0,
      }}
      kindCounts={new Map()}
      isLoading={false}
      currencyCode='USD'
      canSetKind
      isSettingKind={false}
      onSetKind={vi.fn(async () => {})}
      onQuantityChange={vi.fn()}
      onUnitCostChange={vi.fn()}
      onUseSuggestions={onUseSuggestions}
    />
  )
  return { onUseSuggestions }
}

const suggestion = { source: 'supplier', unitCost: 1250, other: null } as const

describe('OpeningStockList', () => {
  it('shows the change the row writes and whether it is a first count', () => {
    renderList([row()])
    expect(screen.getByTestId('on-hand').textContent).toBe('-830')
    expect(screen.getByTestId('delta').textContent).toBe('+872first count')
  })

  it("reads a never-counted bought part's negative as never received, grouped", () => {
    renderList([row({ netToday: -12756, delta: 13156 })])
    expect(screen.getByTestId('on-hand').textContent).toBe('-12,756')
    expect(screen.getByTestId('on-hand-note').textContent).toBe('never received')
  })

  it('shows what a never-counted made part built instead of reading its 0 as empty', () => {
    renderList([row({ hasBom: true, netToday: 0, built: 1955, delta: 42 })])
    expect(screen.getByTestId('on-hand').textContent).toBe('0')
    expect(screen.getByTestId('on-hand-note').textContent).toBe('1,955 built')
  })

  it('drops the note once a part is counted', () => {
    renderList([row({ state: 'counted', netToday: -5, delta: 47 })])
    expect(screen.queryByTestId('on-hand-note')).toBeNull()
  })

  it('labels a counted part as a correction', () => {
    renderList([row({ state: 'counted', netToday: 40, delta: 2 })])
    expect(screen.getByTestId('delta').textContent).toBe('+2correction')
    expect(screen.getByText('Counted')).toBeTruthy()
  })

  it('shows an existing standard read-only with a link to change it on the part', () => {
    renderList([row({ recordId: 'def:lift' as OpeningStockRow['recordId'] })])
    const cell = screen.getByTestId('standard-cost')
    expect(cell.textContent).toContain('$346.96')
    expect(screen.getByText('change on the part').getAttribute('href')).toBe(
      '/app/records/def:lift'
    )
  })

  it('has no backflush banner for made parts with unbuilt sales', () => {
    renderList([row({ partId: 'lift', hasBom: true, unbuiltSales: 830 })])
    expect(screen.queryByText(/Backflush/)).toBeNull()
  })

  it('offers "Use suggestions" for every uncosted row still on its suggestion', () => {
    const { onUseSuggestions } = renderList([
      row({ partId: 'a', standardCost: null, unitCost: 1250, unitCostSuggested: true, suggestion }),
      row({ partId: 'b', standardCost: null, unitCost: 900, unitCostTyped: true, suggestion }),
      row({ partId: 'c' }),
    ])
    fireEvent.click(screen.getByText('Use suggestions'))
    expect(onUseSuggestions).toHaveBeenCalledWith(['a'])
  })

  it('opens on the filter a link names', () => {
    queryState.filter = 'uncosted'
    try {
      renderList([
        row({ partId: 'costed', title: 'Costed' }),
        row({ partId: 'open', title: 'Open', standardCost: null }),
      ])
      expect(screen.queryByText('Costed')).toBeNull()
      expect(screen.getByText('Open')).toBeTruthy()
    } finally {
      queryState.filter = null
    }
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
