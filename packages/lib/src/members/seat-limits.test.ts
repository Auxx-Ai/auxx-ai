// packages/lib/src/members/seat-limits.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureLimit } from '../permissions/types'

/** Plan features the mocked FeaturePermissionService reports for the org. */
let planFeatures: Record<string, FeatureLimit> | null = null

vi.mock('../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    async getOrganizationFeatures() {
      return planFeatures ? new Map(Object.entries(planFeatures)) : null
    }
  },
}))

// member-mutations lazily imports these after a successful write; stub them so
// the cache/redis/realtime stacks stay out of the test.
vi.mock('../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getAppCache: () => ({ getOrRecompute: vi.fn(async () => ({})) }),
}))
// The overage-service delegation test imports overage-detection-service, which
// otherwise drags in the real cache singletons (register-providers → every
// provider) and the channels stack.
vi.mock('../cache/singletons', () => ({
  getAppCache: () => ({ getOrRecompute: vi.fn(async () => ({})) }),
  getOrgCache: () => ({ getOrRecompute: vi.fn(async () => ({})) }),
}))
vi.mock('../channels', () => ({ countBillableChannels: vi.fn(async () => 0) }))
vi.mock('../dehydration/cache', () => ({
  DehydrationCacheService: class {
    async invalidateUser() {}
  },
}))
vi.mock('../realtime', () => ({
  getRealtimeService: () => ({}),
  publishCapabilitiesChanged: vi.fn(async () => {}),
}))

vi.mock('./guards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./guards')>()),
  requireMemberManage: vi.fn(async () => {}),
}))

/** Membership `findMemberByUser` resolves to for the target user. */
let targetMembership: { id: string; role: string; seatType: string } | null = null

vi.mock('./member-queries', () => ({
  findMemberByUser: vi.fn(async () => targetMembership),
}))

import { updateMemberSeatType } from './member-mutations'
import { assertSeatAvailable, countSeatsUsed, seatLimitFeature } from './seat-limits'

const ORG = 'org_1'
const MEMBER = 'u_member'

type FakeMember = {
  seatType: 'full' | 'worker'
  /** Defaults to ACTIVE. */
  status?: 'ACTIVE' | 'INACTIVE'
  /** Defaults to a human. Agents get a synthetic member row (agent-service.ts:506). */
  userType?: 'USER' | 'AGENT' | 'SYSTEM'
}

type FakeRows = { members?: FakeMember[]; invitations?: { seatType: 'full' | 'worker' }[] }

/**
 * Collects the literal values bound into a drizzle `where` clause so the stub
 * can apply the *real* filters the query asked for. `schema` is proxied to `{}`
 * under vitest, so the column refs are gone — but the bound values survive as
 * plain chunks, which is enough to tell 'ACTIVE' from 'PENDING' and to detect
 * whether the query filters `userType`.
 */
function literalParams(clause: unknown): Set<unknown> {
  const found = new Set<unknown>()
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      found.add(node)
      return
    }
    if (!node || typeof node !== 'object') return
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) visit(chunk)
      return
    }
    if ('value' in node) found.add((node as { value: unknown }).value)
  }
  visit(clause)
  return found
}

/**
 * Row-backed drizzle stub. Answers the two `countSeatsUsed` count queries from
 * `rows` by applying the filters actually present in the `where` clause — so
 * dropping the `userType` filter changes the result and fails the test rather
 * than silently passing.
 */
function fakeDb(rows: FakeRows, sink: { updated: boolean } = { updated: false }): Database {
  const members = rows.members ?? []
  const invitations = rows.invitations ?? []

  const answer = (clause: unknown) => {
    const params = literalParams(clause)
    const seatType = params.has('worker') ? 'worker' : 'full'

    if (params.has('PENDING')) {
      const n = invitations.filter((i) => i.seatType === seatType).length
      return Promise.resolve([{ value: n }])
    }

    // Only apply the human filter when the query actually asked for it.
    const filtersHumans = params.has('USER')
    const n = members.filter(
      (m) =>
        m.seatType === seatType &&
        (m.status ?? 'ACTIVE') === 'ACTIVE' &&
        (!filtersHumans || (m.userType ?? 'USER') === 'USER')
    ).length
    return Promise.resolve([{ value: n }])
  }

  const source = {
    where: answer,
    innerJoin: () => ({ where: answer }),
  }

  const db = {
    select: () => ({ from: () => source }),
    update: () => ({
      set: () => ({
        where: () => {
          sink.updated = true
          return Promise.resolve([])
        },
      }),
    }),
  }
  return db as unknown as Database
}

/** `n` active human members of one seat class. */
function humans(seatType: 'full' | 'worker', n: number): FakeMember[] {
  return Array.from({ length: n }, () => ({ seatType }))
}

beforeEach(() => {
  planFeatures = { teammates: 2, workerSeats: 2 }
  targetMembership = { id: 'm_1', role: 'USER', seatType: 'worker' }
})

describe('seatLimitFeature', () => {
  it('maps a worker seat to workerSeats and a full seat to teammates', () => {
    expect(seatLimitFeature('worker')).toBe('workerSeats')
    expect(seatLimitFeature('full')).toBe('teammates')
  })
})

