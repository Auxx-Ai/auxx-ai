// apps/web/src/components/accounting/ui/__tests__/ledger-card-sweeps.test.tsx

// The backward read of `plans/accounting/payout-links.md` §10.3: an order or
// invoice card says which payout posting swept the receipts it was paid by.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  postings: [] as Record<string, unknown>[],
  sweeps: [] as Record<string, unknown>[],
  /** The last input `sweepingPostings` was asked for — exactly one document id. */
  sweepInput: null as Record<string, unknown> | null,
  sweepEnabled: false,
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}))
vi.mock('~/components/resources', () => ({
  toRecordId: (defId: string, instanceId: string) => `${defId}:${instanceId}`,
  useRecordLink: (recordId: string | null) => (recordId ? `/app/records/${recordId}` : null),
  useResourceProperty: (slug: string) => `def-${slug}`,
}))
vi.mock('~/hooks/use-settings', () => ({ useSettings: () => ({ getSetting: () => null }) }))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({}),
    ledger: {
      listPostingsForSource: { useQuery: () => ({ data: state.postings, isPending: false }) },
      exportBatches: { list: { useQuery: () => ({ data: [] }) } },
      get: { useQuery: () => ({ data: undefined, isPending: false }) },
    },
    payoutEvidence: {
      sweepingPostings: {
        useQuery: (input: Record<string, unknown>, options: { enabled: boolean }) => {
          state.sweepInput = input
          state.sweepEnabled = options.enabled
          return { data: options.enabled ? state.sweeps : undefined, isPending: false }
        },
      },
    },
  },
}))

import { LedgerCard } from '../ledger-card'

const SWEEP = {
  glPostingId: 'posting-9',
  payoutSourceId: 'payout-instance-1',
  txnDate: '2026-09-17',
  docNumber: 'PAY-0001',
  status: 'posted',
  entryId: 'entry-1',
  moneyTransactionId: 'mt_1',
}

const card = (sourceKind: string) =>
  render(
    <TooltipProvider>
      <LedgerCard entityInstanceId='order-1' sourceKind={sourceKind} />
    </TooltipProvider>
  )

beforeEach(() => {
  state.postings = []
  state.sweeps = []
  state.sweepInput = null
  state.sweepEnabled = false
})

describe('ledger card sweep rows', () => {
  it('names the payout that swept an order, and links to the payout record', () => {
    state.sweeps = [SWEEP]
    card('order')

    expect(state.sweepInput).toEqual({ orderInstanceId: 'order-1' })
    expect(screen.getByText('PAY-0001')).toBeInTheDocument()
    expect(screen.getByText('Swept')).toBeInTheDocument()
    expect(screen.getByText('Posted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open payout' })).toHaveAttribute(
      'href',
      '/app/records/def-payout:payout-instance-1'
    )
  })

  it('asks about the invoice on an invoice card', () => {
    state.sweeps = [SWEEP]
    card('invoice')
    expect(state.sweepInput).toEqual({ invoiceInstanceId: 'order-1' })
    expect(screen.getByText('PAY-0001')).toBeInTheDocument()
  })

  // 🛑 `sweepingPostings` refuses anything that is not an order or an invoice,
  // so every other card must not ask.
  it('does not ask on a card that is neither', () => {
    card('payout')
    expect(state.sweepEnabled).toBe(false)
    expect(screen.getByText('Nothing posted yet')).toBeInTheDocument()
  })

  it('keeps the empty row only while there is neither a posting nor a sweep', () => {
    state.sweeps = [SWEEP]
    card('order')
    expect(screen.queryByText('Nothing posted yet')).not.toBeInTheDocument()
  })
})
