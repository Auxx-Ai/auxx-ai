// apps/web/src/components/accounting/ui/__tests__/ledger-card-empty.test.tsx

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

const POSTED = {
  id: 'gp_1',
  docNumber: 'CM-0002',
  postingType: 'credit_memo',
  txnDate: '2026-09-01',
  totalMinor: 250_000,
  status: 'posted',
  linkRole: 'subject',
}

beforeEach(() => {
  state.postings = []
})

describe('the ledger card empty state', () => {
  it('says nothing posted when the record has no posting', () => {
    card()
    expect(screen.getByText('Nothing posted yet')).toBeInTheDocument()
  })

  // "Nothing posted yet" would read as "not posted" on a posted bill with no entry.
  it('names the way back when the record hands it one', () => {
    card('No entry — Edit then Save to post it again')
    expect(screen.getByText('No entry — Edit then Save to post it again')).toBeInTheDocument()
    expect(screen.queryByText('Nothing posted yet')).not.toBeInTheDocument()
  })

  it('lists a posted entry instead of the empty label', () => {
    state.postings = [POSTED]
    card()

    expect(screen.queryByText('Nothing posted yet')).not.toBeInTheDocument()
    expect(screen.getByText('CM-0002')).toBeInTheDocument()
  })
})
