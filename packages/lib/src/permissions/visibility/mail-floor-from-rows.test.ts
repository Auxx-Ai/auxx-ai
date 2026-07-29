// packages/lib/src/permissions/visibility/mail-floor-from-rows.test.ts

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
// DEEP imports throughout — the `@auxx/lib/permissions` barrel HANGS under vitest.
import { buildMailVisibilityPredicate, buildSearchScope } from '../../mail-query/visibility-scope'
import { composeUserCapabilities } from '../capabilities/compose-user-capabilities'
import { Area, areaLevelFromKeys, Level } from '../capabilities/registry'
import { MEMBER_BASELINE_LEVELS } from '../capabilities/seat-policy'
import { composeUserMailVisibility, type VisibilityGrantRow } from './compute-user-mail-visibility'
import type { UserMailVisibility } from './context'
import { effectiveLens, inboxLensFor } from './effective-lens'

/**
 * Plan 40 phase 2 (§4.2/§4.4/§12) — the mail floor now comes from `ResourceAccess`
 * rows plus the `Area.inboxes` fallback, and rank is no longer an authority
 * anywhere in the mail path.
 *
 * These are END-TO-END over the real composition chain rather than unit tests of
 * `composeUserMailVisibility` alone (that file has its own suite): a real
 * `composeUserCapabilities` builds the capability blob from a profile, the real
 * `areaLevelFromKeys` recovers the area rung from it, and the resulting floors are
 * asserted through the SURFACES that enforce them — the evaluator, the realtime /
 * sidebar floor read, and the SQL list predicate. A regression that only shows up
 * after the level round-trips through `keys` is exactly the kind this catches.
 *
 * The repo's test discipline is denial-shaped and structurally blind to
 * OVER-denial, so §12's three positive controls get their own block and are
 * written as "must still work", not "must be refused".
 */

const ME = 'u_me'
const SHARED = 'ibx_shared'
const RESTRICTED = 'ibx_restricted'
const BOBS = 'ibx_bobs_personal'

// ─────────────────────────────────────────────────────────────────────────────
// Real capability composition → real area level. No hand-written Level literals.
// ─────────────────────────────────────────────────────────────────────────────

type Profile = 'member' | 'admin' | 'owner' | { levels: Partial<Record<Area, Level>> }

function inboxesLevelFor(profile: Profile, role: 'USER' | 'ADMIN' | 'OWNER' = 'USER'): Level {
  const caps = composeUserCapabilities({
    role,
    seatType: 'full',
    typeAccessRows: [],
    ...(profile === 'member'
      ? { profileLevels: MEMBER_BASELINE_LEVELS, profileBaseLevel: null }
      : profile === 'admin' || profile === 'owner'
        ? { profileBaseLevel: Level.Full }
        : { profileLevels: profile.levels, profileBaseLevel: null }),
  })
  return areaLevelFromKeys(new Set(caps.keys), Area.inboxes)
}

const row = (over: Partial<VisibilityGrantRow>): VisibilityGrantRow => ({
  entityDefinitionId: 'inbox',
  entityInstanceId: SHARED,
  granteeType: 'user',
  granteeId: ME,
  permission: 'view',
  lens: 'full',
  ...over,
})

/** The `role:org_member @ none` restriction marker migration 060 writes (§4.1). */
const restrictedBaseline = (id = RESTRICTED) =>
  row({
    entityInstanceId: id,
    granteeType: 'role',
    granteeId: 'org_member',
    permission: 'none',
    lens: null,
  })

const INBOXES = [
  { id: SHARED },
  { id: RESTRICTED },
  { id: BOBS, isPersonal: true, ownerUserId: 'u_bob' },
]

function visFor(opts: {
  profile: Profile
  role?: 'USER' | 'ADMIN' | 'OWNER'
  grants?: VisibilityGrantRow[]
  inboxes?: typeof INBOXES
}): UserMailVisibility {
  const role = opts.role ?? 'USER'
  return composeUserMailVisibility({
    userId: ME,
    role,
    inboxesAreaLevel: inboxesLevelFor(opts.profile, role),
    inboxes: opts.inboxes ?? INBOXES,
    grants: opts.grants ?? [],
  })
}

const threadIn = (inboxId: string | null, over: Record<string, unknown> = {}) => ({
  threadId: 't_1',
  inboxId,
  assigneeId: null,
  primaryEntityInstanceId: null,
  participantContactIds: [],
  ...over,
})

