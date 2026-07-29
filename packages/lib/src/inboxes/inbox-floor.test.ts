// packages/lib/src/inboxes/inbox-floor.test.ts

import { describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §6 — the WRITE half of the floor conversion.
 *
 * `composeUserMailVisibility` reads a floor out of `role:org_member` rows;
 * everything here is about producing rows that composer will read back as the
 * admin intended. The two encodings that are easy to get wrong and impossible to
 * notice:
 *
 *  - **`full` is the ABSENCE of a row**, not a row saying `full`. Writing one
 *    would put every org member into the inbox's grant index for no reason, and
 *    (worse) make the inbox `rowGoverned`, which stands the `Area.inboxes`
 *    fallback down — so a member's own area level would stop mattering.
 *  - **`none` is `permission: 'none'` with a NULL lens** — the v2 RESTRICTION
 *    marker. Encoding it as `view @ none` would make it a GRANT (`grantLens`
 *    maps a `view` row's null lens to `full`), i.e. the precise fail-open shape
 *    RECON §16 describes.
 */

const { onCacheEvent, emitResourceAccessInstanceChanged } = vi.hoisted(() => ({
  // Typed args: a zero-arg `vi.fn` infers a `[]` call tuple, so `calls[i][0]` is
  // a tsc error rather than the assertion below.
  onCacheEvent: vi.fn(async (_event: string, _payload: Record<string, unknown>) => undefined),
  emitResourceAccessInstanceChanged: vi.fn(async () => undefined),
}))

vi.mock('../cache/invalidate', () => ({ onCacheEvent }))
vi.mock('../resource-access/resource-access-service', () => ({
  emitResourceAccessInstanceChanged,
}))

const { floorFromBaselineRow, readInboxFloors, setInboxFloor } = await import('./inbox-floor')

const ORG = 'org_1'
const USER = 'u_1'

interface Recorded {
  inserts: Record<string, unknown>[]
  conflictSets: Record<string, unknown>[]
  deleted: boolean
}

/** Drizzle query-builder fake: records the insert/update/delete shapes. */
function makeDb(selectRows: unknown[] = []) {
  const recorded: Recorded = { inserts: [], conflictSets: [], deleted: false }
  const db = {
    select: () => ({ from: () => ({ where: async () => selectRows }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          recorded.inserts.push(values)
          recorded.conflictSets.push(set)
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => {
          recorded.deleted = true
          return selectRows
        },
      }),
    }),
  }
  return { db: db as never, recorded }
}

describe('floorFromBaselineRow', () => {
  it('reads `none` off the RESTRICTION marker, never as a grant', () => {
    expect(floorFromBaselineRow({ permission: 'none', lens: null })).toBe('none')
    // Even if a stray lens got written alongside it.
    expect(floorFromBaselineRow({ permission: 'none', lens: 'full' })).toBe('none')
  })

  it('takes a `view` row’s lens, defaulting to `full`', () => {
    expect(floorFromBaselineRow({ permission: 'view', lens: 'subject' })).toBe('subject')
    expect(floorFromBaselineRow({ permission: 'view', lens: 'metadata' })).toBe('metadata')
    expect(floorFromBaselineRow({ permission: 'view', lens: null })).toBe('full')
  })

  it('treats `edit`/`admin` as `full` — dead vocabulary, but never silently `none`', () => {
    expect(floorFromBaselineRow({ permission: 'edit', lens: null })).toBe('full')
    expect(floorFromBaselineRow({ permission: 'admin', lens: null })).toBe('full')
  })

  it('ignores an unrecognised lens rather than propagating it', () => {
    expect(floorFromBaselineRow({ permission: 'view', lens: 'nonsense' })).toBe('full')
  })
})

describe('readInboxFloors', () => {
  it('keys authored floors by instance and leaves row-less inboxes ABSENT', async () => {
    // Absent ≠ `full`: the caller defaults, so "authored" stays distinguishable
    // from "defaulted" at the call site.
    const { db } = makeDb([
      { entityInstanceId: 'i_closed', permission: 'none', lens: null },
      { entityInstanceId: 'i_peek', permission: 'view', lens: 'subject' },
    ])
    await expect(readInboxFloors(db, ORG)).resolves.toEqual({
      i_closed: 'none',
      i_peek: 'subject',
    })
  })

  it('short-circuits on an empty instance filter instead of querying for nothing', async () => {
    const { db } = makeDb([{ entityInstanceId: 'i_1', permission: 'none', lens: null }])
    await expect(readInboxFloors(db, ORG, [])).resolves.toEqual({})
  })
})

describe('setInboxFloor', () => {
  it('DELETES the baseline row for `full` — the org-shared default is no row', async () => {
    const { db, recorded } = makeDb([{ id: 'ra_1' }])
    await setInboxFloor({ db, organizationId: ORG, userId: USER }, 'inbox:i_1' as never, 'full')
    expect(recorded.deleted).toBe(true)
    expect(recorded.inserts).toEqual([])
  })

  it('writes `permission: none` with a NULL lens for Restricted', async () => {
    const { db, recorded } = makeDb()
    await setInboxFloor({ db, organizationId: ORG, userId: USER }, 'inbox:i_1' as never, 'none')
    expect(recorded.inserts[0]).toMatchObject({
      organizationId: ORG,
      entityDefinitionId: 'inbox',
      entityInstanceId: 'i_1',
      granteeType: 'role',
      granteeId: 'org_member',
      permission: 'none',
      lens: null,
      grantedById: USER,
    })
    expect(recorded.conflictSets[0]).toMatchObject({ permission: 'none', lens: null })
  })

  it('writes `view` + the lens for a down-tiered floor', async () => {
    for (const lens of ['metadata', 'subject'] as const) {
      const { db, recorded } = makeDb()
      await setInboxFloor({ db, organizationId: ORG, userId: USER }, 'inbox:i_1' as never, lens)
      expect(recorded.inserts[0]).toMatchObject({ permission: 'view', lens })
    }
  })

  it('nulls `grantedById` for system writers — it is a live FK to User', async () => {
    const { db, recorded } = makeDb()
    await setInboxFloor({ db, organizationId: ORG, userId: '' }, 'inbox:i_1' as never, 'none')
    expect(recorded.inserts[0]?.grantedById).toBeNull()
  })

  it('REFUSES a def-CUID RecordId — a row nothing would ever read', async () => {
    const { db, recorded } = makeDb()
    await expect(
      setInboxFloor({ db, organizationId: ORG, userId: USER }, 'edf_cuid:i_1' as never, 'none')
    ).rejects.toThrow(/inbox definition slug/)
    expect(recorded.inserts).toEqual([])
  })

  it('accepts `personal_inbox` keys — the storage layer is def-agnostic', async () => {
    // The "a personal mailbox has no floor" rule is a POLICY the router and
    // `createInbox` enforce; this layer must still be able to clear a stray row.
    const { db, recorded } = makeDb([{ id: 'ra_1' }])
    await setInboxFloor(
      { db, organizationId: ORG, userId: USER },
      'personal_inbox:i_1' as never,
      'full'
    )
    expect(recorded.deleted).toBe(true)
  })

  it('busts mail visibility, the grant index AND the inboxes shape', async () => {
    // Three different caches derive from this row. `resource-access.changed`
    // carries `userMailVisibility` + `mailGrantIndex`; `inbox.updated` carries
    // `org:inboxes`, whose `defaultLens` is derived from these rows.
    onCacheEvent.mockClear()
    emitResourceAccessInstanceChanged.mockClear()
    const { db } = makeDb()
    await setInboxFloor({ db, organizationId: ORG, userId: USER }, 'inbox:i_1' as never, 'subject')
    expect(onCacheEvent.mock.calls.map((c) => c[0])).toEqual([
      'resource-access.changed',
      'inbox.updated',
    ])
    for (const call of onCacheEvent.mock.calls) {
      expect(call[1]).toMatchObject({ orgId: ORG, broadcastUserKeys: true })
    }
    expect(emitResourceAccessInstanceChanged).toHaveBeenCalledWith(ORG, [
      { granteeType: 'role', granteeId: 'org_member' },
    ])
  })

  it('emits NOTHING when a `full` write finds no row to remove', async () => {
    onCacheEvent.mockClear()
    const { db } = makeDb([])
    await setInboxFloor({ db, organizationId: ORG, userId: USER }, 'inbox:i_1' as never, 'full')
    expect(onCacheEvent).not.toHaveBeenCalled()
  })
})
