// apps/web/src/components/accounting/ui/ledger/outbox/transactions-panel.test.tsx
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ListSelectionProvider } from '~/components/list-selection'

/** The postings `ledger.listExportPostings` hands the panel, and the org's export mode. */
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  exportMode: 'transaction' as 'transaction' | 'summary',
}))

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('~/providers/capabilities-provider', () => ({ useAccess: () => ({ can: () => true }) }))
vi.mock('~/hooks/use-settings', () => ({
  useSettings: () => ({
    getSetting: (key: string) => (key === 'accounting.exportMode' ? state.exportMode : false),
  }),
}))
vi.mock('~/hooks/use-confirm', () => ({ useConfirm: () => [vi.fn(), () => null] }))
vi.mock('./posting-links', () => ({ BADGE_ROW_CLASS: '', PostingLinks: () => null }))
vi.mock('@auxx/ui/components/tree-row', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/ui/components/tree-row')>()),
  TreeRowButton: ({
    tooltipText,
    children,
    onClick,
  }: {
    tooltipText?: string
    children?: ReactNode
    onClick?: () => void
  }) => (
    <button type='button' aria-label={tooltipText} onClick={onClick}>
      {children}
    </button>
  ),
}))
vi.mock('./outbox-row', () => ({
  OutboxRow: ({ title, actions }: { title?: ReactNode; actions?: ReactNode }) => (
    <div>
      <span>{title}</span>
      {actions}
    </div>
  ),
}))

vi.mock('~/trpc/react', () => {
  const noMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    api: {
      useUtils: () => ({
        ledger: {
          listExportPostings: { invalidate: vi.fn() },
          exportBatches: { list: { invalidate: vi.fn() }, summaryRows: { invalidate: vi.fn() } },
          outboxCounts: { invalidate: vi.fn() },
        },
      }),
      ledger: {
        listExportPostings: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: state.rows, nextCursor: undefined }] },
            isPending: false,
            isError: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
          }),
        },
        exportBatches: {
          send: { useMutation: noMutation },
          retry: { useMutation: noMutation },
          rollback: { useMutation: noMutation },
        },
      },
    },
  }
})

import { TransactionsPanel } from './transactions-panel'

/** One `PostingListRow`, with only the fields the panel reads. */
function posting(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    postingType: 'manual_journal',
    periodKey: '2026-09',
    txnDate: '2026-09-01',
    docNumber: `JNL-${id}`,
    status: 'posted',
    revision: 1,
    reversesId: null,
    totalMinor: 1000,
    memo: null,
    postedAt: null,
    exportState: null,
    ...overrides,
  }
}

function renderPanel(tab: 'ready' | 'sent' | 'failed', groupBy: 'day' | null = null) {
  return render(
    <TooltipProvider>
      <ListSelectionProvider>
        <TransactionsPanel
          tab={tab}
          filters={{ search: '', from: '', to: '', categories: [] }}
          order='desc'
          groupBy={groupBy}
          bookTimeZone='UTC'
          currencyCode='USD'
          activePostingId={null}
          onSelectPosting={vi.fn()}
          emptyTitle='Nothing here'
          emptyDescription='Nothing here'
        />
      </ListSelectionProvider>
    </TooltipProvider>
  )
}

beforeEach(() => {
  state.exportMode = 'transaction'
})

describe('Transaction view rows', () => {
  it('shows each posting with its export state, silent where it restates the tab', () => {
    state.rows = [
      posting('1'),
      posting('2', { exportState: { state: 'ready', batchId: 'b2', docNumber: 'EXP-2' } }),
      posting('3', { exportState: { state: 'sending', batchId: 'b3', docNumber: null } }),
    ]
    renderPanel('ready')

    expect(screen.getByText('JNL-1')).toBeDefined()
    expect(screen.getByText('Not sent')).toBeDefined()
    expect(screen.getByText('EXP-2')).toBeDefined()
    expect(screen.getByText('Sending')).toBeDefined()
    expect(screen.queryByText('Ready')).toBeNull()
  })

  it('heads each day with its count and total when grouped by day', () => {
    state.rows = [
      posting('1', { txnDate: '2026-09-02' }),
      posting('2', { txnDate: '2026-09-02' }),
      posting('3', { txnDate: '2026-09-01' }),
    ]
    renderPanel('ready', 'day')

    expect(screen.getAllByLabelText(/^Select every row of/)).toHaveLength(2)
    expect(screen.getByText('2 postings')).toBeDefined()
    expect(screen.getByText('1 posting')).toBeDefined()
  })
})

describe('Transaction view actions follow the export mode', () => {
  const rows = () => [
    posting('1', { exportState: { state: 'ready', batchId: 'b1', docNumber: null } }),
    posting('2'),
  ]

  it('offers Send on a ready posting in transaction mode, nothing on an unbatched one', () => {
    state.rows = rows()
    renderPanel('ready')
    expect(screen.getAllByRole('button', { name: 'Send now' })).toHaveLength(1)
  })

  it('offers no export action in summary mode', () => {
    state.exportMode = 'summary'
    state.rows = [
      ...rows(),
      posting('3', { exportState: { state: 'failed', batchId: 'b3', docNumber: null } }),
    ]
    renderPanel('ready')
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
  })
})
