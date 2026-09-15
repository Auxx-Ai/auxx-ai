// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-detail.test.tsx

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  payout: {} as Record<string, unknown>,
  entries: [] as Record<string, unknown>[],
  detailError: null as { message: string } | null,
  entriesError: null as { message: string } | null,
  nextPage: false,
  fetchNextPage: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    payoutEvidence: {
      detail: { useQuery: () => ({ data: state.payout, error: state.detailError }) },
      history: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: state.payout.generations ?? [] }] },
          isPending: false,
        }),
      },
      entries: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: state.entries }] },
          error: state.entriesError,
          isPending: false,
          hasNextPage: state.nextPage,
          fetchNextPage: state.fetchNextPage,
        }),
      },
    },
  },
}))

import { PayoutEvidenceDetail } from './payout-evidence-detail'

beforeEach(() => {
  state.detailError = null
  state.entriesError = null
  state.entries = []
  state.nextPage = false
  state.fetchNextPage.mockClear()
  state.payout = {
    id: 'transfer-1',
    externalId: 'payout-123',
    externalAccountId: 'shop-123',
    providerKey: 'shopify_payments',
    sourceConnectionId: 'connector-123',
    status: 'paid',
    membershipState: 'incomplete',
    providerReady: false,
    occurredOn: '2026-09-15',
    occurredAt: null,
    updatedAt: '2026-09-15T12:00:00.000Z',
    sourceAmountMinor: '9007199254740993',
    sourceCurrency: 'USD',
    sourceCurrencyExponent: 2,
    destinationAmountMinor: '9007199254740993',
    destinationCurrency: 'USD',
    destinationCurrencyExponent: 2,
    constituentNetMinor: null,
    differenceMinor: null,
    entryCount: 0,
    blockers: ['The provider has not completed the payout membership.'],
    nextActions: ['Run the payout stream again after the provider finishes processing.'],
    generations: [
      {
        id: 'observation-1',
        createdAt: '2026-09-15T12:00:00.000Z',
        state: 'incomplete',
        rejections: [],
        pageIndex: 0,
        providerReady: false,
        entryCount: 0,
        reason: 'Membership fetch interrupted',
      },
    ],
    sourceObservation: { payout_id: 'payout-123' },
  }
})

describe('payout evidence inspection', () => {
  it('keeps a paid provider status separate from incomplete evidence and bank confirmation', () => {
    render(<PayoutEvidenceDetail payoutId='transfer-1' />)
    expect(screen.getByText('Provider: paid')).toBeInTheDocument()
    expect(screen.getByText('Evidence: incomplete')).toBeInTheDocument()
    expect(screen.getByText('Provider pending')).toBeInTheDocument()
    expect(screen.getAllByText('Not assessed')).toHaveLength(3)
    expect(screen.getByText('Posting not enabled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /post|sync/i })).not.toBeInTheDocument()
    expect(screen.getByText('Membership fetch interrupted')).toBeInTheDocument()
    expect(
      screen.getByText('Run the payout stream again after the provider finishes processing.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open connector' })).toHaveAttribute(
      'href',
      '/app/connectors/connector-123'
    )
  })

  it('displays exact independent source amounts and a reported mismatch without rounding', () => {
    state.payout.constituentNetMinor = '9007199254741093'
    state.payout.differenceMinor = '-100'
    render(<PayoutEvidenceDetail payoutId='transfer-1' />)
    expect(screen.getAllByText('USD 90,071,992,547,409.93')).toHaveLength(2)
    expect(screen.getByText('USD 90,071,992,547,410.93')).toBeInTheDocument()
    expect(screen.getByText('USD -1.00')).toBeInTheDocument()
  })

  it('retains outgoing transfer evidence and offers pagination without treating it as a payment', () => {
    state.nextPage = true
    state.entries = [
      {
        id: 'entry-1',
        externalId: 'balance-1',
        providerKey: 'shopify_payments',
        externalAccountId: 'shop-123',
        type: 'payout',
        grossMinor: '-9700',
        feeMinor: '0',
        netMinor: '-9700',
        currency: 'USD',
        currencyExponent: 2,
        transactionDate: '2026-09-15',
        sourceTransactionId: null,
        sourceOrderId: null,
        payoutExternalId: 'payout-123',
        isOutgoingTransfer: true,
        matchState: 'unmatched',
        matchedMoneyTransactionId: null,
      },
    ]
    render(<PayoutEvidenceDetail payoutId='transfer-1' />)
    expect(screen.getByText('Outgoing payout')).toBeInTheDocument()
    expect(screen.getByText('Not applicable')).toBeInTheDocument()
    expect(screen.queryByText(/An order reference alone/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more activity' }))
    expect(state.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('shows activity read failures instead of an empty payout', () => {
    state.entriesError = { message: 'Evidence temporarily unavailable' }
    render(<PayoutEvidenceDetail payoutId='transfer-1' />)
    expect(screen.getByText(/Evidence temporarily unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/No processor activity has been imported/)).not.toBeInTheDocument()
  })

  it('shows a missing payout error without displaying stale evidence', () => {
    state.detailError = { message: 'Payout not found' }
    render(<PayoutEvidenceDetail payoutId='transfer-1' />)
    expect(screen.getByText(/Payout not found/)).toBeInTheDocument()
    expect(screen.queryByText('payout-123')).not.toBeInTheDocument()
  })
})
