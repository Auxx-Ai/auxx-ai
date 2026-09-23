// apps/web/src/components/money/ui/provider-payment-notice.test.tsx

import type { RecordId } from '@auxx/lib/resources/client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  granted: new Set<string>(['ledger.view', 'ledger.post']),
  confirmAnswer: true,
  accepted: [] as string[],
  dismissed: [] as string[],
  invalidated: [] as string[],
  queriedWith: {} as Record<string, unknown>,
}))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: (key: string) => h.granted.has(key) }),
}))
vi.mock('~/components/accounting/hooks/use-accounting-provider-status', () => ({
  UNKNOWN_PROVIDER_LABEL: 'the accounting system',
  useAccountingProviderStatus: () => ({ providerLabel: 'QuickBooks Online' }),
}))
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [async () => h.confirmAnswer, () => null],
}))
vi.mock('~/trpc/react', () => {
  const invalidate = (name: string) => () => h.invalidated.push(name)
  const mutation = (sink: 'accepted' | 'dismissed') => (opts: { onSuccess?: () => void }) => ({
    mutate: ({ entryId }: { entryId: string }) => {
      h[sink].push(entryId)
      opts.onSuccess?.()
    },
    isPending: false,
    variables: undefined,
  })
  const query = (name: string) => (input: unknown, opts: { enabled: boolean }) => {
    if (opts.enabled) h.queriedWith[name] = input
    return { data: opts.enabled ? h.rows : undefined }
  }
  return {
    api: {
      useUtils: () => ({
        providerMatch: {
          forInvoice: { invalidate: invalidate('forInvoice') },
          forVendorBill: { invalidate: invalidate('forVendorBill') },
          list: { invalidate: invalidate('list') },
          counts: { invalidate: invalidate('counts') },
        },
        money: {
          listPayments: { invalidate: invalidate('listPayments') },
          billPayments: { invalidate: invalidate('billPayments') },
        },
      }),
      providerMatch: {
        forInvoice: { useQuery: query('forInvoice') },
        forVendorBill: { useQuery: query('forVendorBill') },
        accept: { useMutation: mutation('accepted') },
        dismiss: { useMutation: mutation('dismissed') },
      },
    },
  }
})

import { ProviderPaymentNotice as Notice } from './provider-payment-notice'

function ProviderPaymentNotice({ invoiceRecordId }: { invoiceRecordId: RecordId }) {
  return <Notice kind='invoice' recordId={invoiceRecordId} />
}

const INVOICE = 'def_invoice:inv_1' as RecordId

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ple_1',
    bookId: 'book_1',
    providerTxnType: 'Payment',
    providerTxnId: '401',
    docNumber: '1043',
    txnDate: '2026-09-03',
    amountMinor: 12500,
    currency: 'USD',
    customerName: null,
    matchState: 'suggested',
    matchReason: 'ours_unsent',
    matchedKind: 'money_transaction',
    matchedId: 'mt_1',
    matched: null,
    matchedBy: null,
    matchedAt: null,
    providerObjectUrl: 'https://qbo.example/payment/401',
    ...overrides,
  }
}

beforeEach(() => {
  h.rows = []
  h.granted = new Set(['ledger.view', 'ledger.post'])
  h.confirmAnswer = true
  h.accepted = []
  h.dismissed = []
  h.invalidated = []
  h.queriedWith = {}
})

