// apps/web/src/components/global/notifications/ui/approvals-duplicates.test.tsx
//
// The Approvals tab's fifth section (duplicate plan §3.2 / §3.6).
//
// Four claims, all of which have a cheap way to be wrong:
//
//  1. **The section renders, LAST.** The tab is a fixed urgency ladder, and data
//     hygiene is the least urgent lane in it — a section that drifts up the
//     order pushes an expiring workflow confirmation below a pair that will
//     still be a duplicate tomorrow.
//  2. **The flag OFF means no section AND no query.** Skipping the query is the
//     half that a "does the section render" assertion alone would miss, and the
//     router refuses outright rather than answering empty, so a query that ran
//     anyway would surface as an error state.
//  3. **Review & merge pre-fills the dialog best-established-first.** The dialog
//     defaults its target to the FIRST id it is handed, so the order IS the
//     target choice.
//  4. **Dismiss resolves the row** through the shared mutation.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `InfiniteScroll` constructs a real `IntersectionObserver` in a layout effect,
// and the shared setup file installs an arrow function rather than a class. The
// section only started mounting one when it gained load-more.
class NoopIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = ''
  thresholds: number[] = []
}
vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)

const DEF = 'edf_contact00000000000000000'
const LOW = 'ein_low000000000000000000000'
const HIGH = 'ein_high00000000000000000000'

const h = vi.hoisted(() => ({
  /** Whether `FeatureKey.duplicateDetection` is granted. */
  duplicatesEnabled: true,
  /** Inputs the duplicates list query was ENABLED for — a lazy-query probe. */
  listCalls: [] as unknown[],
  dismissCalls: [] as unknown[],
  /** `baseRecordIds` the merge dialog was mounted with. */
  mergeProps: [] as unknown[],
  items: [] as unknown[],
  /** Non-null ⇒ the section has another page to load. */
  nextCursor: null as unknown,
  fetchNextPage: vi.fn(),
}))

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({
    hasAccess: (key: string) => (key === 'duplicateDetection' ? h.duplicatesEnabled : true),
  }),
}))

vi.mock('~/components/mail-suggestions/hooks/use-mail-suggestions', () => ({
  useMailSuggestions: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// The other four sections' rows pull unrelated tRPC/query graphs. Their lists
// are empty here anyway — mocking them keeps this file about the fifth section.
vi.mock('./items/access-request-row', () => ({ AccessRequestRow: () => null }))
vi.mock('./items/confirmation-row', () => ({ ConfirmationRow: () => null }))
vi.mock('./items/decided-row', () => ({ DecidedRow: () => null }))
vi.mock('./items/suggestion-row', () => ({ SuggestionRow: () => null }))
vi.mock('./items/mail-suggestion-row', () => ({ MailSuggestionRow: () => null }))

// A probe, not a stub: what the dialog is HANDED is claim 3.
vi.mock('~/components/merge/merge-dialog', () => ({
  MergeDialog: (props: Record<string, unknown>) => {
    h.mergeProps.push(props)
    return <div data-testid='merge-dialog' />
  },
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      approval: { list: { invalidate: vi.fn() }, getPendingCount: { invalidate: vi.fn() } },
      approvals: { list: { invalidate: vi.fn() }, count: { invalidate: vi.fn() } },
      mailSuggestions: { count: { invalidate: vi.fn() } },
      duplicates: {
        list: { invalidate: vi.fn() },
        count: { invalidate: vi.fn() },
        forRecord: { invalidate: vi.fn() },
      },
    }),
    approval: {
      list: {
        useQuery: () => ({ data: { items: [] }, isLoading: false, error: null, refetch: vi.fn() }),
        useInfiniteQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
    },
    approvals: {
      list: {
        useInfiniteQuery: () => ({
          data: undefined,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      },
    },
    duplicates: {
      list: {
        useInfiniteQuery: (input: unknown, opts: { enabled: boolean }) => {
          if (opts.enabled) h.listCalls.push(input)
          return {
            data: opts.enabled
              ? { pages: [{ items: h.items, nextCursor: h.nextCursor }] }
              : undefined,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
            hasNextPage: !!h.nextCursor,
            isFetchingNextPage: false,
            fetchNextPage: h.fetchNextPage,
          }
        },
      },
      dismiss: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            h.dismissCalls.push(input)
            opts.onSuccess?.()
          },
          isPending: false,
        }),
      },
    },
  },
}))

import { ApprovalsTab } from './approvals-tab'

function pair(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dup_1',
    entityDefinitionId: DEF,
    score: 0.95,
    band: 'high',
    signals: [{ type: 'email', strength: 'strong', value: 'bob@acme.test' }],
    createdAt: new Date().toISOString(),
    // The whole CLUSTER, best-established first — the router emits one item per
    // connected component, not one per stored pair.
    records: [
      {
        instanceId: HIGH,
        displayName: 'Robert Smith',
        secondaryDisplayValue: 'bob@acme.test',
        avatarUrl: null,
      },
      {
        instanceId: LOW,
        displayName: 'Bob Smith',
        secondaryDisplayValue: 'bob@acme.test',
        avatarUrl: null,
      },
    ],
    // Server-decided order: the HIGH record is better established, so it must
    // survive the merge even though canonical pair order puts LOW first.
    mergeInstanceIds: [HIGH, LOW],
    ...overrides,
  }
}

