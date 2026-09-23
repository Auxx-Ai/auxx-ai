// apps/web/src/components/accounting/ui/banking/matches/provider-match-list.test.tsx

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  nextPage: false,
  fetchNextPage: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  confirm: vi.fn(),
  providerLabel: 'QuickBooks Online' as string | null,
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}))

vi.mock('~/components/resources', () => ({
  toRecordId: (defId: string, instanceId: string) => `${defId}:${instanceId}`,
  useRecordLink: (recordId: string | null) => (recordId ? `/app/records/${recordId}` : null),
  useResourceProperty: (slug: string) => `def-${slug}`,
}))

vi.mock('~/components/accounting/hooks/use-accounting-provider-status', () => ({
  UNKNOWN_PROVIDER_LABEL: 'the accounting system',
  useAccountingProviderStatus: () => ({ providerLabel: state.providerLabel }),
}))

vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [state.confirm, () => null],
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      providerMatch: { invalidate: vi.fn() },
      payoutEvidence: { invalidate: vi.fn() },
    }),
    providerMatch: {
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ rows: state.rows, nextCursor: null }] },
          error: state.error,
          isPending: false,
          hasNextPage: state.nextPage,
          isFetchingNextPage: false,
          fetchNextPage: state.fetchNextPage,
        }),
      },
      accept: { useMutation: () => ({ mutate: state.accept, isPending: false }) },
      dismiss: { useMutation: () => ({ mutate: state.dismiss, isPending: false }) },
    },
  },
}))

import { ProviderMatchList } from './provider-match-list'

const RECEIPT_MATCH = {
  id: 'ple-1',
  bookId: 'book-1',
  providerTxnType: 'Payment',
  providerTxnId: '401',
  docNumber: 'PROBE-102-A',
  txnDate: '2026-09-22',
  amountMinor: 10000,
  currency: 'USD',
  customerName: 'Probe 102 Customer',
  matchState: 'suggested',
  matchReason: 'ours_unsent',
  matchedKind: 'money_transaction',
  matchedId: 'mt-1',
  matched: {
    label: 'CHQ-9',
    date: '2026-09-21',
    amountMinor: 10000,
    invoiceInstanceId: 'inv-1',
    vendorBillInstanceId: null,
    payoutEvidenceId: null,
  },
  matchedBy: null,
  matchedAt: null,
  providerObjectUrl: 'https://app.qbo.intuit.com/app/recvpayment?txnId=401',
}

const row = (over: Record<string, unknown>) => [{ ...RECEIPT_MATCH, ...over }]

beforeEach(() => {
  state.rows = []
  state.error = null
  state.nextPage = false
  state.fetchNextPage.mockClear()
  state.accept.mockClear()
  state.dismiss.mockClear()
  state.confirm.mockReset()
  state.providerLabel = 'QuickBooks Online'
})

