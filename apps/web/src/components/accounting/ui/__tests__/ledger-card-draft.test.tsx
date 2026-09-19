// apps/web/src/components/accounting/ui/__tests__/ledger-card-draft.test.tsx

// A bill whose avenue has auto-post OFF holds a DRAFT, and a draft writes no
// subject `GlPostingSource` row - so this card's own read cannot see it and the
// card used to say "Nothing posted yet" while the entry sat in the outbox.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  postings: [] as Record<string, unknown>[],
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
      sweepingPostings: { useQuery: () => ({ data: undefined, isPending: false }) },
    },
  },
}))

import { LedgerCard } from '../ledger-card'

const card = (draftPostingId: string | null) =>
  render(
    <TooltipProvider>
      <LedgerCard
        entityInstanceId='bill-1'
        sourceKind='vendor_bill'
        draftPostingId={draftPostingId}
      />
    </TooltipProvider>
  )

beforeEach(() => {
  state.postings = []
})

describe('the vendor bill ledger card and a drafted entry', () => {
  it('names the drafted state and links to the outbox', () => {
    card('gp_draft')

    expect(screen.queryByText('Nothing posted yet')).not.toBeInTheDocument()
    expect(screen.getByText('Drafted — awaiting approval in the outbox')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open outbox' })).toHaveAttribute(
      'href',
      '/app/accounting?queue=drafts&posting=gp_draft'
    )
  })

  it('still says nothing posted when there is no draft', () => {
    card(null)
    expect(screen.getByText('Nothing posted yet')).toBeInTheDocument()
  })

  // Approved in the outbox: the draft took its claim and arrives through the
  // ordinary read, so the notice must not double it.
  it('drops the notice once the posting is claimed', () => {
    state.postings = [
      {
        id: 'gp_draft',
        docNumber: 'AUXX-BIL-BILL0002',
        postingType: 'vendor_bill',
        txnDate: '2026-09-01',
        totalMinor: 250_000,
        status: 'posted',
        linkRole: 'subject',
      },
    ]
    card('gp_draft')

    expect(screen.queryByText('Drafted — awaiting approval in the outbox')).not.toBeInTheDocument()
    expect(screen.getByText('AUXX-BIL-BILL0002')).toBeInTheDocument()
  })
})
