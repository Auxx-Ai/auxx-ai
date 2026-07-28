// packages/lib/src/actors/__tests__/expand-to-users-agent-visibility.test.ts

import type { ActorContext, ActorId } from '@auxx/types/actor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `expandToUsers`' `canSeeAgent` predicate — per-agent instance access (plan 25
 * §4.2) applied where it actually belongs.
 *
 * **The point of these tests is the THREE DOORS.** An agent reaches the output
 * of `expandToUsers` by three different routes and only one of them is visible
 * in the `actorIds` the caller passes:
 *
 *  1. `agent:<id>` — the obvious spelling.
 *  2. `user:<backingUserId>` — the legacy spelling this method deliberately
 *     reroutes through the agent rules.
 *  3. group membership — a group the caller may see can contain an agent they
 *     may not, and the expansion happens inside the loop.
 *
 * A caller that filtered its own input array would close (1) and look complete.
 * Each door gets a test that fails if only the other two are closed.
 *
 * The fourth case is the one that makes the predicate safe to add at all:
 * omitting it must leave system paths (trigger routing, notification fan-out,
 * which run with no invoking user) completely unclamped.
 */

const { getCachedAgents, getCachedAgentsByUserIds, getMembers, getGroupsForUser } = vi.hoisted(
  () => ({
    getCachedAgents: vi.fn(),
    getCachedAgentsByUserIds: vi.fn(),
    getMembers: vi.fn(async () => []),
    getGroupsForUser: vi.fn(async () => []),
  })
)

vi.mock('../../cache', () => ({ getCachedAgents, getCachedAgentsByUserIds }))
vi.mock('../../groups/group-functions', () => ({ getMembers, getGroupsForUser }))

const { GroupMemberService } = await import('../group-member-service')

const ORG_ID = 'org_cuid000000000000000000000'
const HUMAN_ID = 'usr_human00000000000000000000'

/** Visible to the caller. */
const SEEN_AGENT = { id: 'agt_seen0000000000000000000', userId: 'usr_seen0000000000000000000' }
/** Restricted from the caller — must not surface through ANY door. */
const HIDDEN_AGENT = { id: 'agt_hidden00000000000000000', userId: 'usr_hidden00000000000000000' }

const ctx = { organizationId: ORG_ID, userId: HUMAN_ID } as unknown as ActorContext

/** Only {@link SEEN_AGENT} is visible. */
const canSeeAgent = (agentId: string) => agentId === SEEN_AGENT.id

function service() {
  return new GroupMemberService(ctx)
}

beforeEach(() => {
  getCachedAgents.mockReset().mockResolvedValue([SEEN_AGENT, HIDDEN_AGENT])
  getCachedAgentsByUserIds.mockReset().mockResolvedValue([])
  getMembers.mockReset().mockResolvedValue([])
})

describe('expandToUsers — door 1: the `agent:<id>` spelling', () => {
  it('resolves a visible agent and drops a hidden one', async () => {
    const out = await service().expandToUsers(
      [`agent:${SEEN_AGENT.id}`, `agent:${HIDDEN_AGENT.id}`] as ActorId[],
      { includeAgents: true, canSeeAgent }
    )
    expect(out).toEqual([SEEN_AGENT.userId])
  })
})

describe('expandToUsers — door 2: the legacy `user:<backingUserId>` spelling', () => {
  it('drops a hidden agent addressed by its backing user id', async () => {
    // The door a caller-side filter on `actorIds` cannot see: nothing in this
    // input says "agent". If the hidden agent's user id came back here it would
    // be indistinguishable from a genuine human in the result.
    const out = await service().expandToUsers([`user:${HIDDEN_AGENT.userId}`] as ActorId[], {
      includeAgents: true,
      canSeeAgent,
    })
    expect(out).toEqual([])
  })

  it('still resolves a VISIBLE agent addressed the legacy way', async () => {
    const out = await service().expandToUsers([`user:${SEEN_AGENT.userId}`] as ActorId[], {
      includeAgents: true,
      canSeeAgent,
    })
    expect(out).toEqual([SEEN_AGENT.userId])
  })

  it('never mistakes a genuine human for an agent', async () => {
    // The failure mode of getting the two sets backwards: a real user id is in
    // neither agent set and must always pass through.
    const out = await service().expandToUsers([`user:${HUMAN_ID}`] as ActorId[], {
      includeAgents: true,
      canSeeAgent,
    })
    expect(out).toEqual([HUMAN_ID])
  })
})

describe('expandToUsers — door 3: group membership', () => {
  /**
   * Group rows store EVERY member as `memberType: 'user'` + `memberRefId`; an
   * agent member is only recognizable by its backing user id matching an agent.
   * `getAgentActors` re-spells those as `agent:<id>` and `getUserActors` drops
   * them from the user half, so by the time the expansion loop sees them they
   * are on the `agent:` branch.
   *
   * **Which arm this test actually pins:** the `agentById` visibility filter,
   * not the group loop's `addUserActor` call. Mutating that call to a bare
   * `userIds.add` leaves this green, because the pre-split means it never sees
   * an agent-backed id — documented at the call site too. What DOES kill this
   * test is building `agentById` from all agents instead of the visible ones.
   */
  it('drops a hidden agent reached through a group the caller CAN see', async () => {
    getMembers.mockResolvedValue([
      { memberType: 'user', memberRefId: HUMAN_ID, user: { id: HUMAN_ID } },
      { memberType: 'user', memberRefId: SEEN_AGENT.userId, user: { id: SEEN_AGENT.userId } },
      { memberType: 'user', memberRefId: HIDDEN_AGENT.userId, user: { id: HIDDEN_AGENT.userId } },
    ] as never)
    getCachedAgentsByUserIds.mockResolvedValue([SEEN_AGENT, HIDDEN_AGENT] as never)

    const out = await service().expandToUsers(['group:grp_1'] as ActorId[], {
      includeAgents: true,
      canSeeAgent,
    })
    expect(out.sort()).toEqual([HUMAN_ID, SEEN_AGENT.userId].sort())
    expect(out).not.toContain(HIDDEN_AGENT.userId)
  })
})

describe('expandToUsers — omitting the predicate leaves system paths unclamped', () => {
  it('resolves every agent when no `canSeeAgent` is supplied', async () => {
    // Trigger routing and notification fan-out have no invoking user, so they
    // must not inherit anyone's visibility. If this ever starts filtering,
    // headless agent runs silently stop reaching their targets.
    const out = await service().expandToUsers(
      [`agent:${SEEN_AGENT.id}`, `agent:${HIDDEN_AGENT.id}`] as ActorId[],
      { includeAgents: true }
    )
    expect(out.sort()).toEqual([SEEN_AGENT.userId, HIDDEN_AGENT.userId].sort())
  })

  it('still excludes agents entirely when includeAgents is false', async () => {
    const out = await service().expandToUsers(
      [`user:${HUMAN_ID}`, `agent:${SEEN_AGENT.id}`, `user:${SEEN_AGENT.userId}`] as ActorId[],
      {}
    )
    expect(out).toEqual([HUMAN_ID])
  })
})
