// apps/web/src/components/mail-permissions/ui/request-access-popover.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 42 §6's requester side — the eligibility truth table and the pending swap.
 *
 * Both are gating rules whose failure mode is a control appearing where it makes no
 * sense, which is exactly what does not show up in a screenshot of the happy path:
 *
 *  - A **full-lens** viewer has nothing to ask for.
 *  - A **Manager or org admin** below `full` can grant themselves access directly and
 *    must get the sharing path, never an approval flow (§6.1 — `canShare` is half of
 *    the condition, and the half most likely to be dropped).
 *  - A **worker seat** is refused with the SEAT named, because no permission change
 *    lifts it (§5.3) — a dead button would imply one might.
 *  - Once sent, the trigger must **swap**, or a one-click ask becomes one-click spam
 *    (§6.4).
 *
 * The header label is asserted to come from the SERVER (`preflight.subjectLabel`).
 * That is the `metadata`-lens case: the client has no subject to render there, and a
 * client-composed header renders an empty string instead of degrading (§6.2).
 */

const h = vi.hoisted(() => ({
  myLens: 'metadata' as 'metadata' | 'subject' | 'full',
  isAdminOrOwner: false,
  canAdminInstance: false,
  preflight: {
    eligible: true,
    currentLens: 'metadata',
    pending: null as { id: string; createdAt: Date; remindedAt: string | null } | null,
    approvers: [{ userId: 'u_sarah', name: 'Sarah Chen', image: null }],
    approversAre: 'managers' as 'managers' | 'admins' | null,
    subjectLabel: 'Support · 2 participants · 4 messages',
    refusalReason: null as string | null,
  },
  requestAccess: vi.fn(),
  withdrawAccessRequest: vi.fn(),
}))

