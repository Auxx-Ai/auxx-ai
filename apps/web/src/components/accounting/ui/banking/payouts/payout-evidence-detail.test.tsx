// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-detail.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  payout: {} as Record<string, unknown>,
  entries: [] as Record<string, unknown>[],
  postings: [] as Record<string, unknown>[],
  detailError: null as { message: string } | null,
  entriesError: null as { message: string } | null,
  nextPage: false,
  fetchNextPage: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}))

// base-ui's scroll area calls `new IntersectionObserver(...)` on mount and the
// shared jsdom setup stubs that as a plain function. Nothing here is about
// scrolling.
vi.mock('@auxx/ui/components/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('~/components/resources', () => ({
  toRecordId: (defId: string, instanceId: string) => `${defId}:${instanceId}`,
  useRecordLink: (recordId: string | null) => (recordId ? `/app/records/${recordId}` : null),
  useResourceProperty: (slug: string) => `def-${slug}`,
}))

vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => null }) }))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ payoutEvidence: { invalidate: vi.fn() } }),
    payoutEvidence: {
      detail: { useQuery: () => ({ data: state.payout, error: state.detailError }) },
      entries: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: state.entries }] },
          error: state.entriesError,
          isPending: false,
          hasNextPage: state.nextPage,
          fetchNextPage: state.fetchNextPage,
        }),
      },
      matchCandidates: { useQuery: () => ({ data: [], error: null, isPending: false }) },
      sweepingPostings: { useQuery: () => ({ data: [], isPending: false }) },
      acceptMatch: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      matchEntry: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      unmatchEntry: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    ledger: {
      listPostingsForSource: { useQuery: () => ({ data: state.postings, isPending: false }) },
      exportBatches: { list: { useQuery: () => ({ data: [] }) } },
      get: { useQuery: () => ({ data: undefined, isPending: false }) },
    },
  },
}))

import { PayoutEvidenceDetail } from './payout-evidence-detail'
import { PayoutEvidenceDrawer } from './payout-evidence-drawer'

beforeEach(() => {
  state.detailError = null
  state.entriesError = null
  state.entries = []
  state.postings = []
  state.nextPage = false
  state.fetchNextPage.mockClear()
  state.payout = {
    id: 'transfer-1',
    externalId: 'payout-123',
    externalAccountId: 'shop-123',
    providerKey: 'shopify_payments',
    environment: 'live',
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
    needsMatchingCount: 0,
    dominantMatchReason: null,
    paymentGatewayId: 'rail-1',
    payoutInstanceId: null,
    livePostingId: null,
    blockers: ['The provider has not completed the payout membership.'],
    nextActions: ['Run the payout stream again after the provider finishes processing.'],
  }
})

/** Every surface here sits inside the app's tooltip provider in production. */
function withTooltips(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function detail() {
  return withTooltips(<PayoutEvidenceDetail payoutId='transfer-1' />)
}

/**
 * Docked, which is how the Banking layout renders it — `DockableDrawer` then
 * renders its children inline rather than through a vaul portal, so no stub is
 * needed for the drawer itself.
 */
function drawer() {
  return withTooltips(
    <PayoutEvidenceDrawer
      payoutId='transfer-1'
      onOpenChange={vi.fn()}
      isDocked
      width={480}
      onWidthChange={vi.fn()}
    />
  )
}

describe('payout evidence inspection', () => {
  // 🛑 Asserted against the DRAWER, not the detail. The identity and the status
  // badges live in `DrawerHeader` (task 50 §3.1) — rendering the body alone
  // would prove nothing about what a person actually sees, and the point of the
  // case is that three different "is it done" answers stay apart on one screen.
  it('keeps a paid provider status separate from incomplete evidence and bank confirmation', () => {
    drawer()
    expect(screen.getByText('Provider: paid')).toBeInTheDocument()
    // 🛑 The provider's own status is the ONLY badge. `Evidence: <state>` and
    // the provider-readiness badge are gone on purpose: they printed an
    // internal vocabulary, and "Provider ready" sat above a blockers list
    // saying the opposite. Asserted as absent so neither comes back as chrome.
    expect(screen.queryByText(/^Evidence:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Provider pending')).not.toBeInTheDocument()
    expect(screen.queryByText('Provider ready')).not.toBeInTheDocument()
    // Two, not three: `Constituent net` and `Difference`. The third used to be
    // a `Bank confirmation` row in a `Details` section, which is now one muted
    // sentence.
    expect(screen.getAllByText('Not assessed')).toHaveLength(2)
    expect(
      screen.getByText('Bank confirmation is not assessed for these payouts.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /post|sync/i })).not.toBeInTheDocument()
    // 🛑 The blocker survives; the "Next actions" list that restated it as an
    // imperative does not. Asserted as absent so it does not come back.
    expect(screen.queryByText(/Run the payout stream again/)).not.toBeInTheDocument()
    expect(screen.queryByText('Next actions')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open connector' })).toHaveAttribute(
      'href',
      '/app/connectors/connector-123'
    )
  })

  it('displays exact independent source amounts and a reported mismatch without rounding', () => {
    state.payout.constituentNetMinor = '9007199254741093'
    state.payout.differenceMinor = '-100'
    detail()
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
        environment: 'live',
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
        entryRowId: 'row-1',
        matchState: null,
        matchReason: null,
        matchedBy: null,
        matchedMoneyTransactionId: null,
        matchedDocuments: [],
        orderHint: null,
      },
    ]
    detail()
    expect(screen.getByText('Out')).toBeInTheDocument()
    expect(screen.queryByText('Not applicable')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Match manually' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more activity' }))
    expect(state.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('shows activity read failures instead of an empty payout', () => {
    state.entriesError = { message: 'Evidence temporarily unavailable' }
    detail()
    expect(screen.getByText(/Evidence temporarily unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/No processor activity has been imported/)).not.toBeInTheDocument()
  })

  it('raises the no_rail gap once for the feed rather than once per item', () => {
    state.payout.needsMatchingCount = 16
    state.payout.dominantMatchReason = 'no_rail'
    state.payout.paymentGatewayId = null
    detail()
    expect(screen.getByText('Link this feed to a payment gateway')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open payment gateways' })).toHaveAttribute(
      'href',
      '/app/accounting/settings/payment-gateways'
    )
    expect(screen.getByText(/16 need matching/)).toBeInTheDocument()
  })

  it('renders the payout ledger card only once a payout record exists', () => {
    detail()
    expect(screen.queryByText('Accounting')).not.toBeInTheDocument()

    state.payout.payoutInstanceId = 'payout-instance-1'
    state.postings = [
      {
        id: 'posting-1',
        docNumber: 'JE-0042',
        postingType: 'payout',
        txnDate: '2026-09-16',
        totalMinor: 9700,
        status: 'posted',
        linkRole: 'subject',
      },
    ]
    detail()
    expect(screen.getByText('Accounting')).toBeInTheDocument()
    expect(screen.getByText('JE-0042')).toBeInTheDocument()
  })

  // Through the drawer, because the header is now the other place a stale
  // payout could leak onto the screen: it reads the same query.
  it('shows a missing payout error without displaying stale evidence', () => {
    state.detailError = { message: 'Payout not found' }
    drawer()
    expect(screen.getByText(/Payout not found/)).toBeInTheDocument()
    expect(screen.queryByText('payout-123')).not.toBeInTheDocument()
  })
})
