// apps/web/src/components/detail-view/detail-view-not-found.test.tsx
//
// Plan v3/04 §9 — mount 4's **generic-label rule**.
//
// D2 accepted a bounded EXISTENCE oracle on this screen: a request that sends
// confirms the record exists in this org, one refused as `target_unavailable`
// confirms it does not. It did NOT accept a CONTENT leak. The server already
// enforces the rule (`buildRecordSubjectLabel` returns the definition noun alone
// for a `none` requester); this file pins the client's half of it, which is to
// not undo it by reading a name from a store or a prop.
//
// The second rule here is §8.3's: the record is not in the store on this screen,
// so the ask must be forced to `none` rather than letting the def fallback answer
// for a record the member demonstrably cannot reach.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_ticket0000000000000000000'
const ROW = 'ein_row000000000000000000000'

const h = vi.hoisted(() => ({
  preflightCalls: [] as unknown[],
  /** What the SERVER composed. The def noun alone is the `none`-requester answer. */
  subjectLabel: 'Ticket' as string | null,
}))

vi.mock('~/providers/capabilities-provider', () => ({
  // Records: Full at the DEF level — the fallback `useRecordAccessFor` would use
  // for an unstamped row, and exactly the wrong answer for this screen.
  useAccess: () => ({ recordDefRung: () => 'edit', canDeleteRecordAt: () => true }),
}))
vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
// `MainPage`'s header renders a `SidebarTrigger`, which needs the app shell's
// provider. The chrome is not what this file is about.
vi.mock('@auxx/ui/components/main-page', () => ({
  MainPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageBreadcrumb: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MainPageBreadcrumbItem: ({ title }: { title: string }) => <span>{title}</span>,
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ approval: { recordAccessRequestPreflight: { invalidate: vi.fn() } } }),
    approval: {
      recordAccessRequestPreflight: {
        useQuery: (input: unknown, opts: { enabled: boolean }) => {
          if (opts.enabled) h.preflightCalls.push(input)
          return {
            data: opts.enabled
              ? {
                  eligible: true,
                  currentRung: 'none',
                  requestedRung: 'read',
                  pending: null,
                  approvers: [],
                  subjectLabel: h.subjectLabel,
                  refusalReason: null,
                }
              : undefined,
            isLoading: false,
          }
        },
      },
      requestRecordAccess: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      withdrawAccessRequest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))

const { useRecordStore } = await import('~/components/resources/store/record-store')
const { DetailViewNotFound } = await import('./detail-view-not-found')

beforeAll(() => {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
})

beforeEach(() => {
  h.preflightCalls = []
  h.subjectLabel = 'Ticket'
  useRecordStore.setState({ records: {}, attemptedIds: new Set() })
})

describe('the not-found screen offers an ask instead of an ambiguous hint', () => {
  it('asks for `none → read`, never `read → edit`, despite a def rung of `edit`', () => {
    render(
      <DetailViewNotFound
        label='Ticket'
        backUrl='/app/tickets'
        entityDefinitionId={DEF}
        entityInstanceId={ROW}
      />
    )

    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request edit access' })).not.toBeInTheDocument()
  })

  it('drops the "you may not have permission" clause once the control is there', () => {
    render(
      <DetailViewNotFound
        label='Ticket'
        backUrl='/app/tickets'
        entityDefinitionId={DEF}
        entityInstanceId={ROW}
      />
    )
    expect(screen.queryByText(/permission to view it/i)).not.toBeInTheDocument()
  })

  it('keeps the ambiguous copy when there is no record to ask about', () => {
    render(<DetailViewNotFound label='Ticket' backUrl='/app/tickets' />)
    expect(screen.getByText(/permission to view it/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Request/ })).not.toBeInTheDocument()
  })
})

describe('🔴 the generic-label rule (§9)', () => {
  it('renders the DEFINITION NOUN the server composed, and no display name', async () => {
    // A row for this exact record IS in the store, carrying a name. The screen
    // must not reach for it: an existence oracle that starts printing
    // "Ticket · ACME onboarding" is a content leak, which is not what D2 accepted.
    useRecordStore
      .getState()
      .setRecords(DEF, [
        { id: ROW, createdAt: new Date(), updatedAt: new Date(), displayName: 'ACME onboarding' },
      ])

    render(
      <DetailViewNotFound
        label='Ticket'
        backUrl='/app/tickets'
        entityDefinitionId={DEF}
        entityInstanceId={ROW}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }))

    // The breadcrumb already carried the noun, so match on all of them: what
    // matters is that the popover shows the noun and NOT the name beside it.
    expect(screen.getAllByText('Ticket').length).toBeGreaterThan(0)
    expect(screen.queryByText(/ACME onboarding/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ticket · /)).not.toBeInTheDocument()
  })

  it('renders nothing where the label would be when the server withheld one', async () => {
    h.subjectLabel = null
    useRecordStore
      .getState()
      .setRecords(DEF, [
        { id: ROW, createdAt: new Date(), updatedAt: new Date(), displayName: 'ACME onboarding' },
      ])

    render(
      <DetailViewNotFound
        label='Ticket'
        backUrl='/app/tickets'
        entityDefinitionId={DEF}
        entityInstanceId={ROW}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }))

    expect(screen.queryByText(/ACME onboarding/)).not.toBeInTheDocument()
  })

  it('still pays nothing until the ask is opened', () => {
    render(
      <DetailViewNotFound
        label='Ticket'
        backUrl='/app/tickets'
        entityDefinitionId={DEF}
        entityInstanceId={ROW}
      />
    )
    expect(h.preflightCalls).toHaveLength(0)
  })
})
