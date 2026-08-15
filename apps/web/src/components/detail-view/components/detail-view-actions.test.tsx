// apps/web/src/components/detail-view/components/detail-view-actions.test.tsx
//
// Plan v3/04 §10.4 / D5 — **the detail-view header gates on the ROW stamp, not
// the def.**
//
// This header was missed by P5 (HANDOFF §5 lists the surfaces that were
// converted; this one is absent), so until now it asked `canEditEntity(def)`.
// That is wrong in BOTH directions: a member holding `edit` on one row via a
// grant saw no Archive on that row's own page, and a member holding only `read`
// on a row of a def they otherwise edit was shown Delete.
//
// The assertions run the REAL verbs (`recordDefRung` / `canDeleteRecordAtRung`
// behind the capabilities provider, `canEditRecordAtRung` inside the hook) over
// a real record-store stamp, so a change to either half breaks a test rather
// than to a stub of `useRecordAccess`.
//
// The controls now live in the shared `RecordActionsMenu`, so every assertion
// OPENS the menu first. That is not incidental to the test — Radix does not
// mount `DropdownMenuContent`'s subtree until then, which is exactly what keeps
// the access-request preflight from running for a member who never opens it
// (§8.5 / D6), and what the zero-queries case below pins.

import type { Rung } from '@auxx/database/enums'
import type { ClientCapabilities } from '@auxx/lib/permissions/client'
import {
  Area,
  canDeleteRecordAtRung,
  expandLevelsToKeys,
  Level,
  recordDefRung,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A def the member can see and edit — the ordinary lane. */
const OPEN_DEF = 'edf_contact00000000000000000'
/** A def the member has NO def-level access to — reachable only by a grant. */
const CLOSED_DEF = 'edf_deals0000000000000000000'
const ROW = 'ein_row000000000000000000000'

function snapshot(level: Level, over: Partial<ClientCapabilities> = {}): ClientCapabilities {
  return {
    keys: expandLevelsToKeys({ [Area.records]: level }),
    defAccess: {},
    restrictedEntityDefIds: [],
    role: 'USER',
    seatType: 'full',
    ...over,
  }
}

const h = vi.hoisted(() => ({
  caps: null as unknown,
  /** Every input `recordAccessRequestPreflight` was ENABLED for. */
  preflightCalls: [] as unknown[],
}))

// The provider half of the fold — the same two functions `useRecordAccessAt`
// reads, wired to the shipped implementations rather than to booleans.
// `canEditEntity` is here only because `useEntityInstanceOperations` reads it;
// it is pinned FALSE so a test that passes could never be passing because of the
// def-level gate the menu is required to ignore.
vi.mock('~/providers/capabilities-provider', async () => {
  const perms = await import('@auxx/lib/permissions/client')
  return {
    useAccess: () => {
      const resolved = perms.toResolvedRecordAccess(h.caps as ClientCapabilities)
      return {
        canEditEntity: () => false,
        recordDefRung: (defId: string) => perms.recordDefRung(resolved, defId),
        canDeleteRecordAt: (access: Rung) => perms.canDeleteRecordAtRung(resolved, access),
      }
    },
  }
})

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// Mount 2 of the record access-request lane (plan v3/04 §8.2) lives in this menu.
// Its preflight is LAZY, so an enabled query is what a "call" means here.
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      approval: { recordAccessRequestPreflight: { invalidate: vi.fn() } },
      favorite: { list: { invalidate: vi.fn() } },
    }),
    // The star's toggle is mutation-only — `useFavoriteToggle` reads its
    // favourited state from the Zustand store, never a query — so wiring these
    // keeps the real button mounted without adding anything the ZERO-queries
    // assertion below would count.
    favorite: {
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    approval: {
      recordAccessRequestPreflight: {
        useQuery: (input: unknown, opts: { enabled: boolean }) => {
          if (opts.enabled) h.preflightCalls.push(input)
          return { data: undefined, isLoading: false }
        },
      },
      requestRecordAccess: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      withdrawAccessRequest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))

// The archive/delete MUTATIONS are the records-table's shipped ones and are
// tested there; what matters here is which items the gate renders at all.
vi.mock('~/hooks/use-entity-instance-operations', () => ({
  useEntityInstanceOperations: () => ({
    canEdit: false,
    handleArchive: vi.fn(),
    handleDelete: vi.fn(),
    ConfirmDeleteDialog: () => null,
    ConfirmArchiveDialog: () => null,
  }),
}))

