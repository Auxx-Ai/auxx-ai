// packages/lib/src/resource-access/resource-access-service.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only onCacheEvent + getCachedUserGroupIds + getCachedResources are pulled from
// the cache barrel by this module; mocking them keeps the heavy cache/realtime
// deps out of the test. `getCachedResources` feeds the mail-keyspace backstop's
// def→slug resolver (see `mail-keyspace-backstop.test.ts` for its own coverage).
vi.mock('../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getCachedUserGroupIds: vi.fn(async () => []),
  getCachedResources: vi.fn(async () => []),
  // `resolveShareRecipients` now routes through the ONE shared grantee expansion
  // (`grantee-resolution.expandGranteeToUserIds`, plan 42 §3.1), which reads the
  // org cache for the `role:org_member` and `humansOnly` branches.
  getOrgCache: () => ({
    get: async (_orgId: string, key: string) =>
      key === 'members' ? [] : key === 'memberRoleMap' ? {} : [],
  }),
}))

// A profile grantee routes through the SAME audience sweep `grant-service.ts`
// uses, so it is stubbed here rather than reimplemented (19a #25).
const resolveProfileAudience = vi.fn(async () => ({
  userIds: ['u_holder_a', 'u_holder_b'],
  broadcast: false,
}))
vi.mock('../permissions/profiles/profile-invalidation', () => ({
  resolveProfileAudience: (...a: unknown[]) => resolveProfileAudience(...(a as [])),
}))

const resolveProfileHolders = vi.fn(async () => ['u_holder_a', 'u_holder_b'])
// `resolveResourceAccessGrantees` reads the org cache (memberRoleMap + profiles);
// the check-path tests below only care about the ROLE short-circuit, so the
// grantee union is stubbed to "no groups, no profile".
const resolveResourceAccessGrantees = vi.fn(async (_org: string, userId: string) => ({
  userId,
  groupIds: [] as string[],
  profileId: null as string | null,
}))
// Spied at the SHARED-EXPANSION seam (plan 42 §3.1). `resolveShareRecipients` no
// longer calls `resolveProfileHolders` itself — it routes every grantee kind
// through `expandGranteeToUserIds`, which is what 19a #26's bug (a profile grantee
// falling through to the group branch and matching nothing) now cannot happen in
// only one of several copies.
const expandGranteeToUserIds = vi.fn(async () => ({
  userIds: ['u_holder_a', 'u_holder_b'],
  capped: false,
}))
vi.mock('./grantee-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./grantee-resolution')>()),
  resolveProfileHolders: (...a: unknown[]) => resolveProfileHolders(...(a as [])),
  expandGranteeToUserIds: (...a: unknown[]) => expandGranteeToUserIds(...(a as [])),
  resolveResourceAccessGrantees: (...a: unknown[]) =>
    resolveResourceAccessGrantees(...(a as [string, string])),
}))

import { onCacheEvent } from '../cache'
import {
  checkAccess,
  emitResourceAccessInstanceChanged,
  grantInstanceAccess,
  grantTypeAccess,
  revokeInstanceAccess,
  setInstanceAccess,
} from './resource-access-service'

const ORG = 'org_1'
const RECORD = toRecordId('inbox', 'inbox_1')

/** Minimal chainable fake db covering the write shapes these functions use. */
function fakeDb(opts: { deleteReturning?: Array<{ granteeId: string }>; inserted?: boolean } = {}) {
  const db: any = {
    query: {
      User: { findFirst: async () => ({ name: 'Granter' }) },
    },
    // The share-notification path resolves the shared resource's name; an empty
    // result short-circuits it after the recipients have been resolved.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    // `onConflictDoUpdate` is both awaitable and chainable: `grantInstanceAccess`
    // reads `RETURNING xmax = 0` off it to tell an INSERT from an UPDATE (which is
    // what decides whether this is a NEW share worth notifying about), while
    // `grantTypeAccess` awaits it directly.
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [{ inserted: opts.inserted ?? true }],
        }),
      }),
    }),
    delete: () => ({
      where: () => ({ returning: async () => opts.deleteReturning ?? [] }),
    }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
  }
  return db
}

const emit = vi.mocked(onCacheEvent)

