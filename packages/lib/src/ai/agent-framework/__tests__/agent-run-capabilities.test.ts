// packages/lib/src/ai/agent-framework/__tests__/agent-run-capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityView } from '../../../permissions/capabilities/capability-view'

interface FakeMember {
  userId: string
  status: string
  role: string
  user: { userType: string } | null
}

const members: FakeMember[] = []
vi.mock('../../../cache/org-cache-helpers', () => ({
  getCachedMembers: async () => members,
}))

const capsByUser = new Map<string, CapabilityView>()
const getCapabilitiesSpy = vi.fn(async (userId: string, _orgId: string) => {
  const hit = capsByUser.get(userId)
  if (!hit) throw new Error(`no fake capabilities registered for ${userId}`)
  return hit
})
vi.mock('../../../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: (userId: string, orgId: string) => getCapabilitiesSpy(userId, orgId),
}))

import { AgentRunAsUnavailableError, resolveAgentRunCapabilities } from '../agent-run-capabilities'

/** Minimal CapabilityView stub — only the gates these tests exercise are real. */
function fakeCaps(viewable: string[]): CapabilityView {
  const set = new Set(viewable)
  return {
    can: (k) => set.has(k),
    has: (k) => set.has(k),
    assert: () => {},
    canWriteEntity: (id) => set.has(id),
    assertWriteEntity: () => {},
    canEditEntity: (id) => set.has(id),
    assertEditEntity: () => {},
    filterEditableDefIds: (ids) => ids.filter((id) => set.has(id)),
    canViewEntity: (id) => set.has(id),
    assertViewEntity: () => {},
    filterViewableDefIds: (ids) => ids.filter((id) => set.has(id)),
    viewAccessFor: () => undefined,
    canAdministerDef: () => false,
    assertAdministerDef: () => {},
    canViewInstance: (_k, id) => set.has(id),
    canEditInstance: (_k, id) => set.has(id),
    canAdminInstance: () => false,
    assertViewInstance: () => {},
    assertEditInstance: () => {},
    assertAdminInstance: () => {},
  } as CapabilityView
}

const ORG = 'org-1'

beforeEach(() => {
  members.length = 0
  capsByUser.clear()
  getCapabilitiesSpy.mockClear()
})

describe('resolveAgentRunCapabilities', () => {
  it('returns undefined when the agent has no backing user (pre-setup draft)', async () => {
    const caps = await resolveAgentRunCapabilities({
      agent: { userId: null, runAsUserId: null },
      organizationId: ORG,
    })
    expect(caps).toBeUndefined()
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })

  it('resolves the agent profile when no run-as is set', async () => {
    const agentCaps = fakeCaps(['def-a'])
    capsByUser.set('agent-user', agentCaps)

    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: null },
      organizationId: ORG,
    })

    expect(caps).toBe(agentCaps)
    expect(getCapabilitiesSpy).toHaveBeenCalledWith('agent-user', ORG)
  })

  it('resolves the delegate when run-as points at an ACTIVE human member', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    const delegateCaps = fakeCaps(['def-a', 'def-b'])
    capsByUser.set('human-1', delegateCaps)
    capsByUser.set('agent-user', fakeCaps([]))

    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: 'human-1' },
      organizationId: ORG,
    })

    expect(caps).toBe(delegateCaps)
    // The agent's own profile is never resolved when run-as is set.
    expect(getCapabilitiesSpy).toHaveBeenCalledTimes(1)
    expect(getCapabilitiesSpy).toHaveBeenCalledWith('human-1', ORG)
  })

  it('throws when the run-as user is not a member at all', async () => {
    capsByUser.set('agent-user', fakeCaps(['def-a']))

    await expect(
      resolveAgentRunCapabilities({
        agent: { userId: 'agent-user', runAsUserId: 'ghost', id: 'ag_1', name: 'Triage Bot' },
        organizationId: ORG,
      })
    ).rejects.toBeInstanceOf(AgentRunAsUnavailableError)
  })

  it('throws when the run-as member is inactive — never falls back to the agent profile', async () => {
    members.push({
      userId: 'human-1',
      status: 'DEACTIVATED',
      role: 'USER',
      user: { userType: 'USER' },
    })
    capsByUser.set('agent-user', fakeCaps(['def-a']))
    capsByUser.set('human-1', fakeCaps([]))

    const promise = resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: 'human-1', name: 'Triage Bot' },
      organizationId: ORG,
    })

    await expect(promise).rejects.toBeInstanceOf(AgentRunAsUnavailableError)
    await expect(promise).rejects.toThrow(/Triage Bot/)
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })

  it('throws when the run-as user is not human (agent/system principal)', async () => {
    members.push({ userId: 'bot-2', status: 'ACTIVE', role: 'USER', user: { userType: 'AGENT' } })
    capsByUser.set('agent-user', fakeCaps(['def-a']))
    capsByUser.set('bot-2', fakeCaps(['def-a', 'def-b']))

    await expect(
      resolveAgentRunCapabilities({
        agent: { userId: 'agent-user', runAsUserId: 'bot-2' },
        organizationId: ORG,
      })
    ).rejects.toBeInstanceOf(AgentRunAsUnavailableError)
  })

  it('intersects with the invoker when a human triggered the run', async () => {
    capsByUser.set('agent-user', fakeCaps(['def-a', 'def-b']))
    capsByUser.set('human-1', fakeCaps(['def-b', 'def-c']))

    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: null },
      organizationId: ORG,
      invokerUserId: 'human-1',
    })

    expect(caps?.canViewEntity('def-a')).toBe(false)
    expect(caps?.canViewEntity('def-b')).toBe(true)
    expect(caps?.canViewEntity('def-c')).toBe(false)
    expect(caps?.filterViewableDefIds(['def-a', 'def-b', 'def-c'])).toEqual(['def-b'])
  })

  it('intersects the DELEGATE (not the agent) with the invoker when run-as is set', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('agent-user', fakeCaps(['def-a', 'def-b', 'def-c']))
    capsByUser.set('human-1', fakeCaps(['def-a']))
    capsByUser.set('human-2', fakeCaps(['def-a', 'def-b']))

    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: 'human-1' },
      organizationId: ORG,
      invokerUserId: 'human-2',
    })

    expect(caps?.canViewEntity('def-a')).toBe(true)
    expect(caps?.canViewEntity('def-b')).toBe(false)
  })

  it('short-circuits (no wrapper) when the invoker IS the capability source', async () => {
    const agentCaps = fakeCaps(['def-a'])
    capsByUser.set('agent-user', agentCaps)

    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: null },
      organizationId: ORG,
      invokerUserId: 'agent-user',
    })

    expect(caps).toBe(agentCaps)
    expect(getCapabilitiesSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores a null invoker (autonomous run) — agent profile alone', async () => {
    const agentCaps = fakeCaps(['def-a'])
    capsByUser.set('agent-user', agentCaps)

    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: null },
      organizationId: ORG,
      invokerUserId: null,
    })

    expect(caps).toBe(agentCaps)
    expect(getCapabilitiesSpy).toHaveBeenCalledTimes(1)
  })
})
