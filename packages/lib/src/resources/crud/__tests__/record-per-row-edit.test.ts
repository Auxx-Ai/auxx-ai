// packages/lib/src/resources/crud/__tests__/record-per-row-edit.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilitySet } from '../../../permissions/capabilities/capability-set'
import { Area, expandLevelsToKeys, Level } from '../../../permissions/client'
import type { RecordId } from '../../resource-id'
import {
  assertRecordRowsEditable,
  assertRowsEditableFromStamps,
  defDeniedRecordIds,
} from '../record-row-access'

/**
 * Plan v3/03 §5.3 (P5) — **the per-row WRITE gate**.
 *
 * The delete half shipped first (`record-per-row-delete.test.ts`); this is the
 * hole it left. `UnifiedCrudHandler.update` / `archive` / `bulkUpdate` /
 * `bulkSetFieldValue` / `merge` all asserted `assertEditEntity(def)`, so a
 * member holding an `edit` grant on ONE row of a def they cannot otherwise see
 * could READ that row (§5.1 arm 3 admits it) and could not CHANGE it. The
 * feature was half-delivered: a share that grants nothing.
 *
 * The gate mirrors the delete one exactly — def fast path, stamp only the
 * def-denied remainder, missing row or missing stamp DENIES, batch fails whole.
 */

/** A def the member can see and edit — the ordinary lane. */
const OPEN_DEF = 'edf_contact00000000000000000'
/** A def the member has NO def-level access to — reachable only by grant. */
const CLOSED_DEF = 'edf_deals0000000000000000000'

const ROW_A = 'ins_a000000000000000000000'
const ROW_B = 'ins_b000000000000000000000'

/**
 * Def key → slug, required by the gate since plan v3/06 §7.2 added
 * `ALWAYS_PER_ROW_DEF_SLUGS` (a slug-keyed carve-out of defs whose def-level
 * write gate is not authoritative for a row — `article` today).
 *
 * Identity is CORRECT for this file, not a shortcut: both defs here are
 * ordinary record definitions whose keys are already their own slugs, and
 * neither is in the carve-out, so every assertion below is about the def gate
 * and the stamp exactly as it was. The parameter is required rather than
 * optional so a new caller cannot opt out of the carve-out by omission.
 */
const defIdToSlug = (id: string) => id

const OPEN_A = `${OPEN_DEF}:${ROW_A}` as RecordId
const CLOSED_A = `${CLOSED_DEF}:${ROW_A}` as RecordId
const CLOSED_B = `${CLOSED_DEF}:${ROW_B}` as RecordId

/**
 * A real `CapabilitySet` for a MEMBER whose Records area is `level`, with an
 * explicit restricted-def set so `CLOSED_DEF` can be shut while `OPEN_DEF` stays
 * open. The arithmetic under test is the shipped arithmetic — no stub gates.
 */
function member(level: Level, restrictedDefs: string[] = []) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: level })),
    // `none` is a restriction marker and never seeds `defAccess`, so a closed def
    // is expressed by membership in `restrictedDefIds` with NO grant entry.
    {} as Record<string, never>,
    'USER',
    'full',
    (id) => id,
    new Set(restrictedDefs),
    (id) => id
  )
}

let stamp: ReturnType<typeof vi.fn>

beforeEach(() => {
  stamp = vi.fn(async () => ({}) as Record<string, { _access?: string }>)
})