const sqlOf = (viewer: UserMailVisibility) => {
  const predicate = buildMailVisibilityPredicate(viewer)
  return predicate ? new PgDialect().sqlToQuery(predicate) : undefined
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the member baseline resolves through real capability composition', () => {
  it('MEMBER_BASELINE_LEVELS survives the round-trip through `keys` as Read', () => {
    // If this ever regresses to None, every assertion below about the member
    // baseline would pass for the WRONG reason (denial everywhere).
    expect(inboxesLevelFor('member')).toBe(Level.Read)
    expect(inboxesLevelFor('admin', 'ADMIN')).toBe(Level.Full)
    expect(inboxesLevelFor({ levels: { [Area.inboxes]: Level.None } })).toBe(Level.None)
  })
})

describe('§4.2 — admins read mail through rows, both directions', () => {
  it('a DEFAULT admin still sees every row-less shared inbox at full', () => {
    const vis = visFor({ profile: 'admin', role: 'ADMIN' })
    expect(vis.inboxLens[SHARED]).toBe('full')
    expect(effectiveLens(vis, threadIn(SHARED))).toBe('full')
  })

  it('an ADMIN-ranked member on a custom profile at inboxes: None sees NO shared mail', () => {
    const vis = visFor({ profile: { levels: { [Area.inboxes]: Level.None } }, role: 'ADMIN' })
    expect(vis.isAdmin).toBe(true) // still ranked ADMIN …
    expect(vis.inboxLens).toEqual({}) // … and that buys nothing
    expect(effectiveLens(vis, threadIn(SHARED))).toBe('none')
    // The SQL list predicate no longer waves them through either.
    expect(sqlOf(vis)).toBeDefined()
    expect(sqlOf(vis)?.params).not.toContain(SHARED)
  })

  it('an inbox at `role:org_member @ none` is invisible to a DEFAULT admin with no row', () => {
    const vis = visFor({ profile: 'admin', role: 'ADMIN', grants: [restrictedBaseline()] })
    expect(vis.inboxLens[SHARED]).toBe('full')
    expect(vis.inboxLens[RESTRICTED]).toBeUndefined()
    expect(effectiveLens(vis, threadIn(RESTRICTED))).toBe('none')
    expect(sqlOf(vis)?.params).not.toContain(RESTRICTED)
  })

  it('… and an explicit grant puts that admin back in', () => {
    const vis = visFor({
      profile: 'admin',
      role: 'ADMIN',
      grants: [restrictedBaseline(), row({ entityInstanceId: RESTRICTED, permission: 'admin' })],
    })
    expect(vis.inboxLens[RESTRICTED]).toBe('full')
  })

  it('an OWNER is scoped the same way — rank buys nothing in the mail path', () => {
    const vis = visFor({ profile: 'owner', role: 'OWNER', grants: [restrictedBaseline()] })
    expect(vis.inboxLens[RESTRICTED]).toBeUndefined()
  })

  it('the search scope narrows admins too (no inclusion-list bypass left)', () => {
    const vis = visFor({ profile: 'admin', role: 'ADMIN', grants: [restrictedBaseline()] })
    const scope = buildSearchScope(vis, 'full')
    expect(scope).toBeDefined()
    const q = new PgDialect().sqlToQuery(scope!)
    expect(q.params).toContain(SHARED)
    expect(q.params).not.toContain(RESTRICTED)
    // §11: a mail admin's `metadata` floor never satisfies a body search.
    expect(q.params).not.toContain(BOBS)
  })
})

