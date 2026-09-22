// apps/web/src/components/accounting/ui/ledger/outbox/outbox-panel.test.tsx
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ComponentProps, type ReactNode, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ListSelectionProvider,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'

/** The batch rows `exportBatches.list` hands the panel, swapped per test. */
const state = vi.hoisted(() => ({ batches: [] as Record<string, unknown>[] }))

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('~/providers/capabilities-provider', () => ({ useAccess: () => ({ can: () => true }) }))
vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => false }) }))
vi.mock('~/hooks/use-confirm', () => ({ useConfirm: () => [vi.fn(), () => null] }))
// Only `tooltipText` names a `TreeRowButton`, so the mock lends it to the
// accessible name - the rest of the tree primitives stay real.
vi.mock('@auxx/ui/components/tree-row', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/ui/components/tree-row')>()),
  TreeRowButton: ({
    tooltipText,
    disabled,
    children,
    onClick,
  }: {
    tooltipText?: string
    disabled?: boolean
    children?: ReactNode
    onClick?: () => void
  }) => (
    <button type='button' aria-label={tooltipText} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))
// The children are what the chevron reveals, so the stub keeps them behind
// `isOpen` exactly as `TreeRow` does.
vi.mock('./outbox-row', () => ({
  OutboxRow: ({
    description,
    actions,
    expandable,
    isOpen,
    onToggleOpen,
    children,
  }: {
    description?: string
    actions?: ReactNode
    expandable?: boolean
    isOpen?: boolean
    onToggleOpen?: () => void
    children?: ReactNode
  }) => (
    <div>
      {description && <p data-testid='row-description'>{description}</p>}
      {actions}
      {expandable && (
        <button type='button' aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={onToggleOpen}>
          chevron
        </button>
      )}
      {isOpen && children}
    </div>
  ),
}))

vi.mock('~/trpc/react', () => {
  const noMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    api: {
      useUtils: () => ({
        ledger: {
          exportBatches: { list: { invalidate: vi.fn() }, unbuilt: { invalidate: vi.fn() } },
          outboxCounts: { invalidate: vi.fn() },
        },
      }),
      ledger: {
        roleMap: { useQuery: () => ({ data: { sources: [] }, isPending: false }) },
        outboxCounts: {
          useQuery: () => ({
            data: { drafts: 2, blocked: 2, ready: 2, sending: 0, sent: 1, failed: 1 },
          }),
        },
        exportBatches: {
          list: {
            useInfiniteQuery: () => ({
              data: { pages: [{ items: state.batches, nextCursor: undefined }] },
              isPending: false,
              isError: false,
              hasNextPage: false,
              isFetchingNextPage: false,
              fetchNextPage: vi.fn(),
            }),
          },
          unbuilt: { useQuery: () => ({ data: [] }) },
          build: { useMutation: noMutation },
          send: { useMutation: noMutation },
          retry: { useMutation: noMutation },
          release: { useMutation: noMutation },
          rollback: { useMutation: noMutation },
        },
      },
    },
  }
})
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

/** One `ExportBatchRow`, with only the fields the panel reads. */
function batch(overrides: Record<string, unknown>) {
  return {
    id: 'b1',
    bookId: 'book-1',
    state: 'failed',
    mode: 'summary',
    avenue: 'manual',
    grainKey: '2026-09',
    storeId: null,
    railId: null,
    currency: 'USD',
    objectType: 'journal',
    totalMinor: 1000,
    docNumber: null,
    attempts: 1,
    lastError: 'Shopify Payments Bank is not mapped to a QuickBooks account.',
    failureClass: 'configuration',
    failureItems: [],
    blockers: [],
    providerObjectId: null,
    providerObjectUrl: null,
    nextAttemptAt: null,
    sentAt: null,
    members: [],
    ...overrides,
  }
}

const batchProps = {
  filters: { search: '', from: '', to: '', categories: [] as string[] },
  emptyTitle: 'Nothing here',
  emptyDescription: 'Nothing here',
  bookTimeZone: 'UTC',
  providerLabel: 'QuickBooks',
  canRelease: true,
  canRollback: true,
  activePostingId: null,
  onSelectPosting: vi.fn(),
}

async function renderBatches(tab: 'ready' | 'failed') {
  // The real panel, past this file's own `./batches-panel` mock.
  const { BatchesPanel } =
    await vi.importActual<typeof import('./batches-panel')>('./batches-panel')
  return render(
    <TooltipProvider>
      <ListSelectionProvider>
        <BatchesPanel {...batchProps} tab={tab} />
      </ListSelectionProvider>
    </TooltipProvider>
  )
}

