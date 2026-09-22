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

/** The summary rows `exportBatches.summaryRows` hands the panel, swapped per test. */
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('~/providers/capabilities-provider', () => ({ useAccess: () => ({ can: () => true }) }))
vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => false }) }))
vi.mock('~/hooks/use-confirm', () => ({ useConfirm: () => [vi.fn(), () => null] }))
vi.mock('./rail-badge', () => ({ RailBadge: () => null }))
vi.mock('./use-outbox-realtime', () => ({
  useOutboxRealtime: () => ({ run: null, startRun: vi.fn(), watchRun: vi.fn(() => vi.fn()) }),
}))
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
    title,
    description,
    actions,
    expandable,
    isOpen,
    onToggleOpen,
    children,
  }: {
    title?: ReactNode
    description?: string
    actions?: ReactNode
    expandable?: boolean
    isOpen?: boolean
    onToggleOpen?: () => void
    children?: ReactNode
  }) => (
    <div>
      <span>{title}</span>
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
          exportBatches: { list: { invalidate: vi.fn() }, summaryRows: { invalidate: vi.fn() } },
          listExportPostings: { invalidate: vi.fn() },
          outboxCounts: { invalidate: vi.fn() },
        },
      }),
      ledger: {
        roleMap: { useQuery: () => ({ data: { sources: [] }, isPending: false }) },
        listExportPostings: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: [], nextCursor: undefined }] },
            isPending: false,
            isError: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
          }),
        },
        outboxCounts: {
          useQuery: () => ({
            data: { drafts: 2, blocked: 2, ready: 2, sending: 0, sent: 1, failed: 1 },
          }),
        },
        exportBatches: {
          summaryRows: {
            useInfiniteQuery: () => ({
              data: {
                pages: [{ items: state.rows, total: state.rows.length, nextCursor: undefined }],
              },
              isPending: false,
              isError: false,
              hasNextPage: false,
              isFetchingNextPage: false,
              fetchNextPage: vi.fn(),
            }),
          },
          unbuiltMembers: { useQuery: () => ({ data: [], isPending: false }) },
          send: { useMutation: noMutation },
          sendBucket: { useMutation: noMutation },
          rebuildBucket: { useMutation: noMutation },
          retry: { useMutation: noMutation },
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
vi.mock('./summary-panel', () => ({
  SummaryPanel: (props: Parameters<typeof Panel>[0]) => <Panel {...props} />,
}))

import { OutboxPanel } from './outbox-panel'

const props = {
  onTabChange: vi.fn(),
  view: 'summary' as const,
  onViewChange: vi.fn(),
  bookTimeZone: 'UTC',
  currencyCode: 'USD',
  providerLabel: 'Provider',
  activePostingId: null,
  onSelectPosting: vi.fn(),
  activeMovementId: null,
  onSelectMovement: vi.fn(),
  activeShipmentId: null,
  onSelectShipment: vi.fn(),
}

describe('Outbox category filters', () => {
  it('supports multiple categories, clears selection, and keeps them across every tab', async () => {
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
    // One vocabulary: a filter picked on Ready still means the same thing on Blocked.
    view.rerender(<OutboxPanel {...props} tab='blocked' />)
    expect(screen.getByTestId('categories').textContent).toBe('fulfillment,payout')
    // The picker is still open: the toolbar is not remounted per tab any more.
    expect(screen.getByLabelText('Vendor payment')).toBeDefined()
    expect(screen.getByLabelText('Fulfillment')).toBeDefined()
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
    dayKey: '2026-09',
    providerObjectId: null,
    providerObjectUrl: null,
    nextAttemptAt: null,
    sentAt: null,
    members: [],
    ...overrides,
  }
}

/** One `SummaryRow` holding `batchRow` (or none); status follows the batch unless given. */
function summaryRow(
  batchRow: ReturnType<typeof batch> | null,
  overrides: Record<string, unknown> = {}
) {
  const newCount = (overrides.newCount as number | undefined) ?? (batchRow ? 0 : 2)
  const status = !batchRow
    ? 'not_sent'
    : batchRow.state === 'sent' && newCount > 0
      ? 'sent_new'
      : batchRow.state
  return {
    key: `manual ${(overrides.grainKey as string | undefined) ?? '2026-09'} USD`,
    avenue: 'manual',
    grainKey: '2026-09',
    storeId: null,
    railId: null,
    currency: 'USD',
    dayKey: '2026-09',
    totalMinor: 1000,
    memberCount: 2,
    newCount,
    txnDateFrom: '2026-09-01',
    txnDateTo: '2026-09-30',
    firstPostingId: 'p1',
    status,
    batch: batchRow,
    ...overrides,
  }
}

const panelProps = {
  filters: { search: '', from: '', to: '', categories: [] as string[] },
  order: 'desc' as const,
  groupBy: null,
  emptyTitle: 'Nothing here',
  emptyDescription: 'Nothing here',
  bookTimeZone: 'UTC',
  providerLabel: 'QuickBooks',
  canRelease: true,
  canRollback: true,
  activePostingId: null,
  onSelectPosting: vi.fn(),
  watchRun: vi.fn(() => vi.fn()),
}

async function renderSummary(tab: 'ready' | 'sent' | 'failed', groupBy: 'day' | null = null) {
  // The real panel, past this file's own `./summary-panel` mock.
  const { SummaryPanel } =
    await vi.importActual<typeof import('./summary-panel')>('./summary-panel')
  return render(
    <TooltipProvider>
      <ListSelectionProvider>
        <SummaryPanel {...panelProps} tab={tab} groupBy={groupBy} />
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
    state.rows = [
      summaryRow(
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
        })
      ),
    ]
    await renderSummary('failed')
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
    state.rows = [summaryRow(batch({ failureClass: null, failureItems: [] }))]
    await renderSummary('failed')

    expect(screen.getByTestId('row-description').textContent).toBe(
      'Shopify Payments Bank is not mapped to a QuickBooks account.'
    )
    expect(screen.queryByText('The provider refused this batch')).toBeNull()
  })

  it('blocks Send now on a ready batch the mapping table already refuses', async () => {
    state.rows = [
      summaryRow(
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
        })
      ),
    ]
    await renderSummary('ready')
    expand()

    expect(screen.getByText('This batch cannot be sent yet')).toBeDefined()
    expect(screen.getByText('5010 COGS - Direct Labor')).toBeDefined()
    const send = screen.getByLabelText('Map the accounts first')
    expect(send.hasAttribute('disabled')).toBe(true)
  })

  it('replaces the card with a one-line note once every account it named is mapped', async () => {
    state.rows = [
      summaryRow(
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
        })
      ),
    ]
    await renderSummary('failed')
    expand()

    expect(
      screen.getByText('Every account this batch named is mapped now. Retry to send it.')
    ).toBeDefined()
    expect(screen.queryByText('The provider refused this batch')).toBeNull()
    expect(screen.queryByText('5010 COGS - Direct Labor')).toBeNull()
  })

  it('keeps only the items the mapping table still refuses', async () => {
    state.rows = [
      summaryRow(
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
        })
      ),
    ]
    await renderSummary('failed')
    expand()

    expect(screen.getByText('1310 Inventory Asset')).toBeDefined()
    expect(screen.queryByText('5010 COGS - Direct Labor')).toBeNull()
    expect(screen.getByText('The provider refused this batch')).toBeDefined()
  })
})

