// packages/lib/src/permissions/visibility/compute-user-mail-visibility.test.ts

import { describe, expect, it } from 'vitest'
// Deep import: the `@auxx/lib/permissions` BARREL hangs under vitest.
import { Level } from '../capabilities/registry'
import { composeUserMailVisibility, type VisibilityGrantRow } from './compute-user-mail-visibility'

const USER = 'u_1'

/** A user-grantee row (the default) — see {@link baseline} for the org-wide one. */
const grant = (over: Partial<VisibilityGrantRow>): VisibilityGrantRow => ({
  entityDefinitionId: 'inbox',
  entityInstanceId: 'i_1',
  granteeType: 'user',
  granteeId: USER,
  permission: 'view',
  lens: 'full',
  ...over,
})

/** The `role:org_member` workspace-baseline row migration 060 writes (§4.1). */
const baseline = (over: Partial<VisibilityGrantRow>): VisibilityGrantRow =>
  grant({ granteeType: 'role', granteeId: 'org_member', ...over })

type ComposeInput = Parameters<typeof composeUserMailVisibility>[0]

const compose = (over: Partial<ComposeInput> = {}) =>
  composeUserMailVisibility({
    userId: USER,
    role: 'USER',
    // The member baseline: `MEMBER_BASELINE_LEVELS[Area.inboxes] = Level.Read`.
    inboxesAreaLevel: Level.Read,
    inboxes: [],
    grants: [],
    ...over,
  })

