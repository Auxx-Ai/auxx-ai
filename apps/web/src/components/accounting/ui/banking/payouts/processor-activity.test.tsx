// apps/web/src/components/accounting/ui/banking/payouts/processor-activity.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  entries: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  isPending: false,
  nextPage: false,
  fetchNextPage: vi.fn(),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    payoutEvidence: {
      entries: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: state.entries }] },
          error: state.error,
          isPending: state.isPending,
          hasNextPage: state.nextPage,
          fetchNextPage: state.fetchNextPage,
        }),
      },
    },
  },
}))

import { ProcessorActivity } from './processor-activity'

/** `SourceAccountBadge` is a tooltip trigger; the app shell provides the context. */
function renderWithTooltips(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

const CHARGE = {
  id: 'entry-1',
  externalId: 'balance-1',
  providerKey: 'shopify_payments',
  externalAccountId: 'gid://shopify/ShopifyPaymentsAccount/999000223183024',
  environment: 'live',
  type: 'charge',
  grossMinor: '10000',
  feeMinor: '-300',
  netMinor: '9700',
  currency: 'USD',
  currencyExponent: 2,
  transactionDate: '2026-09-15',
  sourceTransactionId: 'txn-9',
  sourceOrderId: 'order-9',
  payoutExternalId: null,
  isOutgoingTransfer: false,
  matchState: 'unmatched',
  matchedMoneyTransactionId: null,
}

beforeEach(() => {
  state.entries = []
  state.error = null
  state.isPending = false
  state.nextPage = false
  state.fetchNextPage.mockClear()
})

describe('processor activity rows', () => {
  it('scans on the row line and keeps source detail behind a collapsed expansion', () => {
    state.entries = [CHARGE]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)

    // The line carries what the list is scanned for.
    expect(screen.getByText('balance-1')).toBeInTheDocument()
    expect(screen.getByText(/charge · 2026-09-15/)).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText('unmatched')).toBeInTheDocument()
    expect(screen.getByText('USD 97.00')).toBeInTheDocument()

    // Everything the six-column table used to wrap starts closed.
    expect(screen.queryByText('USD 100.00')).not.toBeInTheDocument()
    expect(screen.queryByText('txn-9')).not.toBeInTheDocument()
    expect(screen.queryByText(/An order reference alone/)).not.toBeInTheDocument()
  })

  it('reveals gross, fee, source references and remediation when a row is expanded', () => {
    state.entries = [CHARGE]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))

    expect(screen.getByText('USD 100.00')).toBeInTheDocument()
    expect(screen.getByText('USD -3.00')).toBeInTheDocument()
    expect(screen.getByText('txn-9')).toBeInTheDocument()
    expect(screen.getByText('order-9')).toBeInTheDocument()
    expect(screen.getByText(/An order reference alone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
  })

  it('marks an outgoing payout as not applicable rather than unmatched', () => {
    state.entries = [
      {
        ...CHARGE,
        id: 'entry-2',
        type: 'outgoing_transfer',
        payoutExternalId: 'payout-123',
        isOutgoingTransfer: true,
        grossMinor: '-9700',
        netMinor: '-9700',
        feeMinor: '0',
      },
    ]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)

    expect(screen.getByText('Outgoing payout')).toBeInTheDocument()
    expect(screen.getByText('Not applicable')).toBeInTheDocument()
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.queryByText(/An order reference alone/)).not.toBeInTheDocument()
  })

  it('keeps the empty state, the read failure and pagination', () => {
    renderWithTooltips(<ProcessorActivity unassignedOnly />)
    expect(screen.getByText('No unassigned activity')).toBeInTheDocument()

    state.error = { message: 'Evidence temporarily unavailable' }
    state.nextPage = true
    state.entries = [CHARGE]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
    expect(screen.getByText(/Evidence temporarily unavailable/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more activity' }))
    expect(state.fetchNextPage).toHaveBeenCalledOnce()
  })
})
