// apps/web/src/components/members/ui/member-shared-section.test.tsx

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member } from '../types'

/**
 * Plan 46 §9's "Web" tests.
 *
 * Three behaviours, all of which are silent-failure shaped:
 *
 *  1. **A collapsed group fetches nothing.** First paint is one `GROUP BY`; the
 *     expand IS the page query. A group that fetched eagerly would turn a member
 *     page into one query per resource type.
 *  2. **Select-all-on-page and select-all-scope send DIFFERENT mutation inputs.**
 *     This is the whole point of §4.1: the store holds the loaded page's ids, so
 *     a sweep across 340 rows has to go out as `{ kind: 'all' }`. Sending
 *     `{ kind: 'ids' }` there silently misses every unloaded row — the exact
 *     failure the tab exists to prevent.
 *  3. **A blocked mail row is excluded from select-all.** It is rendered and
 *     counted (a hidden row is a row that silently survives revoke-all), but a
 *     viewer without inbox authority cannot sweep it, so it must never enter a
 *     selection that is about to be sent as a list of ids.
 */

const EMPTY_PAGE = {
  items: [] as MockItem[],
  total: 0,
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => {},
}

interface MockItem {
  recordId: string
  label: string
  rung: string
  grantedById: string | null
  createdAt: Date
  blockedReason: string | null
  targetMissing: boolean
  targetId: string
}

const { shares, groupCalls, pages, revoke, invalidate, confirmFn } = vi.hoisted(() => ({
  shares: { current: undefined as unknown },
  groupCalls: [] as Array<{ entityDefinitionId: string; enabled: boolean }>,
  pages: new Map<string, typeof EMPTY_PAGE>(),
  revoke: vi.fn(),
  invalidate: vi.fn(),
  confirmFn: vi.fn(),
}))

vi.mock('../hooks/use-member-shares', () => ({
  MEMBER_SHARES_PAGE_SIZE: 50,
  useMemberShares: () => shares.current,
  useMemberShareGroup: (params: { entityDefinitionId: string; enabled: boolean }) => {
    groupCalls.push({ entityDefinitionId: params.entityDefinitionId, enabled: params.enabled })
    return params.enabled ? (pages.get(params.entityDefinitionId) ?? EMPTY_PAGE) : EMPTY_PAGE
  },
  useRevokeMemberShares: () => ({ revoke, invalidate, isRevoking: false }),
  useGranterNames: () => new Map<string, string>(),
}))

vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [confirmFn, () => null],
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      member: { shareSummary: { invalidate: vi.fn() }, shares: { invalidate: vi.fn() } },
    }),
    resourceAccess: {
      revokeType: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}))

vi.mock('~/components/global/settings-page', () => ({
  SettingsSection: ({
    children,
    action,
  }: {
    children: React.ReactNode
    action?: React.ReactNode
  }) => (
    <div>
      {action}
      {children}
    </div>
  ),
}))

const { MemberSharedSection } = await import('./member-shared-section')

const VIEWER = 'usr_admin'
const MEMBER: Member = {
  id: 'mem_1',
  userId: 'usr_marki',
  organizationId: 'org_1',
  role: 'USER',
  seatType: 'full',
  user: { id: 'usr_marki', name: 'Marki Member', email: 'marki@example.com', image: null },
}

const OPEN_ROW: MockItem = {
  recordId: 'thread:thr_open',
  label: 'Re: Invoice 4471',
  rung: 'read',
  grantedById: VIEWER,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  blockedReason: null,
  targetMissing: false,
  targetId: 'thr_open',
}

const BLOCKED_ROW: MockItem = {
  recordId: 'thread:thr_blocked',
  label: 'Conversation in Support',
  rung: 'metadata',
  grantedById: VIEWER,
  createdAt: new Date('2026-09-01T09:00:00Z'),
  blockedReason: 'Needs access to Support',
  targetMissing: false,
  targetId: 'thr_blocked',
}

/**
 * An orphan: the label join found no row, so the server tombstoned it. The raw
 * cuid is kept but demoted — a cuid in the title tells the reader nothing — and
 * the row stays fully live, because clearing exactly these is one of the useful
 * things this tab does.
 */
const ORPHAN_ROW: MockItem = {
  recordId: 'thread:a932g9azi6d1cdbk4rkqbmjo',
  label: 'Deleted conversation',
  rung: 'read',
  grantedById: VIEWER,
  createdAt: new Date('2026-09-01T08:00:00Z'),
  blockedReason: null,
  targetMissing: true,
  targetId: 'a932g9azi6d1cdbk4rkqbmjo',
}

