// apps/web/src/components/accounting/ui/__tests__/ledger-card-draft.test.tsx

// A record whose avenue has auto-post OFF holds a DRAFT. A draft writes no
// subject `GlPostingSource` row - it holds no claim - so it reaches the card
// through its `pending` link (tasks/77), and the card names the state rather
// than saying "Nothing posted yet" while the entry sits in the outbox.

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

const card = (emptyLabel?: string) =>
  render(
    <TooltipProvider>
      <LedgerCard entityInstanceId='memo-1' sourceKind='credit_memo' emptyLabel={emptyLabel} />
    </TooltipProvider>
  )

const DRAFT = {
  id: 'gp_draft',
  docNumber: '',
  postingType: 'credit_memo',
  txnDate: '2026-09-01',
  totalMinor: 250_000,
  status: 'draft',
  linkRole: 'pending',
}

beforeEach(() => {
  state.postings = []
})

describe('the ledger card and a drafted entry', () => {
  it('names the drafted state and links to the outbox', () => {
    state.postings = [DRAFT]
    card()

    expect(screen.queryByText('Nothing posted yet')).not.toBeInTheDocument()
    expect(screen.getByText('Drafted — awaiting approval in the outbox')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open outbox' })).toHaveAttribute(
      'href',
      '/app/accounting/outbox?tab=drafts&posting=gp_draft'
    )
  })

  it('still says nothing posted when there is no draft', () => {
    card()
    expect(screen.getByText('Nothing posted yet')).toBeInTheDocument()
  })

  // A `posted` bill whose draft was discarded in the outbox: "Nothing posted
  // yet" reads as "not posted", when the way back is Edit then Save.
  it('names the way back when the record hands it one', () => {
    card('No entry — Edit then Save to post it again')
    expect(screen.getByText('No entry — Edit then Save to post it again')).toBeInTheDocument()
    expect(screen.queryByText('Nothing posted yet')).not.toBeInTheDocument()
  })

  // Approved in the outbox: the draft took its claim, the `pending` row is gone
  // and the posting arrives through the ordinary read as a `subject` row.
  it('lists the posting once it is claimed, with no drafted notice', () => {
    state.postings = [{ ...DRAFT, docNumber: 'CM-0002', status: 'posted', linkRole: 'subject' }]
    card()

    expect(screen.queryByText('Drafted — awaiting approval in the outbox')).not.toBeInTheDocument()
    expect(screen.getByText('CM-0002')).toBeInTheDocument()
  })

  // Two drafts on one record - an issuance and a write-off, say - are two rows.
  it('shows every pending draft', () => {
    state.postings = [DRAFT, { ...DRAFT, id: 'gp_draft_2', postingType: 'write_off' }]
    card()
    expect(screen.getAllByText('Drafted — awaiting approval in the outbox')).toHaveLength(2)
  })
})
