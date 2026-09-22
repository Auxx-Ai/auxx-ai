// apps/web/src/components/accounting/ui/banking/payouts/processor-activity.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  entries: [] as Record<string, unknown>[],
  candidates: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  isPending: false,
  nextPage: false,
  fetchNextPage: vi.fn(),
  acceptMatch: vi.fn(),
  matchEntry: vi.fn(),
  unmatchEntry: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}))

/** The record resolver behind `RecordChipLink`; no resource registry in a unit test. */
vi.mock('~/components/resources', () => ({
  toRecordId: (defId: string, instanceId: string) => `${defId}:${instanceId}`,
  useRecordLink: (recordId: string | null) => (recordId ? `/app/records/${recordId}` : null),
  useResourceProperty: (slug: string) => `def-${slug}`,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ payoutEvidence: { invalidate: state.invalidate } }),
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
      matchCandidates: {
        useQuery: () => ({ data: state.candidates, error: null, isPending: false }),
      },
      acceptMatch: { useMutation: () => ({ mutate: state.acceptMatch, isPending: false }) },
      matchEntry: { useMutation: () => ({ mutate: state.matchEntry, isPending: false }) },
      unmatchEntry: { useMutation: () => ({ mutate: state.unmatchEntry, isPending: false }) },
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
  entryRowId: 'row-1',
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
  matchState: 'pending',
  matchReason: 'no_receipt',
  matchedBy: null,
  matchedMoneyTransactionId: null,
  matchedDocuments: [],
  orderHint: null,
}

/** One entry in the state the reason code implies, per §10.4's table. */
const entry = (over: Record<string, unknown>) => [{ ...CHARGE, ...over }]

const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Expand' }))

beforeEach(() => {
  state.entries = []
  state.candidates = []
  state.error = null
  state.isPending = false
  state.nextPage = false
  state.fetchNextPage.mockClear()
  state.acceptMatch.mockClear()
  state.matchEntry.mockClear()
  state.unmatchEntry.mockClear()
  state.invalidate.mockClear()
})

