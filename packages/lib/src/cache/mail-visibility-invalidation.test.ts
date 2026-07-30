// packages/lib/src/cache/mail-visibility-invalidation.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §4.5 — the new dependency MUST enter the invalidation graph, and the
 * recompute must be ORDER-SAFE.
 *
 * Phase 2 makes `composeUserMailVisibility` read the member's capability blob
 * (the `Area.inboxes` fallback §4.2 + `isMailAdmin` §4.4). That creates a
 * cross-key dependency inside the user cache, with two independent ways to get it
 * wrong — one per describe block below:
 *
 *  1. **The graph edge.** `permission-profile.changed` / `permission-grant.changed`
 *     used to invalidate `userCapabilities` alone. Without `userMailVisibility`
 *     beside it, a profile downgrade leaves a stale mail blob for the full
 *     ONE_DAY TTL — the member keeps reading mail their new profile denies. This
 *     is the one stale-blob direction in the whole slice that fails OPEN.
 *  2. **The compose order.** `invalidateAndRecompute` fans keys out with
 *     `Promise.all` and gives NO ordering, so "declare them in dependency order"
 *     is not a fix. If a key can recompute while a sibling's Redis entry is still
 *     alive, the fresh mail blob pins the STALE capability blob into itself — and
 *     the graph edge above then buys nothing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. The graph edge — behavioural, through `onCacheEvent`.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  /** [userId, keys, orgId] per call. */
  userInvalidations: [] as Array<{ userId: string; keys: string[]; orgId?: string }>,
  orgInvalidations: [] as string[][],
  broadcasts: [] as string[][],
}))