// Dialog bodies and the two submenus pull tRPC/query graphs that have nothing to
// do with the gate. The submenus decide their own enabled-ness from their own
// queries, which is covered where they live.
vi.mock('~/components/merge', () => ({ MergeDialog: () => null }))
vi.mock('~/components/permissions/ui/instance-share-dialog', () => ({
  InstanceShareDialog: () => null,
}))
// Issues its own per-record `resourceAccess.forInstance` query, which has
// nothing to do with the gate under test.
vi.mock('~/components/permissions/ui/instance-share-avatars', () => ({
  InstanceShareAvatars: () => null,
}))
// Same reason: it runs its own `duplicates.forRecord` query and renders nothing
// unless the record has open duplicate pairs. Ungated like the star beside it,
// so it can only add noise to a test about the write gate.
vi.mock('~/components/duplicates/ui/duplicate-indicator-button', () => ({
  DuplicateIndicatorButton: () => null,
}))
vi.mock('~/components/sequences/ui/add-to-sequence-dialog', () => ({
  AddToSequenceDialog: () => null,
}))
vi.mock('~/components/workflow/workflow-submenu', () => ({ WorkflowSubMenu: () => null }))
vi.mock('~/components/detail-view/components/app-record-actions', () => ({
  AppRecordActionsSubmenu: () => null,
}))

import { useRecordStore } from '~/components/resources/store/record-store'
import { DetailViewActions } from './detail-view-actions'

/**
 * Render the header for one row, stamping the store the way `record.getByIds`
 * does. `stamp: undefined` leaves the row unstamped, which is the def-fallback
 * case.
 *
 * `TooltipProvider` mirrors the app shell (`auxx-app-providers.tsx`), which
 * wraps every `/app` route — the favourite star and the menu trigger both use a
 * tooltip and throw without it.
 */
function renderActions(defId: string, stamp: Rung | undefined) {
  useRecordStore.setState({ records: {}, attemptedIds: new Set() })
  useRecordStore.getState().setRecords(defId, [
    {
      id: ROW,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(stamp ? { _access: stamp } : {}),
    },
  ])
  return render(
    <TooltipProvider>
      <DetailViewActions
        entityType={defId}
        recordId={toRecordId(defId, ROW)}
        record={{ status: 'ACTIVE' }}
        backUrl='/app/contacts'
      />
    </TooltipProvider>
  )
}

/** Render, then open the overflow menu — nothing inside it exists until then. */
async function openMenu(defId: string, stamp: Rung | undefined) {
  renderActions(defId, stamp)
  await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
}

const item = (name: RegExp) => screen.queryByRole('menuitem', { name })

beforeEach(() => {
  h.caps = snapshot(Level.Full)
  h.preflightCalls = []
})

describe('the row stamp, not the def, gates the detail-view header', () => {
  it('withholds Archive/Delete/Merge from a `read` row of an otherwise editable def', async () => {
    // Records: Full — `canEditEntity(def)` is true, which is exactly what the
    // old gate asked. The row says `read`.
    h.caps = snapshot(Level.Full)

    await openMenu(OPEN_DEF, 'read')

    expect(item(/archive/i)).toBeNull()
    expect(item(/delete/i)).toBeNull()
    expect(item(/merge/i)).toBeNull()
  })

  it('offers Archive on an `edit` row of a def the member cannot otherwise see', async () => {
    // The mirror case: no def rung at all, `edit` by grant. Under the def gate
    // this member could open the row and do nothing to it.
    h.caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })

    await openMenu(CLOSED_DEF, 'edit')

    expect(item(/archive/i)).toBeTruthy()
  })

  it('keeps the def answer for an UNSTAMPED row — the honest pre-P5 fallback', async () => {
    h.caps = snapshot(Level.Full)

    await openMenu(OPEN_DEF, undefined)

    expect(item(/archive/i)).toBeTruthy()
    expect(item(/delete/i)).toBeTruthy()
  })
})

describe('the DESTRUCTIVE pair is a narrower rule than edit, not the same flag', () => {
  it('shows Archive but NOT Delete for an `edit` row without the delete verb', async () => {
    // Records: Edit carries no `recordsDelete`; the stamp is `edit`, not
    // `admin`. Collaboration, not destruction.
    h.caps = snapshot(Level.Edit, { restrictedEntityDefIds: [CLOSED_DEF] })

    await openMenu(CLOSED_DEF, 'edit')

    expect(item(/archive/i)).toBeTruthy()
    expect(item(/delete/i)).toBeNull()
  })

  it('shows Archive but NOT MERGE for an `edit` row without the delete verb', async () => {
    // Merge rides the DELETE verb, not the edit floor: it permanently removes
    // the source rows, and the server asserts `assertCanDeleteRows` over the
    // target and every source (`routers/record.ts`). Gating it with Archive — as
    // plan v3/04 §10.4 says — shows this member an item the mutation refuses.
    h.caps = snapshot(Level.Edit, { restrictedEntityDefIds: [CLOSED_DEF] })

    await openMenu(CLOSED_DEF, 'edit')

    expect(item(/archive/i)).toBeTruthy()
    expect(item(/merge/i)).toBeNull()
    expect(item(/delete/i)).toBeNull()
  })

  it('shows Delete for an `admin` row even without the org-wide delete verb', async () => {
    h.caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })

    await openMenu(CLOSED_DEF, 'admin')

    expect(item(/delete/i)).toBeTruthy()
  })

  it('pins the two rules apart at the source, so the items cannot be collapsed', () => {
    const edit = toResolvedRecordAccess(snapshot(Level.Edit))
    expect(canDeleteRecordAtRung(edit, 'edit')).toBe(false)
    // …and the def fallback the header leans on is the shipped one.
    expect(recordDefRung(edit, OPEN_DEF)).toBe('edit')
  })
})

