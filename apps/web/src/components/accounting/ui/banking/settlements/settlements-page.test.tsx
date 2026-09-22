// apps/web/src/components/accounting/ui/banking/settlements/settlements-page.test.tsx
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import { type ComponentProps, Fragment, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  source: {
    amountMinor: '142301' as string | null,
    currency: 'USD',
    currencyExponent: 2,
    status: 'paid',
    issuedOn: '2026-09-15',
    provider: 'shopify_payments',
    gatewayName: null as string | null,
    routingIssue:
      'Select this merchant account and currency in Payment gateway settlement settings.' as
        | string
        | null,
    amountIssue: null as string | null,
  },
}))
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: () => false }),
  useRequireCapability: () => {},
}))
vi.mock('nuqs', () => ({ useQueryState: () => [false, vi.fn()] }))
vi.mock('./rail-strip', () => ({ RailStrip: () => null }))
vi.mock('../payouts/payout-evidence-drawer', () => ({ PayoutEvidenceDrawer: () => null }))
vi.mock('~/components/global/docked-panels-outlet', () => ({ useRegisterDockedPanels: () => {} }))
vi.mock('~/hooks/use-media', () => ({ useMedia: () => true }))
vi.mock('~/stores/dock-store', () => ({
  useDockStore: (selector: (s: unknown) => unknown) =>
    selector({ dockedWidth: 420, setDockedWidth: vi.fn() }),
}))
vi.mock('@auxx/ui/components/stat-card', () => ({ StatCards: () => null }))
vi.mock('@auxx/ui/components/tree-row-list', () => ({
  TreeRowList: ({
    items,
    renderRow,
  }: {
    items: unknown[]
    renderRow: (row: unknown) => ReactNode
  }) => (
    <>
      {items.map((row, index) => (
        <Fragment key={index}>{renderRow(row)}</Fragment>
      ))}
    </>
  ),
}))
vi.mock('@auxx/ui/components/tree-row', () => ({
  TREE_SECONDARY_NOTRUNCATE: '',
  TreeRowButton: ({ children }: { children: ReactNode }) => (
    <button type='button'>{children}</button>
  ),
  TreeRow: ({
    title,
    secondary,
    actions,
  }: {
    title: ReactNode
    secondary: ReactNode
    actions: ReactNode
  }) => (
    <div>
      {title}
      <div>{secondary}</div>
      {actions}
    </div>
  ),
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ money: { payout: { list: { invalidate: vi.fn() } } } }),
    paymentGateway: { list: { useQuery: () => ({ data: [] }) } },
    payoutEvidence: { idForExternalId: { useQuery: () => ({ data: null }) } },
    money: {
      payout: {
        list: {
          useInfiniteQuery: () => ({
            data: {
              pages: [
                {
                  items: [
                    {
                      payoutId: 'pay-1',
                      number: 'PAY-0001',
                      gatewayId: 'po_1',
                      paidAt: null,
                      depositedMinor: 0,
                      feesMinor: 0,
                      unrecognisedNetMinor: 0,
                      status: 'in_transit',
                      paymentGatewayId: null,
                      glPostingId: null,
                      sourceSummary: state.source,
                    },
                  ],
                  nextCursor: null,
                },
              ],
            },
          }),
        },
        syncNow: { useMutation: () => ({}) },
      },
    },
  },
}))

import { SettlementsPage } from './settlements-page'

/**
 * A real CLASS, for the reason `payouts-page.test.tsx` spells out: the shared
 * `IntersectionObserver` stub in `src/test/setup.ts` is a `vi.fn()`, which
 * throws "is not a constructor" the moment base-ui's `ScrollArea` viewport
 * constructs one — and the list now sits in a `ScrollArea`.
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

/** The toolbar's Clear is a `Tooltip`, which throws outside a provider. */
function renderPage() {
  return render(
    <TooltipProvider>
      <SettlementsPage />
    </TooltipProvider>
  )
}

describe('settlement rows', () => {
  it('renders imported money and setup instructions instead of zero and Unrouted', () => {
    renderPage()
    expect(screen.getByText('$1,423.01')).toBeInTheDocument()
    expect(screen.getByText('paid')).toBeInTheDocument()
    expect(screen.getByText('Pending accounting')).toBeInTheDocument()
    expect(screen.getByText(/Shopify Payments · Setup required/)).toBeInTheDocument()
    expect(screen.queryByText('Unrouted')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })
  it('renders the explicitly selected gateway', () => {
    state.source.gatewayName = 'Shopify merchant'
    state.source.routingIssue = null
    renderPage()
    // The rail is its own badge now and the date leads the row's title.
    expect(screen.getByText('Shopify merchant')).toBeInTheDocument()
    expect(screen.getByText('2026-09-15')).toBeInTheDocument()
    expect(screen.queryByText(/Setup required/)).not.toBeInTheDocument()
  })
  it('renders missing amounts honestly', () => {
    state.source.amountMinor = null
    state.source.amountIssue = 'Re-sync this payout.'
    renderPage()
    expect(screen.getByText('Amount unavailable')).toBeInTheDocument()
    expect(screen.getByText('Re-sync this payout.')).toBeInTheDocument()
  })
})
