// apps/web/src/components/accounting/ui/banking/payouts/payouts-page.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  payouts: [] as Record<string, unknown>[],
  accounts: [] as Record<string, unknown>[],
  /** The last input `payoutEvidence.list` was called with — the contract under test. */
  listInput: null as Record<string, unknown> | null,
}))

/**
 * `useQueryState` backed by `useState`, so `?s=`, `?payout=`, `?account=` and
 * `?status=` behave like real URL state for the duration of a test without a
 * router. Hook ORDER is what keys them, which is stable: the page always calls
 * the four in the same sequence.
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
  useAccess: () => ({ can: () => true }),
}))
vi.mock('~/components/global/settings-page', () => ({
  default: ({ subHeader, children }: { subHeader: ReactNode; children: ReactNode }) => (
    <div>
      {subHeader}
      {children}
    </div>
  ),
}))
vi.mock('@auxx/ui/components/responsive-tabs', () => ({
  ResponsiveTabs: ({
    items,
    onValueChange,
  }: {
    items: { value: string; label: string }[]
    onValueChange: (value: string) => void
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.value} type='button' onClick={() => onValueChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('~/components/global/docked-panels-outlet', () => ({ useRegisterDockedPanels: () => {} }))
vi.mock('~/hooks/use-media', () => ({ useMedia: () => false }))
vi.mock('~/hooks/use-viewport-fill', () => ({ useViewportFill: () => 600 }))
vi.mock('~/stores/dock-store', () => ({ useDockStore: () => 480 }))
vi.mock('./payout-evidence-drawer', () => ({ PayoutEvidenceDrawer: () => null }))
vi.mock('./processor-activity', () => ({ ProcessorActivity: () => <div>processor activity</div> }))
vi.mock('./rejected-processor-evidence', () => ({
  RejectedProcessorEvidence: () => <div>import issues</div>,
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
    },
  },
}))

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

const renderPage = () =>
  render(
    <TooltipProvider>
      <PayoutsPage />
    </TooltipProvider>
  )

beforeEach(() => {
  state.payouts = [PAYOUT]
  state.accounts = [ACCOUNT]
  state.listInput = null
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

  it('puts the status on the query and offers the union of both provider vocabularies', () => {
    renderPage()

    // `canceled` comes from `PayoutHeader.status`, `reversed` from the record
    // side's `PAYOUT_STATUSES` — neither list alone covers the rows.
    for (const label of ['All', 'Paid', 'In transit', 'Failed', 'Canceled', 'Reversed']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

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
    fireEvent.click(screen.getByText('Clear'))
    expect(state.listInput?.search).toBeUndefined()
    expect(state.listInput?.status).toBe('failed')
  })

  it('offers Clear only once something on row two is set', () => {
    renderPage()
    expect(screen.queryByText('Clear')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search payout id'), {
      target: { value: 'po_1' },
    })
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  it('narrows to the worklist and counts as row-two dirt', () => {
    renderPage()
    expect(state.listInput?.needsMatching).toBeUndefined()

    fireEvent.click(screen.getByText('Needs matching'))
    expect(state.listInput?.needsMatching).toBe(true)
    expect(screen.getByText('Clear')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Clear'))
    expect(state.listInput?.needsMatching).toBeUndefined()
  })

  it('shows the open count and the dominant code on a row that has one', () => {
    state.payouts = [{ ...PAYOUT, needsMatchingCount: 16, dominantMatchReason: 'no_rail' }]
    renderPage()
    expect(screen.getByText('16 need matching')).toBeInTheDocument()
    expect(screen.getByText('Feed has no gateway')).toBeInTheDocument()
  })

  it('renders only on the payouts tab', () => {
    renderPage()
    expect(screen.getByPlaceholderText('Search payout id')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Import issues'))
    expect(screen.getByText('import issues')).toBeInTheDocument()
    // Import issues reads a different query, so every one of these filters would
    // be a control that does nothing.
    expect(screen.queryByPlaceholderText('Search payout id')).not.toBeInTheDocument()
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