describe('resource-access cache-event emission', () => {
  beforeEach(() => {
    emit.mockClear()
    resolveProfileAudience.mockClear()
  })

  it('targets a single user for a user grant', async () => {
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD,
        granteeType: ResourceGranteeType.user,
        granteeId: 'u_target',
        rung: 'read',
      }
    )
    // `userIds`, not `userId`: ONE cache event per audience (plan 45 §1.3). The
    // targeted branch of `onCacheEvent` re-walks the graph, marks counts stale and
    // publishes per call, so a per-user loop multiplied all three.
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      userIds: ['u_target'],
    })
  })

  it('fans out org-wide for a role grant', async () => {
    await grantTypeAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        entityDefinitionId: 'inbox',
        granteeType: ResourceGranteeType.role,
        granteeId: 'org_member',
        rung: 'read',
      }
    )
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  // ── Plan 45 §3.3 — narrowing the group/team fan-out ──
  //
  // The load-bearing safety here is the `default` branch, not the agreement
  // between resolvers: narrowing a broadcast is the fail-OPEN direction, so a
  // grantee kind nobody classified must still bust everyone.

  it('targets a GROUP grant at its members instead of the whole org (§1.3)', async () => {
    expandGranteeToUserIds.mockResolvedValueOnce({
      userIds: ['u_g1', 'u_g2', 'u_g3'],
      capped: false,
    } as never)

    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD,
        granteeType: ResourceGranteeType.group,
        granteeId: 'grp_support',
        rung: 'read',
      }
    )

    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      userIds: ['u_g1', 'u_g2', 'u_g3'],
    })
    // The whole point: a three-person group used to recompute every member's mail
    // blob and make every connected client refetch three queries.
    expect(emit).not.toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('narrows a legacy TEAM grantee too — the mail evaluator treats it as a group', async () => {
    expandGranteeToUserIds.mockResolvedValueOnce({ userIds: ['u_t1'], capped: false } as never)

    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD,
        granteeType: ResourceGranteeType.team,
        granteeId: 'team_legacy',
        rung: 'read',
      }
    )

    // Drop the `team` case from the switch and this fails while every other test
    // in the file still passes — the §3.3 mutation, made concrete.
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      userIds: ['u_t1'],
    })
  })

  it('an UNCLASSIFIED grantee kind still broadcasts — the fail-safe default', async () => {
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD,
        // A kind that does not exist yet, standing in for the one added next year
        // by someone who never reads this file.
        granteeType: 'future_kind' as ResourceGranteeType,
        granteeId: 'x_1',
        rung: 'read',
      }
    )

    // THE assertion of item 3. Make the switch exhaustive without a broadcasting
    // `default` and a share becomes visible in one direction only, for the full
    // ONE_DAY TTL (19a finding 4).
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('collapses to ONE broadcast when a mixed set contains an unclassified kind', async () => {
    expandGranteeToUserIds.mockResolvedValueOnce({ userIds: ['u_g1'], capped: false } as never)

    await setInstanceAccess(
      { db: fakeDb({ deleteReturning: [] }), organizationId: ORG, userId: 'g' },
      RECORD,
      ResourceGranteeType.group,
      [{ granteeId: 'grp_a', rung: 'read' }]
    )
    emit.mockClear()

    await setInstanceAccess(
      { db: fakeDb({ deleteReturning: [] }), organizationId: ORG, userId: 'g' },
      RECORD,
      'future_kind' as ResourceGranteeType,
      [{ granteeId: 'x_1', rung: 'read' }]
    )

    const changed = emit.mock.calls.filter((c) => c[0] === 'resource-access.changed')
    expect(changed).toHaveLength(1)
    expect(changed[0]?.[1]).toEqual({ orgId: ORG, broadcastUserKeys: true })
  })

  it('does not emit when a revoke deletes nothing', async () => {
    await revokeInstanceAccess(
      { db: fakeDb({ deleteReturning: [] }), organizationId: ORG, userId: 'granter' },
      { recordId: RECORD, granteeType: ResourceGranteeType.user, granteeId: 'u_x' }
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('accepts a profile grantee — the step-9 write guard is gone', async () => {
    await expect(
      grantTypeAccess(
        { db: fakeDb(), organizationId: ORG, userId: 'granter' },
        {
          entityDefinitionId: 'def_deals',
          granteeType: ResourceGranteeType.profile,
          granteeId: 'prof_field',
          rung: 'read',
        }
      )
    ).resolves.toBeUndefined()
  })

  it('targets a profile grant at its holders instead of broadcasting (19a #25)', async () => {
    await grantTypeAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        entityDefinitionId: 'def_deals',
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        rung: 'read',
      }
    )
    expect(resolveProfileAudience).toHaveBeenCalledWith({
      organizationId: ORG,
      profileId: 'prof_field',
    })
    const targeted = emit.mock.calls
      .filter((c) => c[0] === 'resource-access.changed')
      .flatMap((c) => c[1].userIds ?? [])
      .sort()
    expect(targeted).toEqual(['u_holder_a', 'u_holder_b'])
    expect(emit).not.toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('falls back to an org-wide broadcast when the profile audience says so', async () => {
    resolveProfileAudience.mockResolvedValueOnce({ userIds: [], broadcast: true })
    await grantTypeAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        entityDefinitionId: 'def_deals',
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        rung: 'read',
      }
    )
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('notifies a profile grant’s holders instead of nobody (19a #26)', async () => {
    expandGranteeToUserIds.mockClear()
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: toRecordId('dashboard', 'dash_1'),
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        rung: 'read',
      }
    )
    // The share notification is fire-and-forget; let the microtask queue drain.
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The profile grantee reaches the shared expansion AS a profile — not
    // reinterpreted as a group instance id, which resolved to nobody with no error
    // and no log.
    expect(expandGranteeToUserIds).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
      }),
      expect.objectContaining({ cap: expect.any(Number) })
    )
  })

  // The new-vs-existing distinction used to be a pre-flight `SELECT`; it is now
  // `RETURNING xmax = 0` off the upsert itself. Same rule — only a genuinely new
  // grant announces itself — so a re-save of an existing row must stay silent, or
  // every permissions-page save re-notifies everyone on it.
  it('does NOT notify when the upsert updated an existing grant', async () => {
    expandGranteeToUserIds.mockClear()
    await grantInstanceAccess(
      { db: fakeDb({ inserted: false }), organizationId: ORG, userId: 'granter' },
      {
        recordId: toRecordId('dashboard', 'dash_1'),
        granteeType: ResourceGranteeType.user,
        granteeId: 'u_existing',
        rung: 'edit',
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(expandGranteeToUserIds).not.toHaveBeenCalled()
  })

  it('an approval-origin grant suppresses the generic share notification (plan 42 §8)', async () => {
    expandGranteeToUserIds.mockClear()
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: toRecordId('thread', 'thread_1'),
        granteeType: ResourceGranteeType.user,
        granteeId: 'u_requester',
        rung: 'read',
        origin: 'approval',
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    // `ACCESS_REQUEST_DECIDED` is sent instead — "Sarah approved your request"
    // beats "Sarah shared a conversation with you" for a thing they asked for.
    expect(expandGranteeToUserIds).not.toHaveBeenCalled()
  })

  it('a DIRECT grant still notifies — the suppression is origin-scoped', async () => {
    expandGranteeToUserIds.mockClear()
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: toRecordId('thread', 'thread_1'),
        granteeType: ResourceGranteeType.user,
        granteeId: 'u_requester',
        rung: 'read',
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(expandGranteeToUserIds).toHaveBeenCalled()
  })

  it('emits for both removed and added grantees on a set', async () => {
    await setInstanceAccess(
      {
        db: fakeDb({ deleteReturning: [{ granteeId: 'u_removed' }] }),
        organizationId: ORG,
        userId: 'g',
      },
      RECORD,
      ResourceGranteeType.user,
      [{ granteeId: 'u_added', rung: 'read' }]
    )
    // Filtered by event name, like the profile-audience case above. `RECORD` is
    // an INBOX RecordId, and since plan 40 phase 1 `inbox` is an
    // `INSTANCE_ACCESS_RESOURCES` key — so `setInstanceAccess` now also fires
    // `resource-access.instance.changed`, and an unfiltered read of
    // `emit.mock.calls` sees each grantee twice.
    const targeted = emit.mock.calls
      .filter((c) => c[0] === 'resource-access.changed')
      .flatMap((c) => c[1].userIds ?? [])
      .sort()
    expect(targeted).toEqual(['u_added', 'u_removed'])
  })

  it('also emits the INSTANCE cache event for an inbox — it is a shareable instance now', async () => {
    // Pinned as its own case rather than folded into the filter above, because
    // the extra emit is the point, not noise: `instanceAccess` /
    // `governingInstanceIds` are now populated from inbox rows, so an inbox
    // grant that did not invalidate them would leave every affected member on a
    // stale capability blob for the full TTL. Drop the
    // `emitResourceAccessInstanceChanged` call from `setInstanceAccess`, or drop
    // `inbox` from `INSTANCE_ACCESS_RESOURCES`, and this is what fails.
    await setInstanceAccess(
      {
        db: fakeDb({ deleteReturning: [{ granteeId: 'u_removed' }] }),
        organizationId: ORG,
        userId: 'g',
      },
      RECORD,
      ResourceGranteeType.user,
      [{ granteeId: 'u_added', rung: 'read' }]
    )
    const instanceEvents = emit.mock.calls
      .filter((c) => c[0] === 'resource-access.instance.changed')
      .flatMap((c) => c[1].userIds ?? [])
      .sort()
    expect(instanceEvents).toEqual(['u_added', 'u_removed'])
  })
})

