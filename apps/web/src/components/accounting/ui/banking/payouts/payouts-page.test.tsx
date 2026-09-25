// apps/web/src/components/accounting/ui/banking/payouts/payouts-page.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  payouts: [] as Record<string, unknown>[],
  accounts: [] as Record<string, unknown>[],
  counts: { rejected: 0, unassignedCount: 0, unassignedTotals: [] } as Record<string, unknown>,
  /** The last input `payoutEvidence.list` was called with — the contract under test. */
  listInput: null as Record<string, unknown> | null,
  canPost: true,
  recheck: vi.fn(),
}))

/**
 * `useQueryState` backed by `useState`, so `?payout=`, `?account=` and
 * `?status=` behave like real URL state for the duration of a test without a
 * router. Hook ORDER is what keys them, which is stable: the page always calls
 * the three in the same sequence.
 */
vi.mock('nuqs', async () => {
  const { useState } = await import('react')
  return {
    parseAsStringLiteral: () => ({
      withDefault: (defaultValue: string) => ({ defaultValue }),
    }),
    useQueryState: (_key: string, options?: { defaultValue?: string }) =>
      useState<string | null>(options?.defaultValue ?? null),
  }
})

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}))
vi.mock('~/providers/capabilities-provider', () => ({
  useRequireCapability: () => {},
  useAccess: () => ({ can: () => state.canPost }),
}))
vi.mock('~/components/global/docked-panels-outlet', () => ({ useRegisterDockedPanels: () => {} }))
vi.mock('~/hooks/use-media', () => ({ useMedia: () => false }))
vi.mock('~/stores/dock-store', () => ({ useDockStore: () => 480 }))
vi.mock('./payout-evidence-drawer', () => ({ PayoutEvidenceDrawer: () => null }))
vi.mock('./processor-activity', () => ({ ProcessorActivity: () => <div>processor activity</div> }))
vi.mock('./rejected-processor-evidence', () => ({
  RejectedProcessorEvidenceDrawer: ({ open }: { open: boolean }) =>
    open ? <div>import issues</div> : null,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ payoutEvidence: { invalidate: vi.fn() } }),
    payoutEvidence: {
      list: {
        useInfiniteQuery: (input: Record<string, unknown>) => {
          state.listInput = input
          return {
            data: { pages: [{ items: state.payouts, nextCursor: null }] },
            error: null,
            isPending: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
          }
        },
      },
      sourceAccounts: { useQuery: () => ({ data: state.accounts, isPending: false }) },
      counts: { useQuery: () => ({ data: state.counts }) },
      recheckMatches: {
        useMutation: () => ({ mutate: state.recheck, isPending: false }),
      },
    },
  },
}))

import {
  ModuleToolbarOutletProvider,
  useModuleToolbarOutlet,
} from '~/components/global/module-toolbar-outlet'
import { PayoutsPage } from './payouts-page'

/**
 * A real CLASS, for the reason `src/test/setup.ts` spells out beside its
 * `ResizeObserver`: the shared `IntersectionObserver` stub there is a
 * `vi.fn().mockImplementation(() => ({…}))`, which throws "is not a
 * constructor" the moment something does `new IntersectionObserver(…)` — and
 * base-ui's `ScrollArea` viewport does, before this page's own sentinel ever
 * gets a chance to.
 */
class NoopIntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: number[] = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)

/** jsdom implements no scrolling at all, and the filter-change effect scrolls. */
Element.prototype.scrollTo = () => {}

const ACCOUNT = {
  id: 'src-1',
  providerKey: 'shopify_payments',
  externalAccountId: 'gid://shopify/ShopifyPaymentsAccount/999000223183024',
  environment: 'live',
}

const PAYOUT = {
  id: 'payout-1',
  externalId: 'po_12345',
  occurredOn: '2026-09-15',
  occurredAt: null,
  providerKey: 'shopify_payments',
  externalAccountId: ACCOUNT.externalAccountId,
  environment: 'live',
  reconciliationState: 'reconciled',
  membershipState: 'complete',
  sourceAmountMinor: '142301',
  sourceCurrency: 'USD',
  sourceCurrencyExponent: 2,
  status: 'paid',
  blockers: [] as string[],
  needsMatchingCount: 0,
  dominantMatchReason: null as string | null,
}

/** The real outlet, so the topbar the page publishes into is assertable. */
function Toolbar() {
  const { left, right } = useModuleToolbarOutlet()
  return (
    <div>
      {left}
      {right}
    </div>
  )
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <ModuleToolbarOutletProvider>
        <Toolbar />
        <PayoutsPage />
      </ModuleToolbarOutletProvider>
    </TooltipProvider>
  )

beforeEach(() => {
  state.payouts = [PAYOUT]
  state.accounts = [ACCOUNT]
  state.counts = { rejected: 0, unassignedCount: 0, unassignedTotals: [] }
  state.listInput = null
  state.canPost = true
  state.recheck.mockClear()
})