/**
 * The ActionBar's remove button. `getByText` will not do: the bar renders a
 * hidden measuring copy of every action alongside the visible one, so the label
 * matches twice.
 */
function bulkRemoveButton(): HTMLElement {
  const button = document.querySelector('[data-action-id="remove-shares"]')
  if (!button) throw new Error('no bulk remove action rendered')
  return button as HTMLElement
}

function setup() {
  return render(
    <TooltipProvider>
      <MemberSharedSection member={MEMBER} viewerId={VIEWER} />
    </TooltipProvider>
  )
}

beforeEach(() => {
  groupCalls.length = 0
  pages.clear()
  revoke.mockReset()
  revoke.mockResolvedValue({ revoked: 1, refused: [], refusedIds: [] })
  invalidate.mockReset()
  confirmFn.mockReset()
  confirmFn.mockResolvedValue(true)

  shares.current = {
    isLoading: false,
    instanceGroups: [
      {
        groupKey: 'thread',
        entityDefinitionId: 'thread',
        count: 340,
        kind: 'instance',
        label: 'Conversations',
        description: null,
        plural: 'conversations',
        icon: null,
      },
    ],
    typeGrants: [],
    owned: [],
    totalShared: 340,
    totalOwned: 0,
    searchScanCap: 500,
  }
  pages.set('thread', {
    ...EMPTY_PAGE,
    items: [OPEN_ROW, BLOCKED_ROW],
    total: 340,
  })
})

describe('MemberSharedSection', () => {
  it('does not fetch a collapsed group, and fetches it once opened', () => {
    setup()

    expect(groupCalls.length).toBeGreaterThan(0)
    expect(groupCalls.every((call) => call.enabled === false)).toBe(true)

    fireEvent.click(screen.getByLabelText('Expand'))

    expect(groupCalls.some((call) => call.entityDefinitionId === 'thread' && call.enabled)).toBe(
      true
    )
    expect(screen.getByText('Re: Invoice 4471')).toBeTruthy()
  })

  it('excludes a blocked row from the group select-all and from the revoke payload', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Expand'))

    // The blocked row is RENDERED — hiding it would let it silently survive a
    // revoke-all — it is only excluded from the selection.
    expect(screen.getByText('Conversation in Support')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Select every loaded conversations row'))
    fireEvent.click(bulkRemoveButton())

    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke).toHaveBeenCalledWith({
      kind: 'ids',
      recordIds: ['thread:thr_open'],
    })
  })

  it('sends the `all` scope once select-all-scope is taken, not the loaded ids', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Expand'))
    fireEvent.click(screen.getByLabelText('Select every loaded conversations row'))

    // Every loaded selectable row is selected and the member holds more — so the
    // Gmail line offers the scope.
    const scopeButton = screen.getByText('Select all 340 shared items')
    fireEvent.click(scopeButton)

    expect(bulkRemoveButton().textContent).toContain('Remove all 340')
    fireEvent.click(bulkRemoveButton())

    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke).toHaveBeenCalledWith({ kind: 'all' })
  })

  it('tombstones a deleted target and keeps the row selectable', async () => {
    pages.set('thread', { ...EMPTY_PAGE, items: [ORPHAN_ROW], total: 1 })
    setup()
    fireEvent.click(screen.getByLabelText('Expand'))

    // The kind of thing, not a cuid...
    const title = screen.getByText('Deleted conversation')
    expect(title.className).toContain('italic')
    // ...but the id survives for support.
    expect(screen.getByText(/a932g9azi6d1cdbk4rkqbmjo/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Select every loaded conversations row'))
    fireEvent.click(bulkRemoveButton())

    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke).toHaveBeenCalledWith({
      kind: 'ids',
      recordIds: ['thread:a932g9azi6d1cdbk4rkqbmjo'],
    })
  })

  it('is read-only when the viewer is looking at their own tab', () => {
    render(
      <TooltipProvider>
        <MemberSharedSection member={MEMBER} viewerId={MEMBER.userId} />
      </TooltipProvider>
    )
    fireEvent.click(screen.getByLabelText('Expand'))

    expect(screen.queryByLabelText('Select every loaded conversations row')).toBeNull()
    expect(document.querySelector('[data-action-id="remove-shares"]')).toBeNull()
  })
})
