// apps/web/src/components/resources/hooks/use-record-access.test.ts
//
// Plan v3/03 §5.2/§6.2 (P5) — **the `_access` stamp drives PER-ROW edit mode**.
//
// Before this the whole records surface decided edit mode ONCE per definition
// (`canEditEntity`). That is the right question for New / import / export-all /
// bulk / view management and the wrong one for a row, because a member can hold
// `edit` on one row of a definition they cannot otherwise see, and only `read`
// on a row whose siblings they edit freely.
//
// These tests pin the resolution through the SHIPPED client verbs
// (`toResolvedRecordAccess` → `recordDefRung` / `canEditRecordAtRung` /
// `canDeleteRecordAtRung` / `satisfiesRung`) rather than through a stub of the
// hook, so a change to either half has to break a test. The hook itself is a
// two-line fold over exactly these calls.

import type { Rung } from '@auxx/database/enums'
import type { ClientCapabilities } from '@auxx/lib/permissions/client'
import {
  Area,
  canDeleteRecordAtRung,
  canEditRecordAtRung,
  expandLevelsToKeys,
  Level,
  recordDefRung,
  satisfiesRung,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/client'
import { describe, expect, it } from 'vitest'

/** A def the member can see and edit — the ordinary lane. */
const OPEN_DEF = 'edf_contact00000000000000000'
/** A def the member has NO def-level access to — reachable only by grant. */
const CLOSED_DEF = 'edf_deals0000000000000000000'

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

/**
 * The hook's fold, spelled out. Kept as a local mirror rather than importing the
 * hook so this file needs no React renderer — the hook adds only a store read
 * and a `useAccess()` read on top of these three lines.
 */
function resolve(caps: ClientCapabilities, defId: string, stamp: Rung | undefined) {
  const resolved = toResolvedRecordAccess(caps)
  const access: Rung = stamp ?? recordDefRung(resolved, defId) ?? 'none'
  return {
    access,
    canEdit: canEditRecordAtRung(access),
    canDelete: canDeleteRecordAtRung(resolved, access),
    canShare: satisfiesRung(access, 'admin'),
  }
}

describe('the stamp, not the def, decides row edit mode', () => {
  it('an `edit` stamp on an INVISIBLE def is editable — the case the def gate got wrong', () => {
    // Records: None, `CLOSED_DEF` restricted with no def grant. `canEditEntity`
    // is false; the row was shared at `edit`. Before P5 the member could open
    // this row and change nothing — a share that granted nothing.
    const caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })
    expect(resolve(caps, CLOSED_DEF, 'edit').canEdit).toBe(true)
  })

  it('a `read` stamp is NOT editable, even where the def itself is editable', () => {
    // The mirror case, and the reason a table-wide flag is wrong in BOTH
    // directions: Records: Edit would have made every row of this def writable.
    const caps = snapshot(Level.Edit)
    expect(resolve(caps, OPEN_DEF, 'read').canEdit).toBe(false)
    // …while an unstamped row of the same def keeps the def answer.
    expect(resolve(caps, OPEN_DEF, undefined).canEdit).toBe(true)
  })

  it('two rows of the SAME def can disagree — that is the whole point', () => {
    const caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })
    expect(resolve(caps, CLOSED_DEF, 'admin').canEdit).toBe(true)
    expect(resolve(caps, CLOSED_DEF, 'read').canEdit).toBe(false)
  })
})

describe('the unstamped fallback is the DEF rung, not a guess', () => {
  it('an unstamped row resolves to exactly what the server folds for a grant-less row', () => {
    const caps = snapshot(Level.Edit)
    const resolved = toResolvedRecordAccess(caps)
    expect(resolve(caps, OPEN_DEF, undefined).access).toBe(recordDefRung(resolved, OPEN_DEF))
  })

  it('a def the member cannot see falls back to `none`, never to "allowed"', () => {
    const caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })
    const row = resolve(caps, CLOSED_DEF, undefined)
    expect(row.access).toBe('none')
    expect(row.canEdit).toBe(false)
    expect(row.canShare).toBe(false)
  })
})

describe('delete and share read the same stamp through their own rules', () => {
  it('`edit` stamp + `records.delete` deletes; `edit` stamp without it does not', () => {
    const full = snapshot(Level.Full, { restrictedEntityDefIds: [CLOSED_DEF] })
    const edit = snapshot(Level.Edit, { restrictedEntityDefIds: [CLOSED_DEF] })
    expect(resolve(full, CLOSED_DEF, 'edit').canDelete).toBe(true)
    // Collaboration, not destruction.
    expect(resolve(edit, CLOSED_DEF, 'edit').canDelete).toBe(false)
  })

  it('an `admin` stamp deletes without the org-wide verb', () => {
    const caps = snapshot(Level.None, { restrictedEntityDefIds: [CLOSED_DEF] })
    expect(resolve(caps, CLOSED_DEF, 'admin').canDelete).toBe(true)
  })

  it('SHARE needs `admin` — an `edit` grantee may change the row, not re-share it', () => {
    const caps = snapshot(Level.Full)
    expect(resolve(caps, OPEN_DEF, 'edit').canShare).toBe(false)
    expect(resolve(caps, OPEN_DEF, 'admin').canShare).toBe(true)
  })

  it('a base-level Full member cannot share a row: base rungs cap at `edit`', () => {
    // This is why the client mirror of `assertCanManageRecordSharing` needs no
    // separate def branch — `admin` can only come from an explicit grant or
    // OWNER, and the fold already carries it.
    const caps = snapshot(Level.Full)
    expect(resolve(caps, OPEN_DEF, undefined).canShare).toBe(false)
  })

  it('OWNER shares any row — the §0.10 recovery bypass survives the fold', () => {
    const caps = snapshot(Level.None, { role: 'OWNER', restrictedEntityDefIds: [CLOSED_DEF] })
    expect(resolve(caps, CLOSED_DEF, undefined).canShare).toBe(true)
  })
})

describe('the seat ceiling cannot be raised by a share', () => {
  it('a worker seat resolves `none` from its def rung however the row is stamped', () => {
    // The stamp itself is built server-side by `CapabilitySet.recordAccessAt`,
    // which applies `SEAT_CEILINGS` BEFORE the fold — so a worker seat can never
    // receive a positive stamp. The def half is asserted here; the fold half is
    // pinned in `packages/lib`'s `record-per-row-edit.test.ts`.
    const caps = snapshot(Level.Full, { seatType: 'worker' })
    expect(recordDefRung(toResolvedRecordAccess(caps), OPEN_DEF)).toBeUndefined()
    expect(resolve(caps, OPEN_DEF, undefined).canEdit).toBe(false)
  })
})