vi.mock('./singletons', () => ({
  getOrgCache: () => ({
    invalidateAndRecompute: async (_org: string, keys: string[]) => {
      h.orgInvalidations.push(keys)
    },
    // `invalidateOrgUsersForKeys` reads the member list through here (block 4).
    get: async (_org: string, key: string) => (key === 'members' ? [{ userId: 'u_2' }] : []),
    flush: async () => {},
  }),
  getUserCache: () => ({
    invalidateAndRecompute: async (userId: string, keys: string[], orgId?: string) => {
      h.userInvalidations.push({ userId, keys: [...keys], orgId })
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

// The two lazy imports `onCacheEvent` reaches for when a mapping touches
// `userMailVisibility` — counts staleness and the realtime nudge. Both are
// fire-and-forget side effects, not the subject here.
vi.mock('../threads/mail-counts', () => ({
  bumpMailCountsEpoch: vi.fn(async () => {}),
  markMailCountsStale: vi.fn(async () => {}),
}))
vi.mock('../realtime', () => ({ getRealtimeService: () => ({ publish: async () => {} }) }))
vi.mock('../realtime/room-keys', () => ({
  rooms: { orgPresence: (o: string) => o, user: (u: string) => u },
}))

import { onCacheEvent } from './invalidate'

const ORG = 'org_1'
const USER = 'u_1'

beforeEach(() => {
  h.userInvalidations.length = 0
  h.orgInvalidations.length = 0
  h.broadcasts.length = 0
})

describe('§4.5 — a profile/grant change recomputes the mail blob, not just capabilities', () => {
  for (const event of ['permission-profile.changed', 'permission-grant.changed'] as const) {
    it(`${event} invalidates userMailVisibility for the targeted member`, async () => {
      await onCacheEvent(event, { orgId: ORG, userIds: [USER] })

      const call = h.userInvalidations.find((c) => c.userId === USER)
      expect(call).toBeDefined()
      // The pre-§4.5 graph had only `userCapabilities` here. Deleting
      // `'userMailVisibility'` from either mapping in `invalidation-graph.ts`
      // fails this line.
      expect(call?.keys).toContain('userMailVisibility')
      expect(call?.keys).toContain('userCapabilities')
      expect(call?.orgId).toBe(ORG)
    })

    it(`${event} takes the org-wide fan-out when the audience is a broadcast`, async () => {
      await onCacheEvent(event, { orgId: ORG, broadcastUserKeys: true })
      expect(h.broadcasts.at(-1)).toContain('userMailVisibility')
    })
  }

  it('control: an unrelated event does NOT drag userMailVisibility along', async () => {
    await onCacheEvent('member.seat-type.changed', { orgId: ORG, userIds: [USER] })
    expect(h.userInvalidations.at(-1)?.keys).toEqual(['userCapabilities'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. The compose order — a real `UserCacheService` over a fake Redis whose
//    DELETE latency is asymmetric, which is what makes the hazard observable.
// ─────────────────────────────────────────────────────────────────────────────

const fake = vi.hoisted(() => {
  const store = new Map<string, string>()
  /** Delete latency per key substring — the asymmetry that exposes interleaving. */
  const delDelay = (key: string) => (key.includes('capabilities') ? 30 : 0)
  const client = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v)
      return 'OK'
    },
    del: async (k: string) => {
      const wait = delDelay(k)
      if (wait) await new Promise((r) => setTimeout(r, wait))
      store.delete(k)
      return 1
    },
    expire: async () => 1,
    scan: async () => ['0', []] as [string, string[]],
    pipeline: () => {
      const ops: Array<() => void> = []
      const p = {
        set: (k: string, v: string) => {
          ops.push(() => store.set(k, v))
          return p
        },
        expire: () => p,
        exec: async () => {
          for (const op of ops) op()
          return []
        },
      }
      return p
    },
  }
  return { store, client }
})

vi.mock('@auxx/redis', () => ({
  getRedisClient: async () => fake.client,
}))

const { UserCacheService } = await import('./user-cache-service')

describe('§4.5 — compose order: every key is DELETED before any key recomputes', () => {
  it('a dependent provider read-throughs to the FRESH sibling, never the stale one', async () => {
    // The profile edit: the member's `inboxes` level drops Full → None.
    const level = { value: 'Full' }
    const cache = new UserCacheService({} as never)
    const anyCache = cache as unknown as {
      register: (k: string, p: { compute: (sid: string) => Promise<unknown> }) => void
      get: (u: string, k: string, o?: string) => Promise<unknown>
      invalidateAndRecompute: (u: string, k: string[], o?: string) => Promise<void>
    }

    anyCache.register('userCapabilities', {
      compute: async () => ({ keys: [level.value] }),
    })
    anyCache.register('userMailVisibility', {
      compute: async (sid: string) => {
        const [userId, orgId] = sid.split(':')
        // Exactly what `computeUserMailVisibility` does: read the sibling key
        // back through the cache.
        const caps = (await anyCache.get(userId!, 'userCapabilities', orgId)) as {
          keys: string[]
        }
        return { sawLevel: caps.keys[0] }
      },
    })

    // Seed both keys under the OLD level, then flip it — the writer has committed,
    // the caches have not.
    await anyCache.get(USER, 'userCapabilities', ORG)
    await anyCache.get(USER, 'userMailVisibility', ORG)
    level.value = 'None'

    await anyCache.invalidateAndRecompute(USER, ['userCapabilities', 'userMailVisibility'], ORG)

    const mail = (await anyCache.get(USER, 'userMailVisibility', ORG)) as { sawLevel: string }
    // Interleaving delete-with-recompute (the pre-fix shape) lets this read the
    // 30ms-slow-to-delete capability entry and observe 'Full'.
    expect(mail.sawLevel).toBe('None')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Plan 45 §3.4 — the recompute ORDER, instrumented rather than asserted.
//
//    Both orderings produce a correct blob (that is what block 2 above is for),
//    so no behavioural test can see this. What is observable is a call COUNT:
//    the dependent key composing its dependency itself, on top of the explicit
//    recompute of the same key.
// ─────────────────────────────────────────────────────────────────────────────

/** A service with both providers registered and their compute calls counted. */
function makeCountingCache() {
  const counts = { userCapabilities: 0, userMailVisibility: 0 }
  const cache = new UserCacheService({} as never)
  const anyCache = cache as unknown as {
    register: (k: string, p: { compute: (sid: string) => Promise<unknown> }) => void
    get: (u: string, k: string, o?: string) => Promise<unknown>
    invalidateAndRecompute: (u: string, k: readonly string[], o?: string) => Promise<void>
  }

  anyCache.register('userCapabilities', {
    compute: async () => {
      counts.userCapabilities++
      return { keys: ['Full'] }
    },
  })
  anyCache.register('userMailVisibility', {
    compute: async (sid: string) => {
      counts.userMailVisibility++
      const [userId, orgId] = sid.split(':')
      // `computeUserMailVisibility` reads the sibling back through the cache.
      await anyCache.get(userId!, 'userCapabilities', orgId)
      return { ok: true }
    },
  })

  return { anyCache, counts }
}

describe('§3.4 — capabilities compose ONCE per invalidation, not twice', () => {
  it('recomputes the dependency before the dependent', async () => {
    const { anyCache, counts } = makeCountingCache()

    // The six-event shape: both keys in one batch, capability blob deleted, mail
    // provider reading it back.
    await anyCache.invalidateAndRecompute(USER, ['userCapabilities', 'userMailVisibility'], ORG)

    // Was 2 before plan 45: the explicit recompute plus the mail provider's own
    // read-through miss, racing each other. Drop `USER_KEY_RECOMPUTE_TIERS` back
    // to one concurrent pass and this is the assertion that fails.
    expect(counts.userCapabilities).toBe(1)
    expect(counts.userMailVisibility).toBe(1)
  })

  it('holds when the graph declares the keys MAIL-FIRST — group.members.changed does', async () => {
    const { anyCache, counts } = makeCountingCache()

    // `invalidation-graph.ts` declares `['userMailVisibility', 'userCapabilities']`
    // for `group.deleted` and `group.members.changed`. An implementation that
    // ordered by the array it was handed would compose twice here and pass the
    // test above — which is why this case exists separately.
    await anyCache.invalidateAndRecompute(USER, ['userMailVisibility', 'userCapabilities'], ORG)

    expect(counts.userCapabilities).toBe(1)
    expect(counts.userMailVisibility).toBe(1)
  })

  it('still recomputes a key with no declared tier', async () => {
    const { anyCache, counts } = makeCountingCache()

    await anyCache.invalidateAndRecompute(USER, ['userMailVisibility'], ORG)

    // `resource-access.changed`'s shape — mail alone. The capability read is a
    // warm-blob hit in production; here it is the read-through, and the point is
    // that the mail key itself was not skipped by the tier walk.
    expect(counts.userMailVisibility).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plan 45 §3.6 — the org-wide sweep DELETES and does not recompute.
// ─────────────────────────────────────────────────────────────────────────────

describe('§3.6 — invalidateOrgUsersForKeys is delete-only', () => {
  it('deletes every member’s keys without composing a single blob', async () => {
    const { anyCache, counts } = makeCountingCache()
    const sweep = anyCache as unknown as {
      invalidateOrgUsersForKeys: (o: string, k: readonly string[]) => Promise<void>
    }

    // Seed one member so there is something to delete, then reset the counters:
    // what matters is what the SWEEP composes, not the seeding.
    await anyCache.get('u_2', 'userMailVisibility', ORG)
    counts.userCapabilities = 0
    counts.userMailVisibility = 0

    await sweep.invalidateOrgUsersForKeys(ORG, ['userCapabilities', 'userMailVisibility'])

    // THE assertion (plan 45 §1.7). Eagerly recomputing here cost a 200-member org
    // 200 concurrent composes for an answer that was unchanged for nearly all of
    // them; the delete is the half that makes the invalidation correct. Reinstate
    // `invalidateAndRecompute` in the sweep and this fails.
    expect(counts.userCapabilities).toBe(0)
    expect(counts.userMailVisibility).toBe(0)

    // And the entries really are gone — the next read composes fresh.
    await anyCache.get('u_2', 'userMailVisibility', ORG)
    expect(counts.userMailVisibility).toBe(1)
  })
})