describe('the def gate is the fast path', () => {
  it('an all-def-editable batch never pays a row read', async () => {
    await assertRecordRowsEditable(
      member(Level.Edit),
      [OPEN_A, OPEN_A],
      stamp as never,
      defIdToSlug
    )
    expect(stamp).not.toHaveBeenCalled()
  })

  it('only the def-DENIED ids are stamped — the open def costs nothing', () => {
    const denied = defDeniedRecordIds(
      member(Level.Full, [CLOSED_DEF]),
      [OPEN_A, CLOSED_B],
      defIdToSlug
    )
    expect(denied).toEqual([CLOSED_B])
  })

  it('asks the def gate ONCE per definition, however long the batch', () => {
    const caps = member(Level.Edit)
    const spy = vi.spyOn(caps, 'canEditEntity')
    const batch = Array.from({ length: 50 }, () => OPEN_A)
    expect(defDeniedRecordIds(caps, batch, defIdToSlug)).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('an absent CapabilityView means an internal caller — nothing is denied', async () => {
    expect(defDeniedRecordIds(undefined, [CLOSED_A], defIdToSlug)).toEqual([])
    await assertRecordRowsEditable(undefined, [CLOSED_A], stamp as never, defIdToSlug)
    expect(stamp).not.toHaveBeenCalled()
  })
})

describe('§5.3 — a row shared at `edit` IS writable; one shared at `read` is not', () => {
  it('a def the member cannot edit, but holds `edit` on the ROW, is writable', async () => {
    // This is THE case the def gate got wrong. Records: Edit org-wide, but
    // `CLOSED_DEF` is restricted with no def grant — `canEditEntity` is false.
    // The row stamp says `edit`, which is exactly what the share conferred.
    stamp.mockResolvedValue({ [CLOSED_A]: { _access: 'edit' } })
    await expect(
      assertRecordRowsEditable(
        member(Level.Edit, [CLOSED_DEF]),
        [CLOSED_A],
        stamp as never,
        defIdToSlug
      )
    ).resolves.toBeUndefined()
    expect(stamp).toHaveBeenCalledWith([CLOSED_A])
  })

  it('a row shared at `admin` is writable — the ladder is ordered', async () => {
    stamp.mockResolvedValue({ [CLOSED_A]: { _access: 'admin' } })
    await expect(
      assertRecordRowsEditable(
        member(Level.Read, [CLOSED_DEF]),
        [CLOSED_A],
        stamp as never,
        defIdToSlug
      )
    ).resolves.toBeUndefined()
  })

  it('a row shared at `read` is NOT writable — the `edit` floor holds', async () => {
    stamp.mockResolvedValue({ [CLOSED_A]: { _access: 'read' } })
    await expect(
      assertRecordRowsEditable(
        member(Level.Full, [CLOSED_DEF]),
        [CLOSED_A],
        stamp as never,
        defIdToSlug
      )
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
  })

  it('`identity` and `none` stamps are refused too — every rung below `edit`', () => {
    const caps = member(Level.Full, [CLOSED_DEF])
    for (const rung of ['none', 'identity', 'metadata', 'read'] as const) {
      expect(() =>
        assertRowsEditableFromStamps(caps, [CLOSED_A], { [CLOSED_A]: { _access: rung } })
      ).toThrow()
    }
    for (const rung of ['edit', 'admin'] as const) {
      expect(() =>
        assertRowsEditableFromStamps(caps, [CLOSED_A], { [CLOSED_A]: { _access: rung } })
      ).not.toThrow()
    }
  })

  it('a MIXED batch is judged per row, not by the def gate alone', async () => {
    // `OPEN_A` passes the def gate; `CLOSED_B` is writable only because the STAMP
    // says so. The old per-def assert refused the whole batch.
    stamp.mockResolvedValue({ [CLOSED_B]: { _access: 'edit' } })
    await expect(
      assertRecordRowsEditable(
        member(Level.Edit, [CLOSED_DEF]),
        [OPEN_A, CLOSED_B],
        stamp as never,
        defIdToSlug
      )
    ).resolves.toBeUndefined()
    expect(stamp).toHaveBeenCalledWith([CLOSED_B])
  })

  it('one un-writable row fails the WHOLE batch', async () => {
    stamp.mockResolvedValue({ [CLOSED_A]: { _access: 'edit' }, [CLOSED_B]: { _access: 'read' } })
    await expect(
      assertRecordRowsEditable(
        member(Level.Edit, [CLOSED_DEF]),
        [CLOSED_A, CLOSED_B],
        stamp as never,
        defIdToSlug
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('a worker seat cannot be raised into `edit` by a share — the ceiling clamps first', () => {
    // `recordAccessAt` applies `SEAT_CEILINGS`, so a worker seat's stamp can only
    // ever be `'none'`; this asserts the *fold*, which is what the SQL feeds.
    const worker = new CapabilitySet(
      new Set(expandLevelsToKeys({ [Area.records]: Level.Full })),
      {} as Record<string, never>,
      'USER',
      'worker',
      (id) => id,
      new Set([CLOSED_DEF]),
      (id) => id
    )
    expect(worker.recordAccessAt(CLOSED_DEF, 4)).toBe('none')
    expect(worker.canEditRecordAt(worker.recordAccessAt(CLOSED_DEF, 4))).toBe(false)
  })
})

describe('§5.2 — non-enumeration: an id the read path hid DENIES', () => {
  it('a row that does not come back from the stamped read is refused', async () => {
    // The read path drops unauthorized ids SILENTLY. "Absent" is therefore the
    // strongest denial signal there is, and the write path must read it that way.
    stamp.mockResolvedValue({})
    await expect(
      assertRecordRowsEditable(
        member(Level.Full, [CLOSED_DEF]),
        [CLOSED_A],
        stamp as never,
        defIdToSlug
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('a row that comes back WITHOUT a stamp is refused', async () => {
    // An unenforced read carries no `_access`. "No stamp" must never read as
    // "no objection".
    stamp.mockResolvedValue({ [CLOSED_A]: {} })
    await expect(
      assertRecordRowsEditable(
        member(Level.Full, [CLOSED_DEF]),
        [CLOSED_A],
        stamp as never,
        defIdToSlug
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