/**
 * Plan v3/03 §9 (P2) — the emit-site half of the def-agnostic split.
 *
 * The three instance write funnels used to gate `emitResourceAccessInstanceChanged`
 * on `isInstanceAccessKey(entityDefinitionId)`, which a record-def CUID can never
 * satisfy — so a record share fired the mail invalidation alone and the capability
 * blob (where §4's `grantedDefIds` front door lives) stayed stale for the full
 * ONE_DAY TTL on the very first share.
 *
 * The org-wide `governingInstanceIds` half keeps the keyspace gate, as its own
 * event: `governing-instance-ids-provider` selects
 * `entityDefinitionId IN INSTANCE_ACCESS_KEYS` in SQL and re-filters through
 * `isGoverningInstanceRow`, so a record CUID provably cannot enter the set.
 *
 * The graph-mapping half lives in `../cache/instance-grant-invalidation.test.ts`.
 */
describe('§9 — instance-grant invalidation is def-agnostic', () => {
  /** A generic record def: a CUID keyspace id, not an INSTANCE_ACCESS_RESOURCES key. */
  const RECORD_DEF = toRecordId('def_deals_cuid', 'inst_1')

  const eventsFor = (name: string) => emit.mock.calls.filter((c) => c[0] === name)

  beforeEach(() => {
    emit.mockClear()
  })

  for (const [label, run] of [
    [
      'grantInstanceAccess',
      () =>
        grantInstanceAccess(
          { db: fakeDb(), organizationId: ORG, userId: 'granter' },
          {
            recordId: RECORD_DEF,
            granteeType: ResourceGranteeType.user,
            granteeId: 'u_target',
            rung: 'read',
          }
        ),
    ],
    [
      'revokeInstanceAccess',
      () =>
        revokeInstanceAccess(
          {
            db: fakeDb({ deleteReturning: [{ granteeId: 'u_target' }] }),
            organizationId: ORG,
            userId: 'granter',
          },
          { recordId: RECORD_DEF, granteeType: ResourceGranteeType.user, granteeId: 'u_target' }
        ),
    ],
    [
      'setInstanceAccess',
      () =>
        setInstanceAccess(
          { db: fakeDb({ deleteReturning: [] }), organizationId: ORG, userId: 'g' },
          RECORD_DEF,
          ResourceGranteeType.user,
          [{ granteeId: 'u_target', rung: 'read' }]
        ),
    ],
  ] as const) {
    it(`${label} on a record-def CUID busts userCapabilities`, async () => {
      await run()

      // Restore the `isInstanceAccessKey` gate at this funnel and this is the
      // assertion that fails — nothing else in the suite notices.
      expect(eventsFor('resource-access.instance.changed').map((c) => c[1])).toEqual([
        { orgId: ORG, userIds: ['u_target'] },
      ])
    })

    it(`${label} on a record-def CUID does NOT recompute governingInstanceIds`, async () => {
      await run()

      expect(eventsFor('resource-access.governing-instance.changed')).toEqual([])
    })

    it(`${label} on a record-def CUID leaves the mail lane exactly as it was`, async () => {
      await run()

      expect(eventsFor('resource-access.changed').map((c) => c[1])).toEqual([
        { orgId: ORG, userIds: ['u_target'] },
      ])
    })
  }

  it('an instance-access def still fires BOTH events, org key first', async () => {
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD, // `inbox` — an INSTANCE_ACCESS_RESOURCES key
        granteeType: ResourceGranteeType.user,
        granteeId: 'u_target',
        rung: 'read',
      }
    )

    // Order matters: the capability publish that follows sends clients back to
    // read `governingInstanceIds`, so the org key must already be fresh.
    const order = emit.mock.calls
      .map((c) => c[0])
      .filter((name) => name.startsWith('resource-access.'))
    expect(order).toEqual([
      'resource-access.changed',
      'resource-access.governing-instance.changed',
      'resource-access.instance.changed',
    ])
    expect(eventsFor('resource-access.governing-instance.changed').map((c) => c[1])).toEqual([
      { orgId: ORG },
    ])
  })

  it('an external caller naming an instance-access def recomputes the governing set', async () => {
    // The shape every caller outside the three funnels uses (dashboards, snippets,
    // signatures, inbox floors, the seeder, migrations 040/056): they all write rows
    // on instance-access resources and now name the def explicitly. The def id was
    // briefly OPTIONAL with `undefined` meaning "recompute" — but an optional
    // fail-safe is indistinguishable from a forgotten argument, so it is required
    // and this asserts the arm those callers actually take.
    await emitResourceAccessInstanceChanged(
      ORG,
      [{ granteeType: ResourceGranteeType.user, granteeId: 'u_target' }],
      'dashboard'
    )

    expect(eventsFor('resource-access.governing-instance.changed').map((c) => c[1])).toEqual([
      { orgId: ORG },
    ])
    expect(eventsFor('resource-access.instance.changed').map((c) => c[1])).toEqual([
      { orgId: ORG, userIds: ['u_target'] },
    ])
  })

  it('a restriction against an EMPTY grantee still recomputes the governing set', async () => {
    // The fail-open this guards: `governingInstanceIds` is what makes a
    // restriction bite — `effectiveInstanceLevel` treats ABSENCE from the set as
    // "unrestricted" and falls through to `instanceFallbackLevel`. A `none` row
    // written against a group with no members (or a profile nobody holds)
    // expands to zero user ids, and the per-user bail below used to sit ABOVE
    // this emit — so the row landed in the database, governed by
    // `isGoverningInstanceRow`, and the cached set never learned about it. The
    // instance stayed org-visible for the full ONE_DAY TTL, silently.
    expandGranteeToUserIds.mockResolvedValueOnce({ userIds: [], capped: false })

    await emitResourceAccessInstanceChanged(
      ORG,
      [{ granteeType: ResourceGranteeType.group, granteeId: 'g_nobody' }],
      'dashboard'
    )

    expect(eventsFor('resource-access.governing-instance.changed').map((c) => c[1])).toEqual([
      { orgId: ORG },
    ])
    // Still nothing per-user to bust — that half of the bail is correct.
    expect(eventsFor('resource-access.instance.changed')).toEqual([])
  })

  it('a broadcast audience keeps the org key at org scope, not a user fan-out', async () => {
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD,
        granteeType: ResourceGranteeType.role,
        granteeId: 'org_member',
        rung: 'read',
      }
    )

    expect(eventsFor('resource-access.governing-instance.changed').map((c) => c[1])).toEqual([
      { orgId: ORG },
    ])
    expect(eventsFor('resource-access.instance.changed').map((c) => c[1])).toEqual([
      { orgId: ORG, broadcastUserKeys: true },
    ])
  })
})