describe('ProviderPaymentNotice', () => {
  it('renders nothing when no provider payment names the invoice', () => {
    const { container } = render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(container).toBeEmptyDOMElement()
    expect(h.queriedWith).toEqual({ forInvoice: { invoiceInstanceId: 'inv_1' } })
  })

  it('leaves adopted payments to the payments list', () => {
    h.rows = [row({ matchState: 'matched', matchReason: 'adopted' })]
    const { container } = render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers Accept on a suggestion, confirms ours_unsent, and refreshes the invoice', async () => {
    h.rows = [row()]
    render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(
      screen.getByText(/QuickBooks Online holds a \$125\.00 payment for this invoice/)
    ).toHaveTextContent('(Payment 1043, Sep 3, 2026)')
    expect(screen.getByRole('link', { name: /Open in QuickBooks Online/ })).toHaveAttribute(
      'href',
      'https://qbo.example/payment/401'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(h.accepted).toEqual(['ple_1']))
    expect(h.invalidated).toEqual(expect.arrayContaining(['forInvoice', 'listPayments']))
  })

  it('does not accept when the confirm is declined', async () => {
    h.confirmAnswer = false
    h.rows = [row()]
    render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.accepted).toEqual([])
  })

  it('offers only Dismiss on an unmatchable payment', () => {
    h.rows = [
      row({ matchState: 'unmatchable', matchReason: 'cannot_adopt', matchedKind: 'invoice' }),
    ]
    render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(h.dismissed).toEqual(['ple_1'])
  })

  it('offers no action on a settled duplicate', () => {
    h.rows = [
      row({ matchState: 'matched', matchReason: 'duplicate_sent', providerObjectUrl: null }),
    ]
    render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(screen.getByText(/a work item asks for their copy to be deleted/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('hides the actions without ledger.post and queries nothing without ledger.view', () => {
    h.granted = new Set(['ledger.view'])
    h.rows = [row()]
    const { unmount } = render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    unmount()

    h.granted = new Set()
    const { container } = render(<ProviderPaymentNotice invoiceRecordId={INVOICE} />)
    expect(container).toBeEmptyDOMElement()
  })
})

const BILL = 'def_bill:bill_1' as RecordId

describe('ProviderPaymentNotice on a vendor bill', () => {
  it('reads the bill, names it, and refreshes its payments on Accept', async () => {
    h.rows = [
      row({
        providerTxnType: 'Expense',
        docNumber: null,
        matchReason: 'pays_bill',
        matchedKind: 'vendor_bill',
        matchedId: 'bill_1',
      }),
    ]
    render(<Notice kind='vendor_bill' recordId={BILL} />)
    expect(h.queriedWith).toEqual({ forVendorBill: { vendorBillInstanceId: 'bill_1' } })
    expect(
      screen.getByText(/QuickBooks Online holds a \$125\.00 payment for this bill/)
    ).toHaveTextContent('(Expense, Sep 3, 2026)')
    expect(screen.getByText(/the bill is still open in QuickBooks Online/)).toBeInTheDocument()

    h.confirmAnswer = false
    fireEvent.click(screen.getByRole('button', { name: 'Ask to pay the bill there' }))
    await waitFor(() => expect(h.accepted).toEqual(['ple_1']))
    expect(h.invalidated).toEqual(expect.arrayContaining(['forVendorBill', 'billPayments']))
    expect(h.invalidated).not.toContain('listPayments')
  })

  it('speaks of our payment, not a receipt', () => {
    h.rows = [row({ providerTxnType: 'Bill Payment (Check)', matchReason: 'duplicate_sent' })]
    render(<Notice kind='vendor_bill' recordId={BILL} />)
    expect(screen.getByText(/Our payment was already sent/)).toBeInTheDocument()
  })

  it('explains an ambiguous or over-balance bill payment', () => {
    h.rows = [
      row({ matchState: 'unmatchable', matchReason: 'ambiguous', matchedKind: 'vendor_bill' }),
      row({
        id: 'ple_2',
        matchState: 'unmatchable',
        matchReason: 'cannot_adopt',
        matchedKind: 'vendor_bill',
      }),
    ]
    render(<Notice kind='vendor_bill' recordId={BILL} />)
    expect(screen.getByText(/It pays several bills/)).toBeInTheDocument()
    expect(screen.getByText(/more than this bill's balance/)).toBeInTheDocument()
  })

  it('waits on an accepted pays_bill with no actions', () => {
    h.rows = [
      row({
        matchState: 'matched',
        matchReason: 'pays_bill',
        matchedKind: 'vendor_bill',
        matchedId: 'bill_1',
        providerObjectUrl: null,
      }),
    ]
    render(<Notice kind='vendor_bill' recordId={BILL} />)
    expect(
      screen.getByText('Waiting for them to pay the bill in QuickBooks Online.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('marks an adopted bill payment on the payments list, not in the notice', () => {
    h.rows = [row({ matchState: 'matched', matchReason: 'adopted' })]
    const { container } = render(<Notice kind='vendor_bill' recordId={BILL} />)
    expect(container).toBeEmptyDOMElement()
  })
})
