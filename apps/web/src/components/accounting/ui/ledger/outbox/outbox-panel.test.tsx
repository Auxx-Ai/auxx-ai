// apps/web/src/components/accounting/ui/ledger/outbox/outbox-panel.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useListSelection, useSelectionIds } from '~/components/list-selection'

vi.mock('~/providers/capabilities-provider', () => ({ useAccess: () => ({ can: () => true }) }))
vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => false }) }))
vi.mock('~/trpc/react', () => ({
  api: {
    ledger: {
      outboxCounts: {
        useQuery: () => ({
          data: { drafts: 2, blocked: 2, ready: 2, sending: 0, sent: 1, failed: 1 },
        }),
      },
    },
  },
}))
vi.mock('~/components/pickers/multi-select-picker', () => ({
  MultiSelectPicker: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[]
    value: string[]
    onChange: (value: string[]) => void
  }) => (
    <div>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type='checkbox'
            checked={value.includes(option.value)}
            onChange={() =>
              onChange(
                value.includes(option.value)
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value]
              )
            }
          />
          {option.label}
        </label>
      ))}
    </div>
  ),
}))

function Panel({
  filters,
  emptyTitle,
}: {
  filters: { categories: string[]; search: string }
  emptyTitle?: string
}) {
  const setItemIds = useListSelection((state) => state.setItemIds)
  const selected = useSelectionIds()
  useEffect(() => {
    setItemIds(['a', 'b'])
  }, [setItemIds])
  return (
    <>
      <output data-testid='categories'>{filters.categories.join(',')}</output>
      <output data-testid='search'>{filters.search}</output>
      <output data-testid='selected'>{selected.length}</output>
      <output data-testid='empty-title'>{emptyTitle}</output>
    </>
  )
}
vi.mock('./drafts-panel', () => ({
  DraftsPanel: (props: Parameters<typeof Panel>[0]) => <Panel {...props} />,
}))
vi.mock('./blocked-panel', () => ({
  BlockedPanel: (props: Parameters<typeof Panel>[0]) => <Panel {...props} />,
}))
vi.mock('./batches-panel', () => ({
  BatchesPanel: (props: Parameters<typeof Panel>[0]) => <Panel {...props} />,
}))

import { OutboxPanel } from './outbox-panel'

const props = {
  onTabChange: vi.fn(),
  buildMonthLabel: 'February',
  bookTimeZone: 'UTC',
  currencyCode: 'USD',
  connectedTenantId: null,
  providerLabel: 'Provider',
  activePostingId: null,
  onSelectPosting: vi.fn(),
  activeMovementId: null,
  onSelectMovement: vi.fn(),
}

describe('Outbox category filters', () => {
  it('supports multiple categories, clears selection, and resets across record families', async () => {
    const view = render(<OutboxPanel {...props} tab='ready' />)
    fireEvent.click(screen.getByLabelText('Select everything listed'))
    expect(screen.getByTestId('selected').textContent).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: 'Category, all categories' }))
    fireEvent.click(screen.getByLabelText('Fulfillment'))
    fireEvent.click(screen.getByLabelText('Payout'))
    expect(screen.getByTestId('categories').textContent).toBe('fulfillment,payout')
    expect(screen.getByTestId('selected').textContent).toBe('0')
    view.rerender(<OutboxPanel {...props} tab='sent' />)
    expect(screen.getByTestId('categories').textContent).toBe('fulfillment,payout')
    view.rerender(<OutboxPanel {...props} tab='blocked' />)
    expect(screen.getByTestId('categories').textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Category, all categories' }))
    expect(screen.getByLabelText('Customer payment')).toBeDefined()
    expect(screen.queryByLabelText('Fulfillment')).toBeNull()
    fireEvent.click(screen.getByLabelText('Customer payment'))
    fireEvent.click(screen.getByRole('button', { name: 'All categories' }))
    expect(screen.getByTestId('categories').textContent).toBe('')
  })

  it('debounces search, prevents selection of old results, and clears filters', async () => {
    render(<OutboxPanel {...props} tab='drafts' />)
    fireEvent.click(screen.getByLabelText('Select everything listed'))
    fireEvent.change(screen.getByPlaceholderText('Search outbox'), { target: { value: 'invoice' } })
    expect(screen.getByRole('status').textContent).toBe('Searching…')
    expect(screen.getByLabelText('Select everything listed').hasAttribute('disabled')).toBe(true)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('invoice'))
    expect(screen.getByTestId('selected').textContent).toBe('0')
    expect(screen.getByTestId('empty-title').textContent).toBe('No matching results')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  })
})
