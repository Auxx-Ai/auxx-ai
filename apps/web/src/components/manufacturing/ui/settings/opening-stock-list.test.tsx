// apps/web/src/components/manufacturing/ui/settings/opening-stock-list.test.tsx

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OpeningStockRow } from '../../hooks/use-opening-stock'

vi.mock('~/trpc/react', () => ({ api: {} }))
const queryState = vi.hoisted(() => ({ filter: null as string | null }))
vi.mock('nuqs', () => ({
  useQueryState: (key: string) => [key === 'filter' ? queryState.filter : null, vi.fn()],
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
    standardCost: 34696,
    kindWarning: null,
    quantity: 42,
    date: '2026-09-25T00:00:00.000Z',
    state: 'uncounted',
    netToday: -830,
    hasBom: false,
    unbuiltSales: 0,
    built: 0,
    earliest: new Date('2024-10-01T00:00:00.000Z'),
    delta: 872,
    ...overrides,
  }
}

function renderList(rows: OpeningStockRow[]) {
  render(
    <OpeningStockList
      rows={rows}
      counts={{
        all: rows.length,
        notCounted: 0,
        counted: 0,
        uncounted: 0,
        unbuilt: 0,
      }}
      isLoading={false}
      canSelect
      onQuantityChange={vi.fn()}
    />
  )
}

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

  it('labels a counted part as a recount', () => {
    renderList([row({ state: 'counted', netToday: 40, delta: 2 })])
    expect(screen.getByTestId('delta').textContent).toBe('+2recount')
    expect(screen.getByText('Counted')).toBeTruthy()
  })

  it('marks a part with no cost yet, and none with one', () => {
    renderList([row({ partId: 'a', standardCost: null }), row({ partId: 'b' })])
    expect(screen.getAllByText('No cost')).toHaveLength(1)
  })

  it('flags a part whose kind step 1 still lists, linking to it', () => {
    renderList([row({ partId: 'a', kindWarning: 'Used inside Lift, but marked Finished Good.' })])
    expect(screen.getByTestId('kind-warning').getAttribute('href')).toBe(
      '/app/inventory/setup?step=kinds'
    )
  })

  it('has no backflush banner for made parts with unbuilt sales', () => {
    renderList([row({ partId: 'lift', hasBom: true, unbuiltSales: 830 })])
    expect(screen.queryByText(/Backflush/)).toBeNull()
  })

  it('opens on the filter a link names', () => {
    queryState.filter = 'counted'
    try {
      renderList([
        row({ partId: 'counted', title: 'Counted part', state: 'counted' }),
        row({ partId: 'open', title: 'Open' }),
      ])
      expect(screen.queryByText('Open')).toBeNull()
      expect(screen.getByText('Counted part')).toBeTruthy()
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