vi.mock('~/components/threads/hooks', () => ({
  useThread: () => ({ thread: { id: 'thr_1', inboxId: 'ibx_1', myLens: h.myLens } }),
  useInbox: () => ({ inbox: { id: 'ibx_1', entityDefinitionKey: 'inbox', name: 'Support' } }),
  toInboxAccessRecordId: (inbox: { entityDefinitionKey: string; id: string }) =>
    `${inbox.entityDefinitionKey}:${inbox.id}`,
}))
vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ isAdminOrOwner: h.isAdminOrOwner }) }))
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ canAdminInstance: () => h.canAdminInstance }),
}))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      approval: { accessRequestPreflight: { invalidate: vi.fn() } },
    }),
    approval: {
      accessRequestPreflight: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) => ({
          // The query is gated on the client pair, so a full-lens viewer or a
          // Manager never even asks — mirroring that here keeps the test honest
          // about WHY the trigger is absent.
          data: opts.enabled ? h.preflight : undefined,
          isLoading: false,
        }),
      },
      requestAccess: { useMutation: () => ({ mutate: h.requestAccess, isPending: false }) },
      withdrawAccessRequest: {
        useMutation: () => ({ mutate: h.withdrawAccessRequest, isPending: false }),
      },
    },
  },
}))
vi.mock('./access-levels-guide', () => ({ AccessLevelsGuide: () => null }))
vi.mock('../../global/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}))

const { RequestAccessPopover } = await import('./request-access-popover')

beforeAll(() => {
  // Radix/floating-ui's `autoUpdate` CONSTRUCTS a ResizeObserver; the global setup
  // stubs one that cannot be `new`ed. Same pattern as `agent-instance-access.test.tsx`.
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
  vi.clearAllMocks()
  h.myLens = 'metadata'
  h.isAdminOrOwner = false
  h.canAdminInstance = false
  h.preflight = {
    eligible: true,
    currentLens: 'metadata',
    pending: null,
    approvers: [{ userId: 'u_sarah', name: 'Sarah Chen', image: null }],
    approversAre: 'managers',
    subjectLabel: 'Support · 2 participants · 4 messages',
    refusalReason: null,
  }
})

describe('eligibility truth table (plan 42 §6.3)', () => {
  it('offers the request to a sub-full member who cannot share', () => {
    render(<RequestAccessPopover threadId='thr_1' />)
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
  })

  it('renders NOTHING for a full-lens viewer — there is nothing to ask for', () => {
    h.myLens = 'full'
    const { container } = render(<RequestAccessPopover threadId='thr_1' />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders NOTHING for a sub-full ORG ADMIN — they grant themselves access directly', () => {
    h.isAdminOrOwner = true
    const { container } = render(<RequestAccessPopover threadId='thr_1' />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders NOTHING for a sub-full INBOX MANAGER — the sharing path, not an approval', () => {
    h.canAdminInstance = true
    const { container } = render(<RequestAccessPopover threadId='thr_1' />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('refusals that name a lever (plan 42 §5.3)', () => {
  it('names the SEAT for a worker seat instead of rendering a dead button', () => {
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'worker_seat' }
    render(<RequestAccessPopover threadId='thr_1' />)

    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
    // The copy must point at the seat, not the profile: naming a lever the approver
    // cannot pull is worse than naming none.
    expect(screen.getByText(/Field seats/i)).toBeInTheDocument()
    expect(screen.queryByText(/permission profile/i)).not.toBeInTheDocument()
  })

  it('names the closed profile when that is the actual lever', () => {
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'front_door_closed' }
    render(<RequestAccessPopover threadId='thr_1' />)
    expect(screen.getByText(/permission profile/i)).toBeInTheDocument()
  })

  it('stays silent in the header slot, where there is no room for a sentence', () => {
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'worker_seat' }
    const { container } = render(<RequestAccessPopover threadId='thr_1' variant='icon' />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the popover body (plan 42 §6.2)', () => {
  it('renders the SERVER-composed header and names the approver', async () => {
    render(<RequestAccessPopover threadId='thr_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }))

    // Server-composed: at `metadata` the requester has no subject to render, so a
    // client-composed header would be an empty string rather than this summary.
    expect(screen.getByText('Support · 2 participants · 4 messages')).toBeInTheDocument()
    expect(screen.getByText('Sarah Chen (inbox manager)')).toBeInTheDocument()
  })

  it('discloses the note behind a toggle whose label switches once written', async () => {
    render(<RequestAccessPopover threadId='thr_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }))

    expect(screen.queryByPlaceholderText('Why do you need access?')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add a note/ }))

    const note = screen.getByPlaceholderText('Why do you need access?')
    await userEvent.type(note, 'Covering for Sarah this week')
    expect(screen.getByRole('button', { name: /Edit note/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(h.requestAccess).toHaveBeenCalledWith({
      threadId: 'thr_1',
      message: 'Covering for Sarah this week',
    })
  })

  it('sends without a note — most requests carry none', async () => {
    render(<RequestAccessPopover threadId='thr_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(h.requestAccess).toHaveBeenCalledWith({ threadId: 'thr_1', message: undefined })
  })
})

describe('pending state (plan 42 §6.4)', () => {
  beforeEach(() => {
    h.preflight = {
      ...h.preflight,
      pending: { id: 'req_1', createdAt: new Date(Date.now() - 2 * 86_400_000), remindedAt: null },
    }
  })

  it('SWAPS the trigger rather than offering Send again', async () => {
    render(<RequestAccessPopover threadId='thr_1' />)
    expect(screen.getByRole('button', { name: 'Access requested' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Access requested' }))
    expect(screen.getByText(/2 days ago · waiting on Sarah Chen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('offers Withdraw, which is the requester cancelling their OWN ask', async () => {
    render(<RequestAccessPopover threadId='thr_1' />)
    await userEvent.click(screen.getByRole('button', { name: 'Access requested' }))
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }))

    expect(h.withdrawAccessRequest).toHaveBeenCalledWith({ id: 'req_1' })
  })

  it('still offers the pending view when the server reports NOT eligible', () => {
    // A pending request is not a refusal — the trigger has to keep showing its
    // status, or the row silently loses the only way to withdraw.
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'deny_cooldown' }
    render(<RequestAccessPopover threadId='thr_1' />)
    expect(screen.getByRole('button', { name: 'Access requested' })).toBeInTheDocument()
  })
})