/** The refusal is the row's children now, so it is behind the chevron. */
function expand() {
  fireEvent.click(screen.getByLabelText('Expand'))
}

describe('Failed and Ready batches refuse in one voice (89 D6, D7)', () => {
  it('renders one blocker row per failure item instead of the verbatim sentence', async () => {
    state.batches = [
      batch({
        failureItems: [
          {
            key: 'unmapped_account',
            ref: 'acct-1',
            label: '5010 COGS - Direct Labor',
            remedy: 'Pick the QuickBooks account this one is.',
          },
          {
            key: 'invalid_mapping',
            ref: 'acct-2',
            label: '1310 Inventory Asset',
            remedy: 'Pick it again - the one it named is gone.',
          },
        ],
        blockers: [
          {
            key: 'unmapped_account',
            ref: 'acct-1',
            label: '5010 COGS - Direct Labor',
            remedy: 'Pick the QuickBooks account this one is.',
          },
        ],
      }),
    ]
    await renderBatches('failed')
    expand()

    expect(screen.getByText('5010 COGS - Direct Labor')).toBeDefined()
    expect(screen.getByText('1310 Inventory Asset')).toBeDefined()
    // Each row carries its OWN destination, seeded with its own account.
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/app/accounting/settings/accounts?s=chart&account=acct-1',
      '/app/accounting/settings/accounts?s=chart&account=acct-2',
    ])
    expect(screen.queryByTestId('row-description')).toBeNull()
  })

  it('falls back to the provider sentence when the refusal has no items', async () => {
    state.batches = [batch({ failureClass: null, failureItems: [] })]
    await renderBatches('failed')

    expect(screen.getByTestId('row-description').textContent).toBe(
      'Shopify Payments Bank is not mapped to a QuickBooks account.'
    )
    expect(screen.queryByText('The provider refused this batch')).toBeNull()
  })

  it('blocks Send now on a ready batch the mapping table already refuses', async () => {
    state.batches = [
      batch({
        state: 'ready',
        lastError: null,
        failureClass: null,
        blockers: [
          {
            key: 'unmapped_account',
            ref: 'acct-1',
            label: '5010 COGS - Direct Labor',
            remedy: 'Pick the QuickBooks account this one is.',
          },
        ],
      }),
    ]
    await renderBatches('ready')
    expand()

    expect(screen.getByText('This batch cannot be sent yet')).toBeDefined()
    expect(screen.getByText('5010 COGS - Direct Labor')).toBeDefined()
    const send = screen.getByLabelText('Map the accounts first')
    expect(send.hasAttribute('disabled')).toBe(true)
  })

  it('replaces the card with a one-line note once every account it named is mapped', async () => {
    state.batches = [
      batch({
        failureItems: [
          {
            key: 'unmapped_account',
            ref: 'acct-1',
            label: '5010 COGS - Direct Labor',
            remedy: 'Pick the QuickBooks account this one is.',
          },
        ],
        blockers: [],
      }),
    ]
    await renderBatches('failed')
    expand()

    expect(
      screen.getByText('Every account this batch named is mapped now. Retry to send it.')
    ).toBeDefined()
    expect(screen.queryByText('The provider refused this batch')).toBeNull()
    expect(screen.queryByText('5010 COGS - Direct Labor')).toBeNull()
  })

  it('keeps only the items the mapping table still refuses', async () => {
    state.batches = [
      batch({
        failureItems: [
          {
            key: 'unmapped_account',
            ref: 'acct-1',
            label: '5010 COGS - Direct Labor',
            remedy: 'Pick the QuickBooks account this one is.',
          },
          {
            key: 'unmapped_account',
            ref: 'acct-2',
            label: '1310 Inventory Asset',
            remedy: 'Pick the QuickBooks account this one is.',
          },
        ],
        blockers: [
          {
            key: 'unmapped_account',
            ref: 'acct-2',
            label: '1310 Inventory Asset',
            remedy: 'Pick the QuickBooks account this one is.',
          },
        ],
      }),
    ]
    await renderBatches('failed')
    expand()

    expect(screen.getByText('1310 Inventory Asset')).toBeDefined()
    expect(screen.queryByText('5010 COGS - Direct Labor')).toBeNull()
    expect(screen.getByText('The provider refused this batch')).toBeDefined()
  })
})