describe('processor activity rows', () => {
  it('scans on the row line and keeps source detail behind a collapsed expansion', () => {
    state.entries = [CHARGE]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)

    // The line carries what the list is scanned for.
    expect(screen.getByText('balance-1')).toBeInTheDocument()
    expect(screen.getByText('2026-09-15')).toBeInTheDocument()
    expect(screen.getByText('charge')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('No receipt yet')).not.toBeInTheDocument()
    expect(screen.getByText('$97.00')).toBeInTheDocument()

    // Everything the six-column table used to wrap starts closed.
    expect(screen.queryByText('$100.00')).not.toBeInTheDocument()
    expect(screen.queryByText('txn-9')).not.toBeInTheDocument()
    expect(screen.queryByText(/has not synced/)).not.toBeInTheDocument()
  })

  it('reveals gross, fee, source references and the reason copy when a row is expanded', () => {
    state.entries = [CHARGE]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)

    expand()

    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('-$3.00')).toBeInTheDocument()
    expect(screen.getByText('txn-9')).toBeInTheDocument()
    expect(screen.getByText('order-9')).toBeInTheDocument()
    expect(screen.getByText(/The order or transaction has not synced/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
  })

  it('offers Match manually and the order hint on a no_receipt row', () => {
    state.entries = entry({
      orderHint: { instanceId: 'order-instance-1', displayName: '#2003' },
    })
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
    expand()

    expect(screen.getByRole('link', { name: '#2003' })).toHaveAttribute(
      'href',
      '/app/records/def-order:order-instance-1'
    )
    expect(screen.getByRole('button', { name: 'Match manually' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })

  it('explains no_rail only in the expansion — the banner is feed-level', () => {
    state.entries = entry({ matchReason: 'no_rail' })
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
    expect(screen.queryByText(/not linked to a payment gateway/)).not.toBeInTheDocument()
    expand()
    expect(screen.getByText(/not linked to a payment gateway/)).toBeInTheDocument()
  })

  it('offers only Match manually for the two unmatchable codes', () => {
    for (const [reason, copy] of [
      ['no_reference', /no reference for this item/],
      ['ambiguous', /More than one customer payment fits/],
    ] as const) {
      state.entries = entry({ matchState: 'unmatchable', matchReason: reason })
      const view = renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
      expand()
      expect(screen.getByText('Unmatchable')).toBeInTheDocument()
      expect(screen.getByText(copy)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Match manually' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('offers Accept and Match manually for the two suggested codes', () => {
    for (const [reason, copy] of [
      ['amount_differs', /but not the amount/],
      ['rail_differs', /settles a different payment gateway/],
    ] as const) {
      state.entries = entry({
        matchState: 'suggested',
        matchReason: reason,
        matchedMoneyTransactionId: 'mt_1',
      })
      const view = renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
      expand()
      expect(screen.getByText('Suggested')).toBeInTheDocument()
      expect(screen.getByText(copy)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
      expect(state.acceptMatch).toHaveBeenCalledWith({ entryId: 'row-1' })
      expect(screen.getByRole('button', { name: 'Match manually' })).toBeInTheDocument()
      state.acceptMatch.mockClear()
      view.unmount()
    }
  })

  it('links a matched row to its documents and refuses Unmatch while the payout is posted', () => {
    state.entries = entry({
      matchState: 'matched',
      matchReason: null,
      matchedMoneyTransactionId: 'mt_1',
      matchedDocuments: [
        { kind: 'invoice', instanceId: 'invoice-1', displayName: 'INV-104' },
        { kind: 'order', instanceId: 'order-1', displayName: '#2003' },
      ],
    })
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' livePostingId='posting-1' />)
    expand()

    expect(screen.getByText('Matched')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'INV-104' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#2003' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unmatch' })).toBeDisabled()
    expect(screen.getByText(/Reverse the entry to unmatch/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Match manually' })).not.toBeInTheDocument()
  })

  it('opens the picker from Match manually and writes the pick', () => {
    state.entries = entry({ matchState: 'unmatchable', matchReason: 'no_reference' })
    state.candidates = [
      {
        moneyTransactionId: 'mt_9',
        amountMinor: '10000',
        currency: 'USD',
        currencyExponent: 2,
        differenceMinor: '0',
        occurredAt: null,
        occurredOn: '2026-09-14',
        reference: 'ch_123',
        paymentGatewayId: 'rail-1',
        documents: [],
      },
    ]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Match manually' }))

    expect(screen.getByText('Match to a customer payment')).toBeInTheDocument()
    expect(screen.getByText('Exact amount')).toBeInTheDocument()
    fireEvent.click(screen.getByText('ch_123'))
    expect(state.matchEntry).toHaveBeenCalledWith({
      entryId: 'row-1',
      moneyTransactionId: 'mt_9',
    })
  })

  it('gives an observation-only row no actions, since the mutations cannot resolve it', () => {
    state.entries = entry({ entryRowId: null, matchState: 'suggested' })
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
    expand()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Match manually' })).not.toBeInTheDocument()
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

    expect(screen.getByText('Out')).toBeInTheDocument()
    expect(screen.queryByText('Not applicable')).not.toBeInTheDocument()
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()

    expand()
    expect(screen.queryByText(/has not synced/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Match manually' })).not.toBeInTheDocument()
  })

  it('keeps the empty state, the read failure and pagination', () => {
    renderWithTooltips(<ProcessorActivity unassignedOnly />)
    expect(screen.getByText('No unassigned activity')).toBeInTheDocument()

    state.error = { message: 'Evidence temporarily unavailable' }
    state.nextPage = true
    state.entries = [CHARGE]
    renderWithTooltips(<ProcessorActivity transferId='transfer-1' />)
    expect(screen.getByText(/Evidence temporarily unavailable/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(state.fetchNextPage).toHaveBeenCalledOnce()
  })
})