function renderTab() {
  const viewportRef = { current: null }
  return render(<ApprovalsTab viewportRef={viewportRef} />)
}

beforeEach(() => {
  h.duplicatesEnabled = true
  h.listCalls = []
  h.dismissCalls = []
  h.mergeProps = []
  h.items = [pair()]
  h.nextCursor = null
  h.fetchNextPage = vi.fn()
})

describe('the Possible duplicates section', () => {
  it('renders both records and the matched value', () => {
    renderTab()

    expect(screen.getByText('Possible duplicates')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('Robert Smith')).toBeInTheDocument()
    // The chip names the matched VALUE, not just the field — multi-value email
    // means "matched on: email" cannot say which address.
    expect(screen.getAllByText('bob@acme.test').length).toBeGreaterThan(0)
  })

  it('is hidden AND unqueried when the org lacks the feature', () => {
    h.duplicatesEnabled = false
    renderTab()

    expect(screen.queryByText('Possible duplicates')).not.toBeInTheDocument()
    // The query must be SKIPPED, not merely ignored: the router refuses without
    // the flag, so a query that ran would produce an error, not an empty list.
    expect(h.listCalls).toHaveLength(0)
  })

  it('is hidden when there are no open pairs', () => {
    h.items = []
    renderTab()
    expect(screen.queryByText('Possible duplicates')).not.toBeInTheDocument()
  })

  it('leaves the all-caught-up state alone when duplicates are the only source', () => {
    h.items = []
    renderTab()
    expect(screen.getByText('Nothing needs your approval')).toBeInTheDocument()
  })

  it('renders every record of a CLUSTER on one card', () => {
    // Three records that all duplicate each other are three stored pairs
    // offering the same merge. Rendering them as three rows meant two of them
    // read as the same pair reversed — five clusters ate 15 of 25 slots on dev.
    const third = 'ein_third0000000000000000000'
    h.items = [
      pair({
        records: [
          ...(pair().records as unknown[]),
          {
            instanceId: third,
            displayName: 'Bobby Smith',
            secondaryDisplayValue: 'bob@acme.test',
            avatarUrl: null,
          },
        ],
        mergeInstanceIds: [HIGH, LOW, third],
      }),
    ]
    renderTab()

    expect(screen.getByText('Robert Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('Bobby Smith')).toBeInTheDocument()
    // One card, not three: the section header counts items, not records.
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('pages rather than stranding the pairs the badge counts', () => {
    // A fixed-size query left the difference between the badge and the first
    // page counted but unreachable — badge 70, list 25, no load-more.
    h.nextCursor = { score: 0.9, id: 'dup_1' }
    renderTab()

    expect(h.listCalls).toHaveLength(1)
    // The cursor input is what makes the next page fetchable at all.
    expect(h.listCalls[0]).toEqual({ limit: 25 })
  })
})

describe('Review & merge', () => {
  it('pre-fills the dialog with the cluster, best-established first', async () => {
    renderTab()
    await userEvent.click(screen.getByText('Review & merge'))

    expect(screen.getByTestId('merge-dialog')).toBeInTheDocument()
    const props = h.mergeProps.at(-1) as { baseRecordIds: string[]; targetRecordId?: string }
    // The dialog defaults its target to the first id, so the ORDER is the
    // target choice — pair order would have put LOW (an arbitrary cuid sort)
    // first, which is how "merged into the empty stub" happens.
    expect(props.baseRecordIds).toEqual([`${DEF}:${HIGH}`, `${DEF}:${LOW}`])
    // No explicit target from this entry point: the ordering already decided it.
    expect(props.targetRecordId).toBeUndefined()
  })

  it('does not mount the dialog until it is asked for', () => {
    renderTab()
    expect(screen.queryByTestId('merge-dialog')).not.toBeInTheDocument()
  })
})

describe('Dismiss', () => {
  it('sends the pair id and resolves the row', async () => {
    renderTab()
    await userEvent.click(screen.getByText('Dismiss'))
    expect(h.dismissCalls).toEqual([{ pairId: 'dup_1' }])
  })

  it('snoozes with a future date rather than dismissing', async () => {
    renderTab()
    await userEvent.click(screen.getByLabelText('Duplicate actions'))
    await userEvent.click(await screen.findByText('Snooze'))
    await userEvent.click(await screen.findByText('Next week'))

    const call = h.dismissCalls.at(-1) as { pairId: string; snoozeUntil: Date }
    expect(call.pairId).toBe('dup_1')
    // Snoozed is `open` plus a FUTURE snoozeUntil — a past date would put the
    // pair straight back in the queue.
    expect(call.snoozeUntil.getTime()).toBeGreaterThan(Date.now())
  })
})
