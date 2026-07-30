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
import { render, screen } from '@testing-library/react'
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
vi.mock('~/providers/capabilities-provider', async () => {
  const perms = await import('@auxx/lib/permissions/client')
  return {
    useAccess: () => {
      const resolved = perms.toResolvedRecordAccess(h.caps as ClientCapabilities)
      return {
        recordDefRung: (defId: string) => perms.recordDefRung(resolved, defId),
        canDeleteRecordAt: (access: Rung) => perms.canDeleteRecordAtRung(resolved, access),
      }
    },
  }
})

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))

// Mount 2 of the record access-request lane (plan v3/04 §8.2) lives in this row.
// Its preflight is LAZY, so an enabled query is what a "call" means here.
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({ approval: { recordAccessRequestPreflight: { invalidate: vi.fn() } } }),
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

// Dialog bodies and the app-actions row pull tRPC/query graphs that have
// nothing to do with the gate.
vi.mock('~/components/merge', () => ({ MergeDialog: () => null }))
vi.mock('~/components/sequences/ui/add-to-sequence-dialog', () => ({
  AddToSequenceDialog: () => null,
}))
vi.mock('./app-record-actions', () => ({ AppRecordActions: () => null }))

import { useRecordStore } from '~/components/resources/store/record-store'
import { DetailViewActions } from './detail-view-actions'

const ACTIONS = {
  enableMerge: true,
  enableArchive: true,
  enableSpam: true,
  enableDelete: true,
}

/**
 * Render the header for one row, stamping the store the way `record.getByIds`
 * does. `stamp: undefined` leaves the row unstamped, which is the def-fallback
 * case.
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
    <DetailViewActions
      entityType={defId}
      recordId={toRecordId(defId, ROW)}
      record={{ status: 'ACTIVE' }}
      config={{ actions: ACTIONS } as never}
    />
  )
}

const button = (name: RegExp) => screen.queryByRole('button', { name })

beforeEach(() => {
  h.caps = snapshot(Level.Full)
  h.preflightCalls = []
})

describe('the row stamp, not the def, gates the detail-view header', () => {
  it('withholds Archive/Spam/Delete from a `read` row of an otherwise editable def', () => {
    // Records: Full — `canEditEntity(def)` is true, which is exactly what the
    // old gate asked. The row says `read`.
    h.caps = snapshot(Level.Full)

    renderActions(OPEN_DEF, 'read')

    expect(button(/archive/i)).toBeNull()
    expect(button(/spam/i)).toBeNull()
    expect(button(/delete/i)).toBeNull()
    expect(button(/merge/i)).toBeNull()
  })

  it('offers Archive on an `edit` row of a def the member cannot otherwise see', () => {
    // The mirror case: no def rung at all, `edit` by grant. Under the def gate
    // this member could open the row and do nothing to it.
    h.caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })

    renderActions(CLOSED_DEF, 'edit')

    expect(button(/archive/i)).toBeTruthy()
    expect(button(/spam/i)).toBeTruthy()
  })

  it('keeps the def answer for an UNSTAMPED row — the honest pre-P5 fallback', () => {
    h.caps = snapshot(Level.Full)

    renderActions(OPEN_DEF, undefined)

    expect(button(/archive/i)).toBeTruthy()
    expect(button(/delete/i)).toBeTruthy()
  })
})

describe('the DESTRUCTIVE pair is a narrower rule than edit, not the same flag', () => {
  it('shows Archive but NOT Delete for an `edit` row without the delete verb', () => {
    // Records: Edit carries no `recordsDelete`; the stamp is `edit`, not
    // `admin`. Collaboration, not destruction.
    h.caps = snapshot(Level.Edit, { restrictedEntityDefIds: [CLOSED_DEF] })

    renderActions(CLOSED_DEF, 'edit')

    expect(button(/archive/i)).toBeTruthy()
    expect(button(/delete/i)).toBeNull()
  })

  it('shows Archive but NOT MERGE for an `edit` row without the delete verb', () => {
    // Merge rides the DELETE verb, not the edit floor: it permanently removes
    // the source rows, and the server asserts `assertCanDeleteRows` over the
    // target and every source (`routers/record.ts:996`). Gating it with
    // Archive/Spam — as plan v3/04 §10.4 says — shows this member a button the
    // mutation refuses.
    h.caps = snapshot(Level.Edit, { restrictedEntityDefIds: [CLOSED_DEF] })

    renderActions(CLOSED_DEF, 'edit')

    expect(button(/archive/i)).toBeTruthy()
    expect(button(/spam/i)).toBeTruthy()
    expect(button(/merge/i)).toBeNull()
    expect(button(/delete/i)).toBeNull()
  })

  it('shows Delete AND Merge for an `admin` row even without the org-wide delete verb', () => {
    h.caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })

    renderActions(CLOSED_DEF, 'admin')

    expect(button(/delete/i)).toBeTruthy()
    expect(button(/merge/i)).toBeTruthy()
  })

  it('pins the two rules apart at the source, so the buttons cannot be collapsed', () => {
    const edit = toResolvedRecordAccess(snapshot(Level.Edit))
    expect(canDeleteRecordAtRung(edit, 'edit')).toBe(false)
    // …and the def fallback the header leans on is the shipped one.
    expect(recordDefRung(edit, OPEN_DEF)).toBe('edit')
  })
})

describe('the access-request mount (plan v3/04 §8.2, mount 2)', () => {
  it('offers `read → edit` on a `read` row, where every other control is withheld', () => {
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'read')

    // FIRST in the row: everything after it is destructive-leaning, and this is
    // the one control that ADDS capability.
    expect(button(/Request edit access/)).toBeTruthy()
    expect(button(/archive/i)).toBeNull()
  })

  it('renders NO trigger on an `edit` row — nothing left to ask for', () => {
    h.caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })
    renderActions(CLOSED_DEF, 'edit')

    expect(button(/Request/)).toBeNull()
  })

  it('costs ZERO queries to decide the label (§8.5 / D6)', () => {
    h.caps = snapshot(Level.Full)
    renderActions(OPEN_DEF, 'read')

    expect(button(/Request edit access/)).toBeTruthy()
    expect(h.preflightCalls).toHaveLength(0)
  })
})