describe('countSeatsUsed', () => {
  it('counts only active members when pending invitations are excluded', async () => {
    const used = await countSeatsUsed(
      { organizationId: ORG, seatType: 'full', includePendingInvitations: false },
      fakeDb({ members: humans('full', 3), invitations: [{ seatType: 'full' }] })
    )
    expect(used).toBe(3)
  })

  it('adds pending invitations of the same seat class when included', async () => {
    const used = await countSeatsUsed(
      { organizationId: ORG, seatType: 'full', includePendingInvitations: true },
      fakeDb({ members: humans('full', 3), invitations: [{ seatType: 'full' }] })
    )
    expect(used).toBe(4)
  })

  it('ignores members of the other seat class', async () => {
    const used = await countSeatsUsed(
      { organizationId: ORG, seatType: 'full', includePendingInvitations: true },
      fakeDb({
        members: [...humans('full', 1), ...humans('worker', 5)],
        invitations: [{ seatType: 'worker' }],
      })
    )
    expect(used).toBe(1)
  })

  it('does NOT count an AGENT-userType member — a published agent gets a synthetic full-seat member row', async () => {
    const used = await countSeatsUsed(
      { organizationId: ORG, seatType: 'full', includePendingInvitations: false },
      fakeDb({
        members: [
          { seatType: 'full', userType: 'AGENT' },
          { seatType: 'full', userType: 'AGENT' },
          { seatType: 'full', userType: 'AGENT' },
        ],
      })
    )
    expect(used).toBe(0)
  })

  it('still counts human members alongside agents', async () => {
    const used = await countSeatsUsed(
      { organizationId: ORG, seatType: 'full', includePendingInvitations: false },
      fakeDb({
        members: [
          { seatType: 'full', userType: 'USER' },
          { seatType: 'full', userType: 'AGENT' },
          { seatType: 'full', userType: 'SYSTEM' },
        ],
      })
    )
    expect(used).toBe(1)
  })

  it('does not count INACTIVE members', async () => {
    const used = await countSeatsUsed(
      { organizationId: ORG, seatType: 'full', includePendingInvitations: false },
      fakeDb({
        members: [{ seatType: 'full' }, { seatType: 'full', status: 'INACTIVE' }],
      })
    )
    expect(used).toBe(1)
  })
})

describe('assertSeatAvailable', () => {
  it('allows when the class is under its limit', async () => {
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'full' },
        fakeDb({ members: humans('full', 1) })
      )
    ).resolves.toBeUndefined()
  })

  it('blocks at the full-seat limit with the teammates message', async () => {
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'full' },
        fakeDb({ members: humans('full', 2) })
      )
    ).rejects.toThrow(/team member limit \(2\)/)
  })

  it('blocks at the worker-seat limit with the field seat message', async () => {
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'worker' },
        fakeDb({ members: humans('worker', 2) })
      )
    ).rejects.toThrow(/field seat limit \(2\)/)
  })

  it('counts pending invitations of the same class toward the limit', async () => {
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'full' },
        fakeDb({ members: humans('full', 1), invitations: [{ seatType: 'full' }] })
      )
    ).rejects.toThrow(/team member limit \(2\)/)
  })

  it('does not let published agents consume the full-seat bundle', async () => {
    // 2 full seats, 2 humans' worth of agents + 1 human ⇒ still 1 seat free.
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'full' },
        fakeDb({
          members: [
            { seatType: 'full', userType: 'USER' },
            { seatType: 'full', userType: 'AGENT' },
            { seatType: 'full', userType: 'AGENT' },
            { seatType: 'full', userType: 'AGENT' },
          ],
        })
      )
    ).resolves.toBeUndefined()
  })

  it('treats a negative limit as unlimited', async () => {
    planFeatures = { teammates: -1, workerSeats: -1 }
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'full' },
        fakeDb({ members: humans('full', 500) })
      )
    ).resolves.toBeUndefined()
  })

  it("treats '+' as unlimited", async () => {
    planFeatures = { teammates: '+', workerSeats: '+' }
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'worker' },
        fakeDb({ members: humans('worker', 500) })
      )
    ).resolves.toBeUndefined()
  })

  it('hard-blocks a bundle of 0 up front — Demo/Free field seats must fail at invite, not at accept', async () => {
    // getLimit() collapses 0 → null, which every caller reads as "unlimited";
    // assertSeatAvailable reads the raw feature map so 0 stays a hard block.
    planFeatures = { teammates: 1, workerSeats: 0 }
    await expect(
      assertSeatAvailable({ organizationId: ORG, seatType: 'worker' }, fakeDb({}))
    ).rejects.toThrow(/field seat limit \(0\)/)
  })

  it('hard-blocks a `false` bundle', async () => {
    planFeatures = { teammates: 1, workerSeats: false }
    await expect(
      assertSeatAvailable({ organizationId: ORG, seatType: 'worker' }, fakeDb({}))
    ).rejects.toThrow(/field seat limit \(0\)/)
  })

  it('skips the check when the org has no plan features rather than failing closed', async () => {
    planFeatures = null
    await expect(
      assertSeatAvailable(
        { organizationId: ORG, seatType: 'full' },
        fakeDb({ members: humans('full', 99) })
      )
    ).resolves.toBeUndefined()
  })
})

