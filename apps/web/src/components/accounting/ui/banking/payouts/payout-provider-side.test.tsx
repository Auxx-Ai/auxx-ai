// apps/web/src/components/accounting/ui/banking/payouts/payout-provider-side.test.tsx

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  side: undefined as Record<string, unknown> | undefined,
  queryInput: null as unknown,
  queryOptions: null as unknown,
  accept: vi.fn(),
  dismiss: vi.fn(),
  invalidated: [] as string[],
  onAcceptSuccess: null as (() => unknown) | null,
  canPost: true,
}))

vi.mock('~/components/money/ui/provider-payment-notice', () => ({
  useProviderName: () => 'QuickBooks',
}))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: (key: string) => state.canPost || key !== 'ledger.post' }),
}))

vi.mock('~/trpc/react', () => {
  const invalidate = (name: string) => () => state.invalidated.push(name)
  return {
    api: {
      useUtils: () => ({
        providerMatch: {
          forPayout: { invalidate: invalidate('forPayout') },
          list: { invalidate: invalidate('list') },
          counts: { invalidate: invalidate('counts') },
        },
      }),
      providerMatch: {
        forPayout: {
          useQuery: (input: unknown, options: unknown) => {
            state.queryInput = input
            state.queryOptions = options
            return { data: state.side, error: null }
          },
        },
        accept: {
          useMutation: (options: { onSuccess: () => unknown }) => {
            state.onAcceptSuccess = options.onSuccess
            return { mutate: state.accept, isPending: false }
          },
        },
        dismiss: { useMutation: () => ({ mutate: state.dismiss, isPending: false }) },
      },
    },
  }
})

import { PayoutProviderSide } from './payout-provider-side'

function deposit(overrides: Record<string, unknown> = {}) {
  return {
    batchState: 'sent',
    providerObjectId: '555',
    objectType: 'deposit',
    bookId: 'book-1',
    sentAt: null,
    cleared: null,
    providerObjectUrl: 'https://qbo.test/deposit/555',
    ...overrides,
  }
}

function duplicate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ple-1',
    bookId: 'book-1',
    providerTxnType: 'Deposit',
    providerTxnId: '403',
    docNumber: null,
    txnDate: '2026-09-22',
    amountMinor: 25000,
    currency: 'USD',
    customerName: null,
    matchState: 'suggested',
    matchReason: 'duplicate_sent',
    matchedKind: 'payout',
    matchedId: 'payout-1',
    matched: null,
    matchedBy: null,
    matchedAt: null,
    providerObjectUrl: 'https://qbo.test/deposit/403',
    ...overrides,
  }
}

function renderSide(props: { payoutId?: string | null; deposited?: boolean } = {}) {
  return render(
    <PayoutProviderSide
      payoutId={props.payoutId === undefined ? 'payout-1' : props.payoutId}
      deposited={props.deposited ?? true}
      bookTimeZone='UTC'
      fallback={<p>bank route fallback</p>}
    />
  )
}

beforeEach(() => {
  state.side = undefined
  state.accept.mockClear()
  state.dismiss.mockClear()
  state.invalidated = []
  state.canPost = true
})

describe('PayoutProviderSide', () => {
  it('skips the query and shows the fallback before a payout record exists', () => {
    renderSide({ payoutId: null })
    expect(state.queryOptions).toEqual({ enabled: false })
    expect(screen.getByText('bank route fallback')).toBeInTheDocument()
  })

  it('shows the fallback when no book is connected', () => {
    state.side = { connected: false, deposit: null, duplicates: [] }
    renderSide()
    expect(state.queryInput).toEqual({ payoutId: 'payout-1' })
    expect(screen.getByText('bank route fallback')).toBeInTheDocument()
  })

  it.each([
    [null, /Deposit not built yet/],
    [deposit({ batchState: 'ready', providerObjectUrl: null }), /Deposit queued for QuickBooks/],
    [deposit({ batchState: 'failed', providerObjectUrl: null }), /Deposit failed to send/],
  ])('names our Deposit state %#', (value, copy) => {
    state.side = { connected: true, deposit: value, duplicates: [] }
    renderSide()
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.queryByText('bank route fallback')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in QuickBooks' })).not.toBeInTheDocument()
  })

  it.each([
    ['R', 'Reconciled in QuickBooks.'],
    ['C', 'Cleared in QuickBooks.'],
    [null, 'Not yet reconciled in QuickBooks.'],
  ])('reads the cleared flag %s on a sent Deposit and links it', (cleared, copy) => {
    state.side = { connected: true, deposit: deposit({ cleared }), duplicates: [] }
    renderSide()
    expect(screen.getByText(new RegExp(`Deposit sent to QuickBooks. ${copy}`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in QuickBooks' })).toHaveAttribute(
      'href',
      'https://qbo.test/deposit/555'
    )
  })

  it('says nothing about a Deposit for a payout that never reached the bank', () => {
    state.side = { connected: true, deposit: null, duplicates: [] }
    const { container } = renderSide({ deposited: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('offers Accept and Dismiss on a suggested duplicate, and refreshes the lists', async () => {
    state.side = { connected: true, deposit: deposit(), duplicates: [duplicate()] }
    renderSide()
    expect(screen.getByText(/Deposit 403 on Sep 22, 2026, \$250.00/)).toBeInTheDocument()
    expect(screen.getByText(/QuickBooks now holds this payout twice/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open in QuickBooks' })[1]).toHaveAttribute(
      'href',
      'https://qbo.test/deposit/403'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask to delete theirs' }))
    expect(state.accept).toHaveBeenCalledWith({ entryId: 'ple-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(state.dismiss).toHaveBeenCalledWith({ entryId: 'ple-1' })
    await state.onAcceptSuccess?.()
    expect(state.invalidated).toEqual(['forPayout', 'list', 'counts'])
  })

  it('explains an unsent payout of ours still asks for theirs to go', () => {
    state.side = {
      connected: true,
      deposit: null,
      duplicates: [duplicate({ matchReason: 'ours_unsent', docNumber: 'PROBE-102-B' })],
    }
    renderSide()
    expect(screen.getByText(/Deposit PROBE-102-B/)).toBeInTheDocument()
    expect(screen.getByText(/carries the fee split theirs lacks/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask to delete theirs' })).toBeInTheDocument()
  })

  it('hides Accept and Dismiss without ledger.post', () => {
    state.canPost = false
    state.side = { connected: true, deposit: null, duplicates: [duplicate()] }
    renderSide()
    expect(screen.getByText(/QuickBooks now holds this payout twice/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask to delete theirs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('waits on a matched duplicate without offering actions', () => {
    state.side = {
      connected: true,
      deposit: deposit(),
      duplicates: [duplicate({ matchState: 'matched' })],
    }
    renderSide()
    expect(screen.getByText('Waiting for them to delete it in QuickBooks.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask to delete theirs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })
})
