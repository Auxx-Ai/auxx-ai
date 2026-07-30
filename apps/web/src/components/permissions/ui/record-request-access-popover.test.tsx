// apps/web/src/components/permissions/ui/record-request-access-popover.test.tsx
//
// Plan v3/04 §8 — the record lane's requester side.
//
// Three rules are pinned here because each fails silently:
//
//  - **The trigger label follows the LADDER, not a picker** (D1 / §3.2). `none`
//    asks to get in, `read` asks to edit, and `edit`/`admin` render nothing at
//    all — a picker or a hardcoded rung (mail's shape) would produce a dead
//    button on every surface that already proves `read`.
//  - **The preflight is LAZY** (§8.5 / D6). `read` is the COMMON rung, so a query
//    on mount would fire for that whole population just to decide a label.
//  - **`subjectLabel` is server-composed** (§6). A client that composed it from
//    the store would happily render a display name the server withheld.
//
// The rung comes from a real `_access` stamp through the shipped
// `useRecordAccessFor`, so a change to the fold breaks a test rather than a stub.

import type { Rung } from '@auxx/database/enums'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_ticket0000000000000000000'
const ROW = 'ein_row000000000000000000000'

const h = vi.hoisted(() => ({
  /** Every `{ entityDefinitionId, entityInstanceId }` the preflight was ENABLED for. */
  preflightCalls: [] as unknown[],
  preflight: {
    eligible: true,
    currentRung: 'read',
    requestedRung: 'edit',
    pending: null as { id: string; createdAt: Date; remindedAt: string | null } | null,
    approvers: [{ userId: 'u_sarah', name: 'Sarah Chen', image: null }],
    subjectLabel: 'Ticket · ACME onboarding',
    refusalReason: null as string | null,
  },
  requestRecordAccess: vi.fn(),
  withdrawAccessRequest: vi.fn(),
}))

vi.mock('~/providers/capabilities-provider', () => ({
  // The def fallback is deliberately `none`: every case below drives the rung
  // through the row STAMP, which is what the mounts read.
  useAccess: () => ({ recordDefRung: () => 'none', canDeleteRecordAt: () => false }),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      approval: { recordAccessRequestPreflight: { invalidate: vi.fn() } },
    }),
    approval: {
      recordAccessRequestPreflight: {
        useQuery: (input: unknown, opts: { enabled: boolean }) => {
          if (opts.enabled) h.preflightCalls.push(input)
          return { data: opts.enabled ? h.preflight : undefined, isLoading: false }
        },
      },
      requestRecordAccess: {
        useMutation: () => ({ mutate: h.requestRecordAccess, isPending: false }),
      },
      withdrawAccessRequest: {
        useMutation: () => ({ mutate: h.withdrawAccessRequest, isPending: false }),
      },
    },
  },
}))

vi.mock('~/components/global/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}))

const { useRecordStore } = await import('~/components/resources/store/record-store')
const { RecordRequestAccessPopover } = await import('./record-request-access-popover')

beforeAll(() => {
  // Radix/floating-ui's `autoUpdate` CONSTRUCTS a ResizeObserver; the global
  // setup stubs one that cannot be `new`ed.
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

/** Stamp the store the way `record.getByIds` does, then render the popover. */
function renderPopover(stamp: Rung, props: { assumeNoAccess?: boolean } = {}) {
  useRecordStore.setState({ records: {}, attemptedIds: new Set() })
  useRecordStore.getState().setRecords(DEF, [
    {
      id: ROW,
      createdAt: new Date(),
      updatedAt: new Date(),
      _access: stamp,
      displayName: 'ACME',
    },
  ])
  return render(
    <RecordRequestAccessPopover entityDefinitionId={DEF} entityInstanceId={ROW} {...props} />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.preflightCalls = []
  h.preflight = {
    eligible: true,
    currentRung: 'read',
    requestedRung: 'edit',
    pending: null,
    approvers: [{ userId: 'u_sarah', name: 'Sarah Chen', image: null }],
    subjectLabel: 'Ticket · ACME onboarding',
    refusalReason: null,
  }
})

describe('the trigger label follows the rung (D1 / §3.2)', () => {
  it('asks to get IN at `none`', () => {
    renderPopover('none')
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
  })

  it('asks to EDIT at `read` — reaching a record surface already proves read', () => {
    renderPopover('read')
    expect(screen.getByRole('button', { name: 'Request edit access' })).toBeInTheDocument()
  })

  it('renders NOTHING at `edit` — there is nothing left to ask for', () => {
    const { container } = renderPopover('edit')
    expect(container).toBeEmptyDOMElement()
  })

  it('renders NOTHING at `admin` — sharing authority is delegated, never requested', () => {
    // 🔴 The gate is the rung test ALONE. `_access` has already folded the def
    // rung in, so an `admin` row-holder and a `canEditEntity(def)` member are
    // both excluded without a `canSelfGrant` term — and the client's `canShare`
    // is admin-only, i.e. STRICTER than the server, so writing one with it would
    // show a Request button to a def-Edit member who can already share (§10.3).
    const { container } = renderPopover('admin')
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the preflight is LAZY (§8.5 / D6)', () => {
  it('issues NO preflight until the popover is opened', async () => {
    renderPopover('read')
    expect(h.preflightCalls).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))
    expect(h.preflightCalls).toEqual([{ entityDefinitionId: DEF, entityInstanceId: ROW }])
  })

  it('issues no preflight for an INELIGIBLE rung even once clicked — there is no trigger', () => {
    renderPopover('edit')
    expect(h.preflightCalls).toHaveLength(0)
  })
})

describe('the popover body', () => {
  it('renders the SERVER-composed label and names the approvers as administrators', async () => {
    // D3 collapsed the approver set to org admins + owners, so there is one noun
    // and no `approversAre` discriminator to carry.
    h.preflight = {
      ...h.preflight,
      approvers: [
        { userId: 'u_sarah', name: 'Sarah Chen', image: null },
        { userId: 'u_lee', name: 'Lee', image: null },
      ],
    }
    renderPopover('read')
    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))

    expect(screen.getByText('Ticket · ACME onboarding')).toBeInTheDocument()
    expect(screen.getByText('Sarah Chen and 1 other administrators')).toBeInTheDocument()
  })

  it('sends WITHOUT a rung — the server derives it, and there must be no input', async () => {
    renderPopover('read')
    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(h.requestRecordAccess).toHaveBeenCalledWith({
      entityDefinitionId: DEF,
      entityInstanceId: ROW,
      message: undefined,
    })
    // A `{ rung }` input would let any caller file an `admin` request.
    expect(h.requestRecordAccess.mock.calls[0]?.[0]).not.toHaveProperty('rung')
  })

  it('carries the disclosed note when one is written', async () => {
    renderPopover('none')
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }))
    await userEvent.click(screen.getByRole('button', { name: /Add a note/ }))
    await userEvent.type(screen.getByPlaceholderText('Why do you need access?'), 'Covering for Lee')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(h.requestRecordAccess).toHaveBeenCalledWith({
      entityDefinitionId: DEF,
      entityInstanceId: ROW,
      message: 'Covering for Lee',
    })
  })
})