describe('updateMemberSeatType — plan-limit gate (§4.3)', () => {
  it('blocks worker → full when the teammates bundle is exhausted', async () => {
    const sink = { updated: false }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_admin',
          memberToUpdateId: MEMBER,
          seatType: 'full',
        },
        fakeDb({ members: humans('full', 2) }, sink)
      )
    ).rejects.toThrow(/team member limit \(2\)/)
    expect(sink.updated).toBe(false)
  })

  it('allows worker → full while a full seat remains, without double-counting the mover', async () => {
    // 1 of 2 full seats used. The member being moved still holds a *worker*
    // seat, so they are absent from the full-seat count and 1 < 2 passes.
    const sink = { updated: false }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_admin',
          memberToUpdateId: MEMBER,
          seatType: 'full',
        },
        fakeDb({ members: [...humans('full', 1), ...humans('worker', 4)] }, sink)
      )
    ).resolves.toEqual({ success: true })
    expect(sink.updated).toBe(true)
  })

  it('is not blocked by published agents holding synthetic full-seat member rows', async () => {
    const sink = { updated: false }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_admin',
          memberToUpdateId: MEMBER,
          seatType: 'full',
        },
        fakeDb(
          {
            members: [
              { seatType: 'full', userType: 'USER' },
              { seatType: 'full', userType: 'AGENT' },
              { seatType: 'full', userType: 'AGENT' },
              { seatType: 'full', userType: 'AGENT' },
            ],
          },
          sink
        )
      )
    ).resolves.toEqual({ success: true })
    expect(sink.updated).toBe(true)
  })

  it('blocks full → worker when the field seat bundle is exhausted', async () => {
    targetMembership = { id: 'm_1', role: 'USER', seatType: 'full' }
    const sink = { updated: false }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_admin',
          memberToUpdateId: MEMBER,
          seatType: 'worker',
        },
        fakeDb({ members: humans('worker', 2) }, sink)
      )
    ).rejects.toThrow(/field seat limit \(2\)/)
    expect(sink.updated).toBe(false)
  })

  it('checks the destination class only — full → worker ignores an exhausted teammates bundle', async () => {
    planFeatures = { teammates: 0, workerSeats: 5 }
    targetMembership = { id: 'm_1', role: 'USER', seatType: 'full' }
    const sink = { updated: false }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_admin',
          memberToUpdateId: MEMBER,
          seatType: 'worker',
        },
        fakeDb({ members: [...humans('full', 3), ...humans('worker', 1)] }, sink)
      )
    ).resolves.toEqual({ success: true })
    expect(sink.updated).toBe(true)
  })

  it('does not run the cap check on the no-op branch, even at cap', async () => {
    targetMembership = { id: 'm_1', role: 'USER', seatType: 'full' }
    const sink = { updated: false }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_admin',
          memberToUpdateId: MEMBER,
          seatType: 'full',
        },
        fakeDb({ members: humans('full', 2) }, sink)
      )
    ).resolves.toEqual({ success: true })
    expect(sink.updated).toBe(false)
  })

  it('still enforces the field-seat role invariant before the cap check', async () => {
    targetMembership = { id: 'm_1', role: 'ADMIN', seatType: 'full' }
    await expect(
      updateMemberSeatType(
        {
          organizationId: ORG,
          updaterUserId: 'u_owner',
          memberToUpdateId: MEMBER,
          seatType: 'worker',
        },
        fakeDb({})
      )
    ).rejects.toThrow(/Member role can be moved to a field seat/)
  })
})

describe('OverageDetectionService seat counts delegate to countSeatsUsed', () => {
  /**
   * The billing/overage count and the invite/seat-change gate must report the
   * same number for the same org, or an admin sees "2/2 seats" while the gate
   * refuses at 5.
   */
  it('reports the same full-seat count as the gate, excluding agents', async () => {
    const rows: FakeRows = {
      members: [
        { seatType: 'full', userType: 'USER' },
        { seatType: 'full', userType: 'USER' },
        { seatType: 'full', userType: 'AGENT' },
        { seatType: 'worker', userType: 'USER' },
      ],
    }

    const { OverageDetectionService } = await import('../permissions/overage-detection-service')
    const { FeatureKey } = await import('../permissions/types')
    const service = new OverageDetectionService(fakeDb(rows)) as unknown as {
      getResourceCount(orgId: string, key: string): Promise<number>
    }

    await expect(service.getResourceCount(ORG, FeatureKey.teammates)).resolves.toBe(2)
    await expect(service.getResourceCount(ORG, FeatureKey.workerSeats)).resolves.toBe(1)

    // Same numbers the enforcement path sees.
    await expect(
      countSeatsUsed(
        { organizationId: ORG, seatType: 'full', includePendingInvitations: false },
        fakeDb(rows)
      )
    ).resolves.toBe(2)
  })
})
