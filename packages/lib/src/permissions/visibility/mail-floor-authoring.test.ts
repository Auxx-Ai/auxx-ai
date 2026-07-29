// packages/lib/src/permissions/visibility/mail-floor-authoring.test.ts

import { describe, expect, it } from 'vitest'
// Deep import: the `@auxx/lib/permissions` BARREL hangs under vitest.
import { Level } from '../capabilities/registry'
import { composeUserMailVisibility, type VisibilityGrantRow } from './compute-user-mail-visibility'

/**
 * Plan 40 §6 + 40a §3 — what the FLOOR AUTHORING conversion actually has to be
 * true for.
 *
 * Sibling of `compute-user-mail-visibility.test.ts` (which owns the phase-2
 * floor-source assertions); this file owns the properties that only became
 * reachable once the UI started WRITING `role:org_member` rows:
 *
 *  1. Setting an inbox to a lower level in the UI changes what members see
 *     (it was a live no-op: the form wrote `inbox_default_lens`, which nothing
 *     had read since phase 2).
 *  2. The org-wide baseline row is subject to the `Area.inboxes` front door,
 *     while the member's OWN rows are not.
 *  3. A `personal_inbox` mailbox stays private to its owner — the privacy
 *     property provisioning used to rest on the forgeable `inbox_is_personal`
 *     marker for.
 */

const VIEWER = 'u_viewer'
const OWNER = 'u_owner'

const grant = (over: Partial<VisibilityGrantRow>): VisibilityGrantRow => ({
  entityDefinitionId: 'inbox',
  entityInstanceId: 'i_1',
  granteeType: 'user',
  granteeId: VIEWER,
  permission: 'view',
  lens: 'full',
  ...over,
})

/** The org-wide floor row `inbox.setAccessFloor` writes. */
const baseline = (over: Partial<VisibilityGrantRow>): VisibilityGrantRow =>
  grant({ granteeType: 'role', granteeId: 'org_member', ...over })

type ComposeInput = Parameters<typeof composeUserMailVisibility>[0]

const compose = (over: Partial<ComposeInput> = {}) =>
  composeUserMailVisibility({
    userId: VIEWER,
    role: 'USER',
    inboxesAreaLevel: Level.Read,
    inboxes: [],
    grants: [],
    ...over,
  })

// ═══════════════════════════════════════════════════════════════════════════
// 1. The live no-op this slice fixes
// ═══════════════════════════════════════════════════════════════════════════