describe('composeUserMailVisibility', () => {
  it('marks OWNER/ADMIN as admin, USER as not', () => {
    for (const [role, isAdmin] of [
      ['OWNER', true],
      ['ADMIN', true],
      ['USER', false],
    ] as const) {
      const vis = compose({ role })
      expect(vis.isAdmin).toBe(isAdmin)
      expect(vis.userId).toBe(USER)
    }
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Plan 40 §4.2 — the floor comes from ResourceAccess rows + the area
  // fallback. `inbox_default_lens` is no longer an input at all.
  // ───────────────────────────────────────────────────────────────────────────
  describe('floor source: rows + the Area.inboxes fallback', () => {
    it('gives a row-LESS shared inbox the `full` fallback at any open rung', () => {
      for (const level of [Level.Read, Level.Edit, Level.Full] as const) {
        const vis = compose({ inboxesAreaLevel: level, inboxes: [{ id: 'open' }] })
        expect(vis.inboxLens).toEqual({ open: 'full' })
      }
    })

    it('gives NO floor at all when the area is closed (inboxes: None means none)', () => {
      const vis = compose({ inboxesAreaLevel: Level.None, inboxes: [{ id: 'open' }] })
      expect(vis.inboxLens).toEqual({})
    })

    it('takes the lens off a `role:org_member @ view` baseline row and stops there', () => {
      // The fallback must NOT stack `full` on top of an authored down-tier, or the
      // migration's `subject` floors are silently undone.
      const vis = compose({
        inboxes: [{ id: 'peek' }],
        grants: [baseline({ entityInstanceId: 'peek', permission: 'view', lens: 'subject' })],
      })
      expect(vis.inboxLens).toEqual({ peek: 'subject' })
    })

    it('excludes an inbox restricted with `role:org_member @ none`', () => {
      const vis = compose({
        inboxes: [{ id: 'closed' }],
        grants: [baseline({ entityInstanceId: 'closed', permission: 'none', lens: null })],
      })
      expect(vis.inboxLens).toEqual({})
    })

    it('lets an explicit user row RAISE a restricted inbox back up', () => {
      const vis = compose({
        inboxes: [{ id: 'closed' }],
        grants: [
          baseline({ entityInstanceId: 'closed', permission: 'none', lens: null }),
          grant({ entityInstanceId: 'closed', permission: 'view', lens: 'subject' }),
        ],
      })
      expect(vis.inboxLens).toEqual({ closed: 'subject' })
    })

    it('lets an explicit user `none` row close an otherwise-open shared inbox', () => {
      const vis = compose({
        inboxes: [{ id: 'open' }],
        grants: [grant({ entityInstanceId: 'open', permission: 'none', lens: null })],
      })
      expect(vis.inboxLens).toEqual({})
    })

    it('treats edit/admin permission as full and view without lens as full', () => {
      const vis = compose({
        inboxesAreaLevel: Level.None,
        inboxes: [{ id: 'a' }, { id: 'b' }],
        grants: [
          grant({ entityInstanceId: 'a', permission: 'admin', lens: null }),
          grant({ entityInstanceId: 'b', permission: 'view', lens: null }),
        ],
      })
      expect(vis.inboxLens).toEqual({ a: 'full', b: 'full' })
    })

    // The area level is a GATE, not a confidentiality tier (§4.2). `Read` must
    // never clamp a lens a row conferred.
    it('never clamps a row-granted lens down to the area rung', () => {
      const vis = compose({
        inboxesAreaLevel: Level.Read,
        inboxes: [{ id: 'closed' }],
        grants: [
          baseline({ entityInstanceId: 'closed', permission: 'none', lens: null }),
          grant({ entityInstanceId: 'closed', permission: 'admin', lens: null }),
        ],
      })
      expect(vis.inboxLens).toEqual({ closed: 'full' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // §4.2 admins-through-rows, BOTH directions.
  // ───────────────────────────────────────────────────────────────────────────
  describe('admins read through rows, not rank', () => {
    it('a default admin (inboxes: Full) still sees every row-less shared inbox', () => {
      const vis = compose({
        role: 'ADMIN',
        inboxesAreaLevel: Level.Full,
        inboxes: [{ id: 'open' }],
      })
      expect(vis.inboxLens).toEqual({ open: 'full' })
    })

    it('an ADMIN-ranked member on a custom profile at inboxes: None sees no shared mail', () => {
      const vis = compose({
        role: 'ADMIN',
        inboxesAreaLevel: Level.None,
        inboxes: [{ id: 'open' }, { id: 'other' }],
      })
      expect(vis.isAdmin).toBe(true)
      expect(vis.inboxLens).toEqual({})
    })

    it('an inbox at `role:org_member @ none` is invisible to a DEFAULT admin with no row', () => {
      const vis = compose({
        role: 'ADMIN',
        inboxesAreaLevel: Level.Full,
        inboxes: [{ id: 'open' }, { id: 'secret' }],
        grants: [baseline({ entityInstanceId: 'secret', permission: 'none', lens: null })],
      })
      expect(vis.inboxLens).toEqual({ open: 'full' })
    })

    it('an OWNER is scoped the same way — rank is not a mail authority', () => {
      const vis = compose({
        role: 'OWNER',
        inboxesAreaLevel: Level.Full,
        inboxes: [{ id: 'secret' }],
        grants: [baseline({ entityInstanceId: 'secret', permission: 'none', lens: null })],
      })
      expect(vis.inboxLens).toEqual({})
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // §4.4 — the personal `metadata` floor, re-keyed off the mail-operations rung.
  // ───────────────────────────────────────────────────────────────────────────
  describe('isMailAdmin and the personal-mailbox metadata floor', () => {
    const bobs = { id: 'bobs', isPersonal: true, ownerUserId: 'u_bob' }
    const mine = { id: 'mine', isPersonal: true, ownerUserId: USER }

    it('is Full-only', () => {
      expect(compose({ inboxesAreaLevel: Level.Full }).isMailAdmin).toBe(true)
      for (const level of [Level.None, Level.Read, Level.Edit] as const) {
        expect(compose({ inboxesAreaLevel: level }).isMailAdmin).toBe(false)
      }
    })

    it('is false for a non-member even at Full (fail closed)', () => {
      expect(compose({ role: undefined, inboxesAreaLevel: Level.Full }).isMailAdmin).toBe(false)
    })

    it("a NON-admin granted inboxes: Full sees metadata on another's personal mailbox", () => {
      const vis = compose({ role: 'USER', inboxesAreaLevel: Level.Full, inboxes: [bobs] })
      expect(vis.isAdmin).toBe(false)
      expect(vis.inboxLens).toEqual({ bobs: 'metadata' })
    })

    it('a custom-DOWNGRADED admin does not', () => {
      const vis = compose({ role: 'ADMIN', inboxesAreaLevel: Level.Read, inboxes: [bobs] })
      expect(vis.inboxLens).toEqual({})
    })

    it('never floors the viewer’s OWN personal mailbox from the rung', () => {
      const vis = compose({ role: 'ADMIN', inboxesAreaLevel: Level.Full, inboxes: [mine] })
      expect(vis.inboxLens).toEqual({})
      expect(vis.personalInboxIds).toEqual({})
    })

    it('the owner reaches full through their Manager row, not through a rung', () => {
      const vis = compose({
        inboxesAreaLevel: Level.Read,
        inboxes: [mine],
        grants: [
          grant({
            entityDefinitionId: 'personal_inbox',
            entityInstanceId: 'mine',
            permission: 'admin',
            lens: null,
          }),
        ],
      })
      expect(vis.inboxLens).toEqual({ mine: 'full' })
    })

    it('a personal mailbox NEVER takes the shared area fallback', () => {
      // The whole reason `personal_inbox` is a second key with
      // `baselineAtCreate: true` (§0.2). A rung must not open someone's mailbox.
      const vis = compose({ inboxesAreaLevel: Level.Read, inboxes: [bobs] })
      expect(vis.inboxLens).toEqual({})
    })
  })

  describe('grant bucketing', () => {
    it('buckets thread/contact/entity grants and skips non-mail built-ins', () => {
      const vis = compose({
        grants: [
          grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'metadata' }),
          grant({ entityDefinitionId: 'contact', entityInstanceId: 'c_1', lens: 'full' }),
          grant({
            entityDefinitionId: 'ysd5fhcustomdef',
            entityInstanceId: 'e_1',
            lens: 'subject',
          }),
          grant({ entityDefinitionId: 'snippet', entityInstanceId: 's_1' }),
          grant({ entityDefinitionId: 'folder', entityInstanceId: 'f_1' }),
        ],
      })
      expect(vis.threadGrants).toEqual({ t_1: 'metadata' })
      expect(vis.contactGrants).toEqual({ c_1: 'full' })
      expect(vis.entityGrants).toEqual({ e_1: 'subject' })
    })

    it('keeps the max lens when the same instance is granted twice', () => {
      const vis = compose({
        grants: [
          grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'metadata' }),
          grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'full' }),
        ],
      })
      expect(vis.threadGrants).toEqual({ t_1: 'full' })
    })

    it('a `none` permission confers nothing (the restriction marker, not a grant)', () => {
      const vis = compose({
        grants: [
          grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', permission: 'none' }),
        ],
      })
      expect(vis.threadGrants).toEqual({})
    })

    // ─────────────────────────────────────────────────────────────────────────
    // Plan 40 §5.4 — `NON_MAIL_BUILTIN_TYPES` is DERIVED from
    // `INSTANCE_ACCESS_KEYS` ∪ `BuiltInEntityTypeValues`, minus the mail defs.
    // Both directions are asserted because the derivation can fail either way:
    // subtract too little and the mail buckets go empty (visibility collapses);
    // subtract too much and every shareable non-record resource pollutes
    // `entityGrants` in every member's cached blob.
    // ─────────────────────────────────────────────────────────────────────────
    describe('the derived non-mail exclusion', () => {
      // Direction 1 — EXCLUDED. `signature`, `dataset`, `kb`, `dashboard` and
      // `agent` are exactly the keys the old hand-written list had gone stale on:
      // each became a shareable resource type after it was written, and none was
      // ever added, so their grants have been landing in `entityGrants`.
      it.each([
        'signature',
        'snippet',
        'dataset',
        'kb',
        'dashboard',
        'agent',
        'workflow',
      ])('keeps a `%s` grant out of entityGrants', (key) => {
        const vis = compose({ grants: [grant({ entityDefinitionId: key, entityInstanceId: 'x' })] })
        expect(vis.entityGrants).toEqual({})
      })

      // The two built-in grant slugs that are NOT instance-access keys. A purely
      // `INSTANCE_ACCESS_KEYS`-derived set would have silently readmitted them.
      it.each(['folder', 'document'])('keeps a `%s` grant out of entityGrants', (key) => {
        const vis = compose({ grants: [grant({ entityDefinitionId: key, entityInstanceId: 'x' })] })
        expect(vis.entityGrants).toEqual({})
      })

      // Direction 2 — INCLUDED. `inbox` and `personal_inbox` are instance-access
      // keys and `thread`/`contact` are mail sharing defs, so a derivation that
      // forgot to subtract the mail defs would put all four in the exclusion set.
      // The `else if` chain claims them before the test today, but branch order is
      // not a safety property — assert the buckets directly.
      it('still buckets BOTH inbox defs into the inbox floor, not entityGrants', () => {
        const vis = compose({
          inboxes: [{ id: 'shared' }, { id: 'mine', isPersonal: true, ownerUserId: USER }],
          grants: [
            grant({ entityDefinitionId: 'inbox', entityInstanceId: 'shared', lens: 'subject' }),
            grant({
              entityDefinitionId: 'personal_inbox',
              entityInstanceId: 'mine',
              permission: 'admin',
              lens: null,
            }),
          ],
        })
        expect(vis.inboxLens).toEqual({ shared: 'full', mine: 'full' })
        expect(vis.entityGrants).toEqual({})
      })

      it('still buckets thread and contact grants into their own maps', () => {
        const vis = compose({
          grants: [
            grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1', lens: 'metadata' }),
            grant({ entityDefinitionId: 'contact', entityInstanceId: 'c_1', lens: 'full' }),
          ],
        })
        expect(vis.threadGrants).toEqual({ t_1: 'metadata' })
        expect(vis.contactGrants).toEqual({ c_1: 'full' })
        expect(vis.entityGrants).toEqual({})
      })

      // A CUSTOM def's CUID must still reach `entityGrants` — that bucket is the
      // `entity-grant` derivation rule's whole input (a grant on the thread's
      // primary ticket/deal). An over-broad exclusion would take it out silently.
      it('still admits a custom def CUID to entityGrants', () => {
        const vis = compose({
          grants: [grant({ entityDefinitionId: 'ysd5fhcustomdef', entityInstanceId: 'e_1' })],
        })
        expect(vis.entityGrants).toEqual({ e_1: 'full' })
      })
    })
  })

  it("collects OTHERS' personal inboxes into personalInboxIds, never the viewer's own", () => {
    const vis = compose({
      role: 'ADMIN',
      inboxesAreaLevel: Level.Full,
      inboxes: [
        { id: 'mine', isPersonal: true, ownerUserId: USER },
        { id: 'bobs', isPersonal: true, ownerUserId: 'u_bob' },
        { id: 'shared', isPersonal: false, ownerUserId: null },
      ],
    })
    expect(vis.personalInboxIds).toEqual({ bobs: true })
  })

  it('fails closed for a non-member: no floors, no admin, no fallback', () => {
    const vis = compose({
      role: undefined,
      inboxesAreaLevel: Level.Full,
      inboxes: [{ id: 'open' }, { id: 'bobs', isPersonal: true, ownerUserId: 'u_bob' }],
    })
    expect(vis.isAdmin).toBe(false)
    expect(vis.isMailAdmin).toBe(false)
    expect(vis.inboxLens).toEqual({})
    expect(vis.personalInboxIds).toEqual({})
  })

  // Plan 40 §3.4 / 40a §4 — data migration 060 re-keys a personal mailbox's
  // grant rows from `'inbox'` to `'personal_inbox'`. If this bucketing does not
  // learn the new slug in the SAME deploy, the rows fall through to
  // `entityGrants` and the owner silently loses their own mailbox: nothing
  // throws, the floor is simply never raised.
  describe('personal_inbox grant rows (the 060 lockstep)', () => {
    const owner = { id: 'pi_1', isPersonal: true, ownerUserId: USER }

    it('raises the inbox floor from a personal_inbox row, exactly like an inbox row', () => {
      const vis = compose({
        inboxes: [owner],
        grants: [
          grant({
            entityDefinitionId: 'personal_inbox',
            entityInstanceId: 'pi_1',
            permission: 'admin',
            lens: null,
          }),
        ],
      })
      expect(vis.inboxLens).toEqual({ pi_1: 'full' })
    })

    it('does NOT leak the row into entityGrants (the pre-fix failure mode)', () => {
      const vis = compose({
        inboxes: [owner],
        grants: [
          grant({
            entityDefinitionId: 'personal_inbox',
            entityInstanceId: 'pi_1',
            lens: 'subject',
          }),
        ],
      })
      expect(vis.entityGrants).toEqual({})
      expect(vis.inboxLens).toEqual({ pi_1: 'subject' })
    })

    it('produces the identical context for either keyspace — the re-key is invisible', () => {
      const build = (entityDefinitionId: string) =>
        compose({
          inboxes: [owner],
          grants: [grant({ entityDefinitionId, entityInstanceId: 'pi_1', lens: 'metadata' })],
        })
      expect(build('personal_inbox')).toEqual(build('inbox'))
    })

    it('still sends a non-mail def to entityGrants (negative control)', () => {
      const vis = compose({
        inboxes: [owner],
        grants: [
          grant({ entityDefinitionId: 'personal_inboxes', entityInstanceId: 'x_1', lens: 'full' }),
        ],
      })
      expect(vis.inboxLens).toEqual({})
      expect(vis.entityGrants).toEqual({ x_1: 'full' })
    })
  })

  it('is JSON-serializable (cache round-trip)', () => {
    const vis = compose({
      role: 'ADMIN',
      inboxesAreaLevel: Level.Full,
      inboxes: [{ id: 'open' }],
      grants: [grant({ entityDefinitionId: 'thread', entityInstanceId: 't_1' })],
    })
    expect(JSON.parse(JSON.stringify(vis))).toEqual(vis)
  })
})
