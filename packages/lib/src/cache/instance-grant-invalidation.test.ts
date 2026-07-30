// packages/lib/src/cache/instance-grant-invalidation.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan v3/03 §9 (P2) — the event partition had a hole.
 *
 * `resource-access.instance.changed` used to carry BOTH halves of the instance
 * lane (`userCapabilities` + `governingInstanceIds`) and was emitted only when the
 * target's def id was an `INSTANCE_ACCESS_RESOURCES` key — which a record-def CUID
 * can never be. A record share therefore fired the mail invalidation alone and
 * left the capability blob (where §4's `grantedDefIds` front door lives) stale for
 * the full ONE_DAY TTL on the very first share.
 *
 * The split asserted here: the capability half is DEF-AGNOSTIC, the org-wide
 * `governingInstanceIds` half keeps its keyspace gate as its own event (the
 * provider filters `entityDefinitionId IN INSTANCE_ACCESS_KEYS` in SQL and again
 * through `isGoverningInstanceRow` in JS, so a record CUID provably cannot enter
 * that set — recomputing it would be an org-wide query with an unchanged answer).
 *
 * The emit-site half of the same phase — which def ids reach which event — lives in
 * `../resource-access/resource-access-service.test.ts`.
 */

const h = vi.hoisted(() => ({
  userInvalidations: [] as Array<{ userId: string; keys: string[] }>,
  orgInvalidations: [] as string[][],
  broadcasts: [] as string[][],
}))

vi.mock('./singletons', () => ({
  getOrgCache: () => ({
    invalidateAndRecompute: async (_org: string, keys: string[]) => {
      h.orgInvalidations.push([...keys])
    },
    get: async () => [],
    flush: async () => {},
  }),
  getUserCache: () => ({
    invalidateAndRecompute: async (userId: string, keys: string[]) => {
      h.userInvalidations.push({ userId, keys: [...keys] })
    },
    invalidateOrgUsersForKeys: async (_org: string, keys: string[]) => {
      h.broadcasts.push([...keys])
    },
  }),
  getBuildUserCache: () => ({
    invalidateAllMembers: async () => {},
    invalidateAndRecompute: async () => {},
  }),
  getAppCache: () => ({ invalidateAndRecompute: async () => {} }),
}))

const mailCounts = vi.hoisted(() => ({
  bumpMailCountsEpoch: vi.fn(async () => {}),
  markMailCountsStale: vi.fn(async () => {}),
}))
vi.mock('../threads/mail-counts', () => mailCounts)

const publish = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../realtime', () => ({ getRealtimeService: () => ({ publish }) }))
vi.mock('../realtime/room-keys', () => ({
  rooms: { orgPresence: (o: string) => o, user: (u: string) => u },
}))

import { onCacheEvent } from './invalidate'
import { INVALIDATION_GRAPH, isMixedMapping } from './invalidation-graph'

const ORG = 'org_1'
const USER = 'u_1'

beforeEach(() => {
  h.userInvalidations.length = 0
  h.orgInvalidations.length = 0
  h.broadcasts.length = 0
  mailCounts.bumpMailCountsEpoch.mockClear()
  mailCounts.markMailCountsStale.mockClear()
  publish.mockClear()
})

describe('§9 — the instance-grant event busts the capability blob for ANY def keyspace', () => {
  it('resource-access.instance.changed invalidates userCapabilities for the targeted member', async () => {
    await onCacheEvent('resource-access.instance.changed', { orgId: ORG, userIds: [USER] })

    expect(h.userInvalidations).toEqual([{ userId: USER, keys: ['userCapabilities'] }])
  })

  it('and does NOT drag the org-wide governingInstanceIds recompute along', async () => {
    await onCacheEvent('resource-access.instance.changed', { orgId: ORG, userIds: [USER] })

    // THE split. Put `governingInstanceIds` back on this mapping and every record
    // share (and every thread share) pays for an org-wide query whose answer the
    // provider's `IN (INSTANCE_ACCESS_KEYS)` filter guarantees is unchanged.
    expect(h.orgInvalidations).toEqual([])
  })

  it('takes the org-wide user fan-out when the audience is a broadcast', async () => {
    await onCacheEvent('resource-access.instance.changed', { orgId: ORG, broadcastUserKeys: true })

    expect(h.broadcasts).toEqual([['userCapabilities']])
    expect(h.orgInvalidations).toEqual([])
  })

  it('resource-access.governing-instance.changed carries the org key, and only it', async () => {
    await onCacheEvent('resource-access.governing-instance.changed', { orgId: ORG })

    expect(h.orgInvalidations).toEqual([['governingInstanceIds']])
    expect(h.userInvalidations).toEqual([])
    expect(h.broadcasts).toEqual([])
  })

  it('neither instance event touches the mail lane — no counts staleness, no nudge', async () => {
    await onCacheEvent('resource-access.instance.changed', { orgId: ORG, userIds: [USER] })
    await onCacheEvent('resource-access.governing-instance.changed', { orgId: ORG })

    // `touchesInstanceGrants` is derived purely from the mapping containing
    // `userInstanceGrants`, and drives both the counts epoch/staleness and the
    // `visibility:changed` realtime nudge.
    expect(mailCounts.markMailCountsStale).not.toHaveBeenCalled()
    expect(mailCounts.bumpMailCountsEpoch).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('§9 — the mail lane is untouched by the split', () => {
  it('resource-access.changed still invalidates exactly userInstanceGrants + mailGrantIndex', async () => {
    await onCacheEvent('resource-access.changed', { orgId: ORG, userIds: [USER] })

    expect(h.orgInvalidations).toEqual([['mailGrantIndex']])
    expect(h.userInvalidations).toEqual([{ userId: USER, keys: ['userInstanceGrants'] }])
  })

  it('and still marks mail counts stale + publishes visibility:changed', async () => {
    await onCacheEvent('resource-access.changed', { orgId: ORG, userIds: [USER] })

    expect(mailCounts.markMailCountsStale).toHaveBeenCalledWith(ORG, [USER])
    // The nudge is fire-and-forget behind two lazy imports, so it settles some
    // ticks after `onCacheEvent` resolves.
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith(USER, 'visibility:changed', { organizationId: ORG })
    )
  })

  it('the graph mapping itself is byte-identical to the pre-§9 shape', () => {
    const mapping = INVALIDATION_GRAPH['resource-access.changed']
    expect(mapping && isMixedMapping(mapping) ? mapping : null).toEqual({
      user: ['userInstanceGrants'],
      org: ['mailGrantIndex'],
    })
  })

  it('the type-level lane is untouched too', () => {
    const mapping = INVALIDATION_GRAPH['resource-access.type.changed']
    expect(mapping && isMixedMapping(mapping) ? mapping : null).toEqual({
      user: ['userCapabilities'],
      org: ['restrictedEntityDefIds'],
    })
  })
})