describe('authoring the floor changes what members see', () => {
  const inboxes = [{ id: 'shared' }]

  it('no baseline row ⇒ the org-shared default (`full`)', () => {
    expect(compose({ inboxes }).inboxLens).toEqual({ shared: 'full' })
  })

  it('`role:org_member @ view` + lens ⇒ exactly that tier, not `full`', () => {
    for (const lens of ['metadata', 'subject'] as const) {
      const vis = compose({
        inboxes,
        grants: [baseline({ entityInstanceId: 'shared', permission: 'view', lens })],
      })
      expect(vis.inboxLens).toEqual({ shared: lens })
    }
  })

  it('a `view @ subject` baseline is NOT raised back to `full` by the area fallback', () => {
    // The regression this guards: `rowGoverned` keys on the row's PRESENCE, not
    // its permission. Key it on `permission === 'none'` instead and the fallback
    // stacks `full` on top of every down-tier, silently undoing it.
    for (const level of [Level.Read, Level.Full] as const) {
      const vis = compose({
        inboxesAreaLevel: level,
        inboxes,
        grants: [baseline({ entityInstanceId: 'shared', permission: 'view', lens: 'subject' })],
      })
      expect(vis.inboxLens).toEqual({ shared: 'subject' })
    }
  })

  it('`role:org_member @ none` hides the inbox from a non-grantee ADMIN', () => {
    // `none` is a RESTRICTION marker, never a grant. A default admin holds
    // `inboxes: Full`, so before phase 2 rank alone would have opened this.
    const vis = compose({
      role: 'ADMIN',
      inboxesAreaLevel: Level.Full,
      inboxes,
      grants: [baseline({ entityInstanceId: 'shared', permission: 'none', lens: null })],
    })
    expect(vis.inboxLens).toEqual({})
    expect(vis.isAdmin).toBe(true)
  })

  it('an explicit grant still beats a `@ none` floor', () => {
    const vis = compose({
      inboxes,
      grants: [
        baseline({ entityInstanceId: 'shared', permission: 'none', lens: null }),
        grant({ entityInstanceId: 'shared', permission: 'view', lens: 'full' }),
      ],
    })
    expect(vis.inboxLens).toEqual({ shared: 'full' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. The front door applies to the BASELINE row, not to the member's own rows
// ═══════════════════════════════════════════════════════════════════════════

describe('`inboxes: None` means none — for row-governed inboxes too', () => {
  it('resolves NOTHING on an inbox carrying a `role:org_member @ view` row', () => {
    // Unreachable before this slice (the only `role:org_member` inbox rows in
    // existence were migration 060's). Authoring the floor from the UI makes it
    // reachable: without the `areaOpen` gate on the baseline branch, a member
    // whose profile closes mail entirely would read every inbox an admin had
    // merely DOWN-TIERED — the exact inversion of plan §1.4.
    const vis = compose({
      inboxesAreaLevel: Level.None,
      inboxes: [{ id: 'peek' }],
      grants: [baseline({ entityInstanceId: 'peek', permission: 'view', lens: 'subject' })],
    })
    expect(vis.inboxLens).toEqual({})
  })

  it('resolves nothing on a `full`-lensed baseline row either', () => {
    const vis = compose({
      inboxesAreaLevel: Level.None,
      inboxes: [{ id: 'open' }],
      grants: [baseline({ entityInstanceId: 'open', permission: 'view', lens: 'full' })],
    })
    expect(vis.inboxLens).toEqual({})
  })

  it('resolves nothing on a `role:org_member @ none` inbox', () => {
    const vis = compose({
      inboxesAreaLevel: Level.None,
      inboxes: [{ id: 'closed' }],
      grants: [baseline({ entityInstanceId: 'closed', permission: 'none', lens: null })],
    })
    expect(vis.inboxLens).toEqual({})
  })

  it('POSITIVE CONTROL: an explicit user row still resolves exactly that inbox', () => {
    // plan 25 §2 / plan §12 — a member at area `None` holding ONE explicit share
    // derives a front-door key from it and must still see that one inbox. The
    // gate belongs on the org-wide baseline, never on the viewer's own rows.
    const vis = compose({
      inboxesAreaLevel: Level.None,
      inboxes: [{ id: 'mine' }, { id: 'theirs' }],
      grants: [grant({ entityInstanceId: 'mine', permission: 'view', lens: 'full' })],
    })
    expect(vis.inboxLens).toEqual({ mine: 'full' })
  })

  it('POSITIVE CONTROL: a group row survives a closed front door too', () => {
    const vis = compose({
      inboxesAreaLevel: Level.None,
      inboxes: [{ id: 'mine' }],
      grants: [
        grant({
          entityInstanceId: 'mine',
          granteeType: 'group',
          granteeId: 'grp_1',
          permission: 'admin',
          lens: null,
        }),
      ],
    })
    expect(vis.inboxLens).toEqual({ mine: 'full' })
  })

  it('POSITIVE CONTROL: an own `admin` row outranks a down-tiered floor', () => {
    // The area level is a GATE, not a lens clamp: `Read` does not cap a member
    // who was explicitly made Manager of one inbox.
    const vis = compose({
      inboxesAreaLevel: Level.Read,
      inboxes: [{ id: 'shared' }],
      grants: [
        baseline({ entityInstanceId: 'shared', permission: 'view', lens: 'subject' }),
        grant({ entityInstanceId: 'shared', permission: 'admin', lens: null }),
      ],
    })
    expect(vis.inboxLens).toEqual({ shared: 'full' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Provisioning privacy — the property that used to rest on a forgeable flag
// ═══════════════════════════════════════════════════════════════════════════

describe('a newly provisioned personal mailbox is private to its owner', () => {
  const mailbox = [{ id: 'pi_1', isPersonal: true, ownerUserId: OWNER }]
  /** What `provisionPersonalInbox` writes: ONE owner `admin` row, nothing else. */
  const ownerRow = grant({
    entityDefinitionId: 'personal_inbox',
    entityInstanceId: 'pi_1',
    granteeType: 'user',
    granteeId: OWNER,
    permission: 'admin',
    lens: null,
  })

  it('the OWNER reads it at `full` through their `personal_inbox`-keyed row', () => {
    const vis = composeUserMailVisibility({
      userId: OWNER,
      role: 'USER',
      inboxesAreaLevel: Level.Read,
      inboxes: mailbox,
      grants: [ownerRow],
    })
    expect(vis.inboxLens).toEqual({ pi_1: 'full' })
    // Never in the viewer's OWN personal-inbox cap set.
    expect(vis.personalInboxIds).toEqual({})
  })

  it('another member sees NOTHING, at any open rung', () => {
    // No grants at all: the grant query is grantee-scoped, so the owner's row is
    // not among the rows THIS member's composition ever sees.
    for (const level of [Level.Read, Level.Edit] as const) {
      const vis = compose({ inboxesAreaLevel: level, inboxes: mailbox, grants: [] })
      expect(vis.inboxLens).toEqual({})
      expect(vis.personalInboxIds).toEqual({ pi_1: true })
    }
  })

  it('a default ADMIN (`inboxes: Full`) sees METADATA only — never the content', () => {
    const vis = compose({
      role: 'ADMIN',
      inboxesAreaLevel: Level.Full,
      inboxes: mailbox,
      grants: [],
    })
    expect(vis.inboxLens).toEqual({ pi_1: 'metadata' })
    expect(vis.isMailAdmin).toBe(true)
  })

  it('a STRAY `role:org_member` row on a personal mailbox grants nobody anything', () => {
    // A personal mailbox has no org-wide default in any form. `personal_inbox`
    // is the `baselineAtCreate: true` key: no row ⇒ no access, and a baseline row
    // is not a row that names you.
    const vis = compose({
      inboxesAreaLevel: Level.Read,
      inboxes: mailbox,
      grants: [
        baseline({
          entityDefinitionId: 'personal_inbox',
          entityInstanceId: 'pi_1',
          permission: 'view',
          lens: 'full',
        }),
      ],
    })
    expect(vis.inboxLens).toEqual({})
  })

  it('an explicit share on the personal mailbox DOES reach its grantee', () => {
    // The owner can still share their own mailbox — the def split closes the
    // org-wide door, not the per-person one.
    const vis = compose({
      inboxes: mailbox,
      grants: [
        grant({
          entityDefinitionId: 'personal_inbox',
          entityInstanceId: 'pi_1',
          permission: 'view',
          lens: 'subject',
        }),
      ],
    })
    expect(vis.inboxLens).toEqual({ pi_1: 'subject' })
  })
})