describe('payouts filter toolbar', () => {
  it('sends no filter at all until one is set', () => {
    renderPage()

    expect(screen.getByText('po_12345')).toBeInTheDocument()
    // 🛑 `undefined`, never `''` and never `'all'`: an empty string is a filter
    // the server would honour by matching nothing.
    expect(state.listInput).toEqual({
      limit: 50,
      sourceAccountId: undefined,
      status: undefined,
      search: undefined,
      from: undefined,
      to: undefined,
    })
  })

  it('offers only the three ways a payout did not land', () => {
    renderPage()

    for (const label of ['All', 'Failed', 'Canceled', 'Reversed']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // 🛑 81 §5.5: the row's dot already says `paid`, and `in_transit` resolves
    // itself — as filters they are approximately `All` and nothing.
    expect(screen.queryByText('Paid')).not.toBeInTheDocument()
    expect(screen.queryByText('In transit')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Failed'))
    expect(state.listInput?.status).toBe('failed')
  })

  it('trims the search and clears row two without dropping the view', () => {
    renderPage()

    fireEvent.click(screen.getByText('Failed'))
    fireEvent.change(screen.getByPlaceholderText('Search payout id'), {
      target: { value: '  po_123  ' },
    })
    expect(state.listInput?.search).toBe('po_123')

    // Clear is row two only — the status is the VIEW and lives in the URL, so a
    // Clear that reset it would drop the link somebody arrived on.
    fireEvent.click(screen.getByLabelText('Clear all'))
    expect(state.listInput?.search).toBeUndefined()
    expect(state.listInput?.status).toBe('failed')
  })

  it('keeps Clear in place and only enables it once row two is set', () => {
    renderPage()
    // Present but DISABLED, never absent: gating it on dirt re-flowed the row on
    // the first keystroke in the search beside it.
    expect(screen.getByLabelText('Clear all')).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Search payout id'), {
      target: { value: 'po_1' },
    })
    expect(screen.getByLabelText('Clear all')).toBeEnabled()
  })

  it('narrows to the worklist and counts as row-two dirt', () => {
    renderPage()
    expect(state.listInput?.needsMatching).toBeUndefined()

    fireEvent.click(screen.getByText('Needs matching'))
    expect(state.listInput?.needsMatching).toBe(true)
    expect(screen.getByLabelText('Clear all')).toBeEnabled()

    fireEvent.click(screen.getByLabelText('Clear all'))
    expect(state.listInput?.needsMatching).toBeUndefined()
  })

  it('shows the open count, but not the dominant code, on a row that has one', () => {
    state.payouts = [{ ...PAYOUT, needsMatchingCount: 16, dominantMatchReason: 'no_rail' }]
    renderPage()
    expect(screen.getByText('16 need matching')).toBeInTheDocument()
    expect(screen.queryByText('Feed has no gateway')).not.toBeInTheDocument()
  })

  it('re-checks matches from beside the worklist toggle', () => {
    renderPage()
    fireEvent.click(screen.getByText('Re-check matches'))
    expect(state.recheck).toHaveBeenCalledOnce()
  })

  it('hides Re-check matches without ledger post access', () => {
    state.canPost = false
    renderPage()
    expect(screen.queryByText('Re-check matches')).not.toBeInTheDocument()
  })
})

describe('payouts topbar', () => {
  it('hides the import-issues door at zero and opens the panel when there are some', () => {
    renderPage()
    expect(screen.queryByText(/Import issues/)).not.toBeInTheDocument()

    state.counts = { rejected: 3, unassignedCount: 0, unassignedTotals: [] }
    renderPage()
    fireEvent.click(screen.getByText('Import issues (3)'))
    expect(screen.getByText('import issues')).toBeInTheDocument()
  })

  it('states the unassigned balance without implying work is owed', () => {
    state.counts = {
      rejected: 0,
      unassignedCount: 1,
      unassignedTotals: [{ currency: 'USD', currencyExponent: 2, netMinor: '7500', count: 1 }],
    }
    renderPage()

    expect(screen.getByText('$75.00')).toBeInTheDocument()
    expect(screen.getByText('of processor activity is not yet in a payout')).toBeInTheDocument()
    // It expands to the same list the deleted tab held, and the list is not
    // rendered until it does.
    expect(screen.queryByText('processor activity')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('of processor activity is not yet in a payout'))
    expect(screen.getByText('processor activity')).toBeInTheDocument()
  })
})

describe('payouts empty states', () => {
  it('blames the filters when payouts exist but none match', () => {
    state.payouts = []
    renderPage()

    expect(screen.getByText('Nothing in this view')).toBeInTheDocument()
    // 🛑 Sending somebody whose filters excluded everything to the connectors
    // page is the wrong answer, and it hides the one thing that would fix it.
    expect(screen.queryByText('Open connectors')).not.toBeInTheDocument()
  })

  it('points at the connectors when nothing has ever been imported', () => {
    state.payouts = []
    state.accounts = []
    renderPage()

    expect(screen.getByText('No payout evidence yet')).toBeInTheDocument()
    expect(screen.getByText('Open connectors')).toBeInTheDocument()
  })
})