/**
 * The FOURTH ADMIN bypass (doc 19 §5.3 piece 2) — an independent
 * `['OWNER','ADMIN']` short-circuit on a code path completely separate from
 * `capability-set` / `entity-access`. Narrowing only those left this one handing
 * admins `admin` on every instance, so sharing stayed bypassed.
 */
function checkDb(role: string | undefined, grants: Array<Record<string, unknown>> = []) {
  return {
    query: {
      OrganizationMember: { findFirst: async () => (role ? { role } : undefined) },
      ResourceAccess: { findMany: async () => grants },
    },
  } as any
}

describe('checkAccess role short-circuit (doc 19 §5.3 piece 2)', () => {
  const ctx = (role: string | undefined, grants?: Array<Record<string, unknown>>) => ({
    db: checkDb(role, grants),
    organizationId: ORG,
    userId: 'u_target',
  })

  it('OWNER keeps the unconditional bypass (the §0.10 recovery guarantee)', async () => {
    await expect(
      checkAccess(ctx('OWNER'), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toEqual({
      hasAccess: true,
      rung: 'admin',
      grantedVia: 'role',
      accessLevel: 'type',
    })
  })

  it('ADMIN no longer bypasses — an ungranted instance is denied', async () => {
    await expect(
      checkAccess(ctx('ADMIN'), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toEqual({ hasAccess: false, rung: null, grantedVia: null, accessLevel: null })
  })

  it('ADMIN resolves through their own grantee union like anyone else', async () => {
    const granted = [{ rung: 'edit', entityInstanceId: 'inbox_1', granteeType: 'user' }]
    await expect(
      checkAccess(ctx('ADMIN', granted), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toMatchObject({
      hasAccess: true,
      rung: 'edit',
      accessLevel: 'instance',
    })
  })

  it('a plain USER is unaffected by the narrowing', async () => {
    await expect(
      checkAccess(ctx('USER'), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toEqual({ hasAccess: false, rung: null, grantedVia: null, accessLevel: null })
  })
})