describe('Summary rows (95 §3.2)', () => {
  it('offers Send on a bucket no batch holds yet', async () => {
    state.rows = [summaryRow(null)]
    await renderSummary('ready')

    expect(screen.getByText('Not sent')).toBeDefined()
    expect(screen.getByLabelText('Send now to QuickBooks').hasAttribute('disabled')).toBe(false)
  })

  it('offers Rebuild beside Roll back once postings land after the send', async () => {
    state.rows = [summaryRow(batch({ state: 'sent', lastError: null }), { newCount: 3 })]
    await renderSummary('sent')

    expect(screen.getByText('3 new')).toBeDefined()
    expect(screen.getByLabelText('Rebuild with the 3 new')).toBeDefined()
    expect(screen.getByLabelText('Roll back from QuickBooks')).toBeDefined()
  })

  it('does not offer Rebuild on a sent bucket with nothing new', async () => {
    state.rows = [summaryRow(batch({ state: 'sent', lastError: null }))]
    await renderSummary('sent')

    expect(screen.queryByLabelText(/^Rebuild/)).toBeNull()
    expect(screen.getByLabelText('Roll back from QuickBooks')).toBeDefined()
  })

  it('puts a day header over the rows that share a day', async () => {
    state.rows = [
      summaryRow(null, { key: 'a', dayKey: '2026-09-02', grainKey: '2026-09-02' }),
      summaryRow(null, {
        key: 'b',
        dayKey: '2026-09-02',
        grainKey: '2026-09-02',
        avenue: 'payout',
      }),
      summaryRow(null, { key: 'c', dayKey: '2026-09-01', grainKey: '2026-09-01' }),
    ]
    await renderSummary('ready', 'day')

    expect(screen.getAllByLabelText(/^Select every row of/)).toHaveLength(2)
    expect(screen.getByText('2 summaries')).toBeDefined()
    expect(screen.getByText('1 summary')).toBeDefined()
  })
})

describe('Outbox view dropdown', () => {
  it('switches the batch tabs between Summary and Transaction rows', async () => {
    const onViewChange = vi.fn()
    const view = render(<OutboxPanel {...props} tab='ready' onViewChange={onViewChange} />)
    expect(screen.getByTestId('empty-title')).toBeDefined()

    const trigger = screen.getByRole('button', { name: 'View: Summary' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Transaction' }))
    expect(onViewChange).toHaveBeenCalledWith('transaction')

    view.rerender(<OutboxPanel {...props} tab='ready' view='transaction' />)
    // The real Transaction panel, empty: the tab's own copy, not the summary stub.
    expect(screen.queryByTestId('empty-title')).toBeNull()
    expect(screen.getByText('Nothing is waiting to be sent')).toBeDefined()
  })

  it('is not offered on Drafts', () => {
    render(<OutboxPanel {...props} tab='drafts' />)
    expect(screen.queryByRole('button', { name: /^View:/ })).toBeNull()
  })

  it('follows the export mode when the URL names no view', () => {
    render(<OutboxPanel {...props} tab='sent' view={null} />)
    expect(screen.getByRole('button', { name: 'View: Transaction' })).toBeDefined()
  })
})