describe('provider match rows', () => {
  it('shows both sides, the reason copy and the QuickBooks link', () => {
    state.rows = [RECEIPT_MATCH]
    render(<ProviderMatchList state='suggested' canPost />)

    expect(screen.getAllByText('Payment PROBE-102-A').length).toBeGreaterThan(0)
    expect(screen.getByText('Probe 102 Customer')).toBeInTheDocument()
    expect(screen.getByText('Suggested')).toBeInTheDocument()
    expect(screen.getByText('CHQ-9')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invoice' })).toHaveAttribute(
      'href',
      '/app/records/def-invoice:inv-1'
    )
    expect(screen.getByText(/Keep theirs reverses our receipt/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in QuickBooks Online' })).toHaveAttribute(
      'href',
      RECEIPT_MATCH.providerObjectUrl
    )
  })

  it('confirms before Keep theirs reverses our receipt', async () => {
    state.rows = [RECEIPT_MATCH]
    state.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<ProviderMatchList state='suggested' canPost />)

    fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1))
    expect(state.accept).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
    await waitFor(() => expect(state.accept).toHaveBeenCalledWith({ entryId: 'ple-1' }))
  })

  it('asks to delete theirs without a confirm for a sent duplicate and for an unsent payout', async () => {
    for (const over of [
      { matchReason: 'duplicate_sent' },
      {
        providerTxnType: 'Deposit',
        matchReason: 'ours_unsent',
        matchedKind: 'payout',
        matchedId: 'payout-1',
        matched: {
          label: 'PO-7',
          date: '2026-09-20',
          amountMinor: 25000,
          invoiceInstanceId: null,
          vendorBillInstanceId: null,
          payoutEvidenceId: null,
        },
      },
    ]) {
      state.rows = row(over)
      const view = render(<ProviderMatchList state='suggested' canPost />)
      fireEvent.click(screen.getByRole('button', { name: 'Ask to delete theirs' }))
      await waitFor(() => expect(state.accept).toHaveBeenCalledWith({ entryId: 'ple-1' }))
      expect(state.confirm).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'Keep theirs' })).not.toBeInTheDocument()
      state.accept.mockClear()
      view.unmount()
    }
  })

  it('links a payout to its record and explains why theirs goes', () => {
    state.rows = row({
      providerTxnType: 'Deposit',
      matchedKind: 'payout',
      matchedId: 'payout-1',
      matched: {
        label: 'PO-7',
        date: '2026-09-20',
        amountMinor: 25000,
        invoiceInstanceId: null,
        vendorBillInstanceId: null,
        payoutEvidenceId: null,
      },
    })
    render(<ProviderMatchList state='suggested' canPost />)
    expect(screen.getByRole('link', { name: 'PO-7' })).toHaveAttribute(
      'href',
      '/app/records/def-payout:payout-1'
    )
    expect(screen.getByText(/remove theirs from QuickBooks Online/)).toBeInTheDocument()
  })

  it('opens the Payouts drawer for a payout whose evidence resolves', () => {
    state.rows = row({
      providerTxnType: 'Deposit',
      matchedKind: 'payout',
      matchedId: 'payout-1',
      matched: {
        label: 'PO-7',
        date: '2026-09-20',
        amountMinor: 25000,
        invoiceInstanceId: null,
        vendorBillInstanceId: null,
        payoutEvidenceId: 'transfer-1',
      },
    })
    render(<ProviderMatchList state='suggested' canPost />)
    expect(screen.getByRole('link', { name: 'PO-7' })).toHaveAttribute(
      'href',
      '/app/accounting/banking/payouts?payout=transfer-1'
    )
  })

  it('offers only Dismiss where a person or a payout has to come first', () => {
    for (const [matchState, matchReason, copy] of [
      ['pending', 'no_payout', /checked again on the next sync/],
      ['unmatchable', 'ambiguous', /A person has to decide/],
      ['unmatchable', 'cannot_adopt', /more than the open balance/],
      ['unmatchable', 'order_invoice', /order payments are not matched yet/],
    ] as const) {
      state.rows = row({ matchState, matchReason })
      const view = render(<ProviderMatchList state={matchState} canPost />)
      expect(screen.getByText(copy)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Keep theirs' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Ask to delete theirs' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(state.dismiss).toHaveBeenCalledWith({ entryId: 'ple-1' })
      state.dismiss.mockClear()
      view.unmount()
    }
  })

  it('speaks of a vendor payment and links the bill it pays', async () => {
    state.rows = row({
      providerTxnType: 'Bill Payment (Check)',
      matched: {
        label: 'VP-3',
        date: '2026-09-21',
        amountMinor: 10000,
        invoiceInstanceId: null,
        vendorBillInstanceId: 'bill-1',
        payoutEvidenceId: null,
      },
    })
    state.confirm.mockResolvedValueOnce(false)
    render(<ProviderMatchList state='suggested' canPost />)
    expect(screen.getByRole('link', { name: 'Bill' })).toHaveAttribute(
      'href',
      '/app/records/def-vendor_bill:bill-1'
    )
    expect(screen.getByText(/Keep theirs reverses our payment/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }))
    await waitFor(() =>
      expect(state.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/^Our payment is reversed/) })
      )
    )
  })

  it('links a bill pinned by the matcher and words its unmatchable reasons for a bill', () => {
    for (const [matchReason, copy] of [
      ['cannot_adopt', /names our bill .* Check the bill/],
      ['ambiguous', /It pays several bills/],
    ] as const) {
      state.rows = row({
        providerTxnType: 'Bill Payment (Credit Card)',
        matchState: 'unmatchable',
        matchReason,
        matchedKind: 'vendor_bill',
        matchedId: 'bill-2',
        matched: {
          label: 'BILL-2',
          date: '2026-09-01',
          amountMinor: 10000,
          invoiceInstanceId: null,
          vendorBillInstanceId: 'bill-2',
          payoutEvidenceId: null,
        },
      })
      const view = render(<ProviderMatchList state='unmatchable' canPost />)
      expect(screen.getByRole('link', { name: 'BILL-2' })).toHaveAttribute(
        'href',
        '/app/records/def-vendor_bill:bill-2'
      )
      expect(screen.getByText(copy)).toBeInTheDocument()
      view.unmount()
    }
  })

  it('gives a settled row and a viewer without ledger.post no actions', () => {
    state.rows = row({ matchState: 'matched', matchReason: 'adopted' })
    const settled = render(<ProviderMatchList state='matched' canPost />)
    expect(screen.getByText('Settled')).toBeInTheDocument()
    expect(screen.getByText(/recorded against the invoice/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    settled.unmount()

    state.rows = [RECEIPT_MATCH]
    render(<ProviderMatchList state='suggested' canPost={false} />)
    expect(screen.queryByRole('button', { name: 'Keep theirs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('names the provider generically before a connection resolves', () => {
    state.providerLabel = null
    state.rows = [RECEIPT_MATCH]
    render(<ProviderMatchList state='suggested' canPost />)
    expect(screen.getByRole('link', { name: 'Open in the accounting system' })).toBeInTheDocument()
  })

  it('omits the provider link when the entry is not in the connected book', () => {
    state.rows = row({ providerObjectUrl: null })
    render(<ProviderMatchList state='suggested' canPost />)
    expect(
      screen.queryByRole('link', { name: 'Open in QuickBooks Online' })
    ).not.toBeInTheDocument()
  })

  it('keeps the empty state, the read failure and pagination', () => {
    const empty = render(<ProviderMatchList state='suggested' canPost />)
    expect(screen.getByText('No suggestions')).toBeInTheDocument()
    empty.unmount()

    state.error = { message: 'Mirror unavailable' }
    state.nextPage = true
    state.rows = [RECEIPT_MATCH]
    render(<ProviderMatchList state='suggested' canPost />)
    expect(screen.getByText('Mirror unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(state.fetchNextPage).toHaveBeenCalledOnce()
  })
})
