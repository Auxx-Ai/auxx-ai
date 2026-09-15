// apps/web/src/components/accounting/ui/banking/settlements/settlements-page.test.tsx
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
vi.mock('~/components/global/settings-page', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('./rail-strip', () => ({ RailStrip: () => null }))
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
  TreeRow: ({
    title,
    secondary,
    trailing,
  }: {
    title: string
    secondary: string
    trailing: ReactNode
  }) => (
    <div>
      {title}
      <div>{secondary}</div>
      {trailing}
    </div>
  ),
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ money: { payout: { list: { invalidate: vi.fn() } } } }),
    paymentGateway: { list: { useQuery: () => ({ data: [] }) } },
    money: {
      payout: {
        list: {
          useQuery: () => ({
            data: [
              {
                payoutId: 'pay-1',
                number: 'PAY-0001',
                depositedMinor: 0,
                feesMinor: 0,
                unrecognisedNetMinor: 0,
                status: 'in_transit',
                paymentGatewayId: null,
                glPostingId: null,
                sourceSummary: state.source,
              },
            ],
          }),
        },
        syncNow: { useMutation: () => ({}) },
      },
    },
  },
}))

import { SettlementsPage } from './settlements-page'

describe('settlement rows', () => {
  it('renders imported money and setup instructions instead of zero and Unrouted', () => {
    render(<SettlementsPage />)
    expect(screen.getByText('USD 1,423.01')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.getByText('Pending accounting')).toBeInTheDocument()
    expect(screen.getByText(/Shopify Payments · Setup required/)).toBeInTheDocument()
    expect(screen.queryByText('Unrouted')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })
  it('renders the explicitly selected gateway', () => {
    state.source.gatewayName = 'Shopify merchant'
    state.source.routingIssue = null
    render(<SettlementsPage />)
    expect(screen.getByText(/Shopify merchant · 2026-09-15/)).toBeInTheDocument()
    expect(screen.queryByText(/Setup required/)).not.toBeInTheDocument()
  })
  it('renders missing amounts honestly', () => {
    state.source.amountMinor = null
    state.source.amountIssue = 'Re-sync this payout.'
    render(<SettlementsPage />)
    expect(screen.getByText('Amount unavailable')).toBeInTheDocument()
    expect(screen.getByText('Re-sync this payout.')).toBeInTheDocument()
  })
})