describe('Delete is no longer withheld by a per-type config flag', () => {
  it('offers Delete on an `admin` CONTACT row', async () => {
    // The regression this pins: `DETAIL_VIEW_CONFIG_REGISTRY.contact.actions`
    // carried no `enableDelete`, so a contact was deletable from its table row
    // and its drawer but NOT from its own detail page — while `record.delete`
    // accepted it the whole time. `enableDelete` is gone; the rung decides.
    h.caps = snapshot(Level.Full)

    await openMenu(OPEN_DEF, 'admin')

    expect(item(/delete/i)).toBeTruthy()
  })
})

describe('the access-request mount (plan v3/04 §8.2, mount 2)', () => {
  // PROMOTED out of the menu on this surface: it is the one control that ADDS
  // capability, and the record's own page is where a member who cannot edit it
  // ends up. Burying the way out of a dead end behind a kebab is backwards.
  it('is a top-level BUTTON on a `read` row, where every write control is withheld', async () => {
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'read')

    expect(screen.getByRole('button', { name: /Request edit access/ })).toBeTruthy()

    // …and it is NOT also duplicated inside the menu.
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(item(/Request/)).toBeNull()
    expect(item(/archive/i)).toBeNull()
  })

  it('renders NO trigger on an `edit` row — nothing left to ask for', () => {
    h.caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })
    renderActions(CLOSED_DEF, 'edit')

    expect(screen.queryByRole('button', { name: /Request/ })).toBeNull()
  })

  it('costs ZERO queries to decide the label (§8.5 / D6)', () => {
    // The label comes from the rung the client already holds; the preflight is
    // lazy and only fires once the popover itself opens. Promoting the trigger
    // to a always-rendered button is what makes this worth pinning — it now
    // mounts for every `read` viewer, so a non-lazy preflight would be a query
    // on every such page load.
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'read')

    expect(screen.getByRole('button', { name: /Request edit access/ })).toBeTruthy()
    expect(h.preflightCalls).toHaveLength(0)
  })

  it('mounts no menu items at all while the menu stays CLOSED', () => {
    // Radix does not mount `DropdownMenuContent`'s subtree until opened — the
    // same property the table relies on per row.
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'read')

    expect(screen.queryByRole('menuitem')).toBeNull()
  })
})

describe('Share is promoted beside the shared-with avatars, not buried', () => {
  it('renders a labelled Share button on an `admin` row, and NOT a menu item', async () => {
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'admin')

    expect(screen.getByRole('button', { name: /Share/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(item(/Share/)).toBeNull()
  })

  it('withholds Share entirely below `admin` — sharing is not an edit affordance', () => {
    h.caps = snapshot(Level.Edit, { restrictedEntityDefIds: [CLOSED_DEF] })
    renderActions(CLOSED_DEF, 'edit')

    expect(screen.queryByRole('button', { name: /Share/ })).toBeNull()
  })
})

describe('the favourite star is deliberately UNGATED and OUTSIDE the menu', () => {
  it('renders on a `read` row, where every write control is withheld', () => {
    // Favouriting is a personal bookmark keyed to the viewer, not a write on the
    // record — the same reason the drawer's and the table row's menu items carry
    // no rung check. Pinned so a future pass that sweeps rung gates across this
    // cluster doesn't quietly take it with them.
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'read')

    expect(screen.getByRole('button', { name: /Add to favorites/i })).toBeTruthy()
  })

  it('is reachable WITHOUT opening the menu — it reports state, so it must be visible', () => {
    h.caps = snapshot(Level.Full)
    renderActions(CLOSED_DEF, 'read')

    // Two buttons, no menu open: the star and the overflow trigger.
    expect(screen.getByRole('button', { name: /Add to favorites/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy()
  })
})