describe('§4.4 — the personal metadata floor, keyed to the mail-operations rung', () => {
  it('a NON-admin granted inboxes: Full sees metadata on a personal mailbox', () => {
    const vis = visFor({ profile: { levels: { [Area.inboxes]: Level.Full } }, role: 'USER' })
    expect(vis.isAdmin).toBe(false)
    expect(vis.isMailAdmin).toBe(true)
    expect(vis.inboxLens[BOBS]).toBe('metadata')
    expect(effectiveLens(vis, threadIn(BOBS))).toBe('metadata')
    // And the list predicate agrees, which is what preserves the "why is nobody
    // answering this" VIEW rather than just the by-id read.
    expect(sqlOf(vis)?.params).toContain(BOBS)
  })

  it('a custom-DOWNGRADED admin does not', () => {
    const vis = visFor({ profile: { levels: { [Area.inboxes]: Level.Read } }, role: 'ADMIN' })
    expect(vis.isMailAdmin).toBe(false)
    expect(vis.inboxLens[BOBS]).toBeUndefined()
    expect(effectiveLens(vis, threadIn(BOBS))).toBe('none')
    expect(sqlOf(vis)?.params).not.toContain(BOBS)
  })

  it('a baseline member never sees a personal mailbox at all', () => {
    const vis = visFor({ profile: 'member' })
    expect(vis.inboxLens[BOBS]).toBeUndefined()
  })

  it('a mail admin never gets more than metadata there without a row', () => {
    const vis = visFor({ profile: 'admin', role: 'ADMIN' })
    expect(inboxLensFor(vis, BOBS)).toBe('metadata')
    expect(buildSearchScope(vis, 'subject')).toBeDefined()
    expect(new PgDialect().sqlToQuery(buildSearchScope(vis, 'subject')!).params).not.toContain(BOBS)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §12 POSITIVE CONTROLS — the cases that must PASS.
// ─────────────────────────────────────────────────────────────────────────────

describe('§12 positive control — the dispatch/controller org keeps working', () => {
  // A shared inbox floored at `none` + a controller who assigns. The assignee
  // holds NO row on that inbox by construction (§1.4), so any surface that gated
  // on the inbox instance tier would break them.
  const assignee = () => visFor({ profile: 'member', grants: [restrictedBaseline(SHARED)] })

  it('the assignee reads the assigned thread at FULL despite a floor-`none` inbox', () => {
    const vis = assignee()
    expect(vis.inboxLens[SHARED]).toBeUndefined() // no inbox access at all …
    expect(effectiveLens(vis, threadIn(SHARED, { assigneeId: ME }))).toBe('full') // … but full here
  })

  it('… and therefore may reply: `full` lens is the entirety of act-authorization', () => {
    // `assertCanActOnThreads` requires exactly `full` (plan 40 §2, pinned in
    // thread-action-access.test.ts). Assert the input it reads.
    expect(effectiveLens(assignee(), threadIn(SHARED, { assigneeId: ME }))).toBe('full')
  })

  it('the SQL list predicate keeps the assignee seed, unconditionally', () => {
    const q = sqlOf(assignee())
    expect(q).toBeDefined()
    expect(q?.params).toContain(ME)
  })

  it('a NON-assigned thread in that inbox stays invisible (negative control)', () => {
    expect(effectiveLens(assignee(), threadIn(SHARED))).toBe('none')
  })
})

describe('§12 positive control — one explicit row at area None (plan 25 derived-key path)', () => {
  it('a member at inboxes: None with one `view` row sees EXACTLY that inbox', () => {
    const vis = visFor({
      profile: { levels: { [Area.inboxes]: Level.None } },
      grants: [row({ entityInstanceId: SHARED, permission: 'view', lens: 'full' })],
    })
    expect(Object.keys(vis.inboxLens)).toEqual([SHARED])
    expect(effectiveLens(vis, threadIn(SHARED))).toBe('full')
    expect(effectiveLens(vis, threadIn(RESTRICTED))).toBe('none')
  })

  it('the row survives even when the org-wide baseline on it says `none`', () => {
    const vis = visFor({
      profile: { levels: { [Area.inboxes]: Level.None } },
      grants: [restrictedBaseline(), row({ entityInstanceId: RESTRICTED, lens: 'subject' })],
    })
    expect(vis.inboxLens).toEqual({ [RESTRICTED]: 'subject' })
  })
})

describe('§12 — headless principals read no member capabilities', () => {
  it('SYSTEM is unscoped and AUTOMATION is scoped only by personal mailboxes', () => {
    // Ingest, sequences and workflows write mail as the system; a restricted
    // inbox must still receive and still send. Neither principal reaches the
    // capability blob, so nothing in this phase can narrow them.
    expect(buildMailVisibilityPredicate({ kind: 'system' } as never)).toBeUndefined()
    expect(
      buildMailVisibilityPredicate({ kind: 'automation', personalInboxIds: {} })
    ).toBeUndefined()

    const scoped = buildMailVisibilityPredicate({
      kind: 'automation',
      personalInboxIds: { [BOBS]: true },
    })
    expect(scoped).toBeDefined()
    expect(new PgDialect().sqlToQuery(scoped!).params).toContain(BOBS)
  })
})

describe('null-inbox triage threads', () => {
  it('reach a mail admin, and nobody else without assignment or a grant', () => {
    const mailAdmin = visFor({ profile: 'admin', role: 'ADMIN' })
    const member = visFor({ profile: 'member' })

    expect(mailAdmin.isMailAdmin).toBe(true)
    expect(new PgDialect().sqlToQuery(buildMailVisibilityPredicate(mailAdmin)!).sql).toContain(
      'is null'
    )
    expect(new PgDialect().sqlToQuery(buildMailVisibilityPredicate(member)!).sql).not.toContain(
      'is null'
    )
    // Assignment still reaches them for everyone (ungated collaboration).
    expect(effectiveLens(member, threadIn(null, { assigneeId: ME }))).toBe('full')
  })
})