describe('refusals', () => {
  it('names the SEAT, which no permission change lifts', async () => {
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'worker_seat' }
    renderPopover('read')
    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))

    expect(screen.getByText(/Field seats do not include record access/i)).toBeInTheDocument()
    // Record copy, not the mail table's — "mailbox access" here would be a lane leak.
    expect(screen.queryByText(/mailbox/i)).not.toBeInTheDocument()
  })

  it('names the PLAN for `plan_gated`, never the profile', async () => {
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'plan_gated' }
    renderPopover('read')
    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))

    expect(screen.getByText(/not available on your plan/i)).toBeInTheDocument()
    expect(screen.queryByText(/permission profile/i)).not.toBeInTheDocument()
  })

  it('stays SILENT on `already_at_ceiling` — the trigger is already hidden', async () => {
    h.preflight = { ...h.preflight, eligible: false, refusalReason: 'already_at_ceiling' }
    const { container } = renderPopover('read')
    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('pending state', () => {
  beforeEach(() => {
    h.preflight = {
      ...h.preflight,
      pending: { id: 'req_1', createdAt: new Date(Date.now() - 2 * 86_400_000), remindedAt: null },
    }
  })

  it('SWAPS the trigger once the popover has seen the pending row', async () => {
    renderPopover('read')
    // ⚠ The lazy preflight's accepted wart (§8.5): the collapsed trigger cannot
    // know about a pending request until it is opened.
    expect(screen.getByRole('button', { name: 'Request edit access' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))
    expect(screen.getByText(/2 days ago · waiting on Sarah Chen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('withdraws through the THREAD lane mutation, which is target-agnostic', async () => {
    renderPopover('read')
    await userEvent.click(screen.getByRole('button', { name: 'Request edit access' }))
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(h.withdrawAccessRequest).toHaveBeenCalledWith({ id: 'req_1' })
  })
})

describe('the `menu-item` variant — mount 3 (§8.2)', () => {
  /** The table row's kebab menu, already open, exactly as `PrimaryCell` renders it. */
  function renderInMenu(stamp: Rung) {
    useRecordStore.setState({ records: {}, attemptedIds: new Set() })
    useRecordStore
      .getState()
      .setRecords(DEF, [{ id: ROW, createdAt: new Date(), updatedAt: new Date(), _access: stamp }])
    return render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Share</DropdownMenuItem>
          <RecordRequestAccessPopover
            entityDefinitionId={DEF}
            entityInstanceId={ROW}
            variant='menu-item'
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  it('renders as a menu item beside Share, and still asks nothing on mount', () => {
    renderInMenu('read')
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Request edit access' })).toBeInTheDocument()
    // Radix does not mount `DropdownMenuContent`'s subtree until the menu opens,
    // so the hook runs once per OPENED menu — never once per row (§8.5).
    expect(h.preflightCalls).toHaveLength(0)
  })

  it('opens the popover WITHOUT closing the menu that anchors it', async () => {
    renderInMenu('read')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Request edit access' }))

    // The menu item is still mounted — a `select` that closed the dropdown would
    // unmount the very trigger the popover is anchored to.
    expect(screen.getByRole('menuitem', { name: 'Request edit access' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(h.preflightCalls).toEqual([{ entityDefinitionId: DEF, entityInstanceId: ROW }])
  })
})

describe('`assumeNoAccess` — the not-found mount (§8.3)', () => {
  it('forces `none` even when the store/def fallback would answer `read`', () => {
    // The record IS stamped `read` here. On the not-found screen it would not be,
    // and `useRecordAccessFor`'s def fallback would answer with the DEF rung for
    // a record the member demonstrably cannot reach.
    renderPopover('read', { assumeNoAccess: true })
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request edit access' })).not.toBeInTheDocument()
  })
})
