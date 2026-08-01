// packages/lib/src/ai/agent-framework/__tests__/agent-run-capabilities.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityView } from '../../../permissions/capabilities/capability-view'
import { Level } from '../../../permissions/capabilities/registry'

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

// The org `resources` cache only feeds the def→apiSlug resolvers; an empty list
// makes every def form pass through unchanged, which keeps these tests about the
// INTERSECTION CHAIN rather than about slug resolution (covered separately in
// `agent-policy-capabilities.test.ts`).
vi.mock('../../../cache', () => ({
  getCachedResources: async () => [],
  getCachedPermissionProfiles: async () => draftProfiles,
}))

let draftProfiles: Array<Record<string, unknown>> = []

import { AgentRunAsUnavailableError, resolveAgentRunCapabilities } from '../agent-run-capabilities'

/** Minimal CapabilityView stub — only the gates these tests exercise are real. */
function fakeCaps(viewable: string[]): CapabilityView {
  const set = new Set(viewable)
  return {
    can: (k) => set.has(k),
    has: (k) => set.has(k),
    assert: () => {},
    areaLevel: () => Level.Full,
    canWriteEntity: (id) => set.has(id),
    assertWriteEntity: () => {},
    canEditEntity: (id) => set.has(id),
    assertEditEntity: () => {},
    filterEditableDefIds: (ids) => ids.filter((id) => set.has(id)),
    canViewEntity: (id) => set.has(id),
    assertViewEntity: () => {},
    filterViewableDefIds: (ids) => ids.filter((id) => set.has(id)),
    // Record-level ladder: this fake has no per-record ResourceAccess grants,
    // so def presence tracks `viewable` and every rung derives from it. No case
    // below calls these — they exist so the stub cannot drift off the interface.
    hasDefPresence: (id) => set.has(id),
    hasRecordGrantsOn: () => false,
    recordDefRung: (id) => (set.has(id) ? 'read' : undefined),
    recordAccessAt: (id) => (set.has(id) ? 'read' : 'none'),
    canDeleteRecordAt: () => false,
    canEditRecordAt: () => false,
    viewAccessFor: () => undefined,
    canAdministerDef: () => false,
    canViewInstance: (_k, id) => set.has(id),
    canEditInstance: (_k, id) => set.has(id),
    canAdminInstance: () => false,
    assertAdministerDef: () => {},
    assertViewInstance: () => {},
    assertEditInstance: () => {},
    assertAdminInstance: () => {},
  }
}

/** A published snapshot whose `definitions` map names exactly these defs. */
function policy(defs: Record<string, 'none' | 'view' | 'edit' | 'admin'>) {
  return {
    sourceProfileId: 'p-agent',
    sourceProfileUpdatedAt: null,
    publishedByUserId: 'u-admin',
    clamp: [],
    areas: { default: 'admin', overrides: {} },
    definitions: { default: 'none', overrides: defs },
    resources: {},
  } satisfies PublishedAgentPermissionPolicy
}

const ORG = 'org-1'

beforeEach(() => {
  members.length = 0
  capsByUser.clear()
  draftProfiles = []
  getCapabilitiesSpy.mockClear()
})

describe('resolveAgentRunCapabilities — the published policy is the agent authority', () => {
  it('returns undefined when the agent has no backing user (pre-setup draft)', async () => {
    const caps = await resolveAgentRunCapabilities({
      agent: { userId: null, runAsUserId: null },
      organizationId: ORG,
    })
    expect(caps).toBeUndefined()
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })

  it('enforces the version snapshot and NEVER resolves the agent user’s own capabilities', async () => {
    const caps = await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: null,
        permissionPolicy: policy({ 'def-a': 'view' }),
      },
      organizationId: ORG,
    })

    expect(caps?.canViewEntity('def-a')).toBe(true)
    expect(caps?.canEditEntity('def-a')).toBe(false)
    expect(caps?.canViewEntity('def-b')).toBe(false)
    // The whole point of doc 19 §0.16: the synthetic member is not an authority,
    // so its composed blob is never even read.
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })

  it('fails CLOSED for a set-up agent with no resolvable policy', async () => {
    const caps = await resolveAgentRunCapabilities({
      agent: { userId: 'agent-user', runAsUserId: null, permissionPolicy: null },
      organizationId: ORG,
    })
    // Not `undefined` — that would read as "unrestricted" at every construction site.
    expect(caps).toBeDefined()
    expect(caps?.canViewEntity('def-a')).toBe(false)
    expect(caps?.canEditEntity('def-a')).toBe(false)
  })
})

describe('run-as is delegation, never replacement (§0.15)', () => {
  beforeEach(() => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'OWNER', user: { userType: 'USER' } })
  })

  it('an OWNER run-as cannot widen a definition the agent published as none', async () => {
    // The delegate can see everything.
    capsByUser.set('human-1', fakeCaps(['def-a', 'def-b']))

    const caps = await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: 'human-1',
        permissionPolicy: policy({ 'def-a': 'none', 'def-b': 'view' }),
      },
      organizationId: ORG,
    })

    // This is the doc-14 §0.6 behavior change: run-as used to REPLACE the source,
    // so an owner delegate would have granted `def-a`. It now intersects.
    expect(caps?.canViewEntity('def-a')).toBe(false)
    expect(caps?.canViewEntity('def-b')).toBe(true)
    expect(getCapabilitiesSpy).toHaveBeenCalledWith('human-1', ORG)
  })

  it('run-as still NARROWS — the delegate is a real bound too', async () => {
    capsByUser.set('human-1', fakeCaps(['def-a']))

    const caps = await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: 'human-1',
        permissionPolicy: policy({ 'def-a': 'view', 'def-b': 'view' }),
      },
      organizationId: ORG,
    })

    expect(caps?.canViewEntity('def-a')).toBe(true)
    // Published `read`, but the delegate cannot see it.
    expect(caps?.canViewEntity('def-b')).toBe(false)
  })

  it('throws when the run-as user is not a member at all', async () => {
    await expect(
      resolveAgentRunCapabilities({
        agent: {
          userId: 'agent-user',
          runAsUserId: 'ghost',
          id: 'ag_1',
          name: 'Triage Bot',
          permissionPolicy: policy({}),
        },
        organizationId: ORG,
      })
    ).rejects.toBeInstanceOf(AgentRunAsUnavailableError)
  })

  it('throws when the run-as member is inactive — never falls back to a wider view', async () => {
    members.length = 0
    members.push({
      userId: 'human-1',
      status: 'DEACTIVATED',
      role: 'USER',
      user: { userType: 'USER' },
    })

    const promise = resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: 'human-1',
        name: 'Triage Bot',
        permissionPolicy: policy({ 'def-a': 'view' }),
      },
      organizationId: ORG,
    })

    await expect(promise).rejects.toBeInstanceOf(AgentRunAsUnavailableError)
    await expect(promise).rejects.toThrow(/Triage Bot/)
  })

  it('throws when the run-as user is not human (agent/system principal)', async () => {
    members.length = 0
    members.push({ userId: 'bot-2', status: 'ACTIVE', role: 'USER', user: { userType: 'AGENT' } })

    await expect(
      resolveAgentRunCapabilities({
        agent: { userId: 'agent-user', runAsUserId: 'bot-2', permissionPolicy: policy({}) },
        organizationId: ORG,
      })
    ).rejects.toBeInstanceOf(AgentRunAsUnavailableError)
  })
})

describe('invoker intersection (§0.5)', () => {
  it('intersects the published policy with the invoking human', async () => {
    capsByUser.set('human-1', fakeCaps(['def-b', 'def-c']))

    const caps = await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: null,
        permissionPolicy: policy({ 'def-a': 'view', 'def-b': 'view' }),
      },
      organizationId: ORG,
      invokerUserId: 'human-1',
    })

    // `def-a`: published but the invoker can't see it. `def-c`: invoker can see
    // it but it was never published. Only the overlap survives.
    expect(caps?.canViewEntity('def-a')).toBe(false)
    expect(caps?.canViewEntity('def-b')).toBe(true)
    expect(caps?.canViewEntity('def-c')).toBe(false)
    expect(caps?.filterViewableDefIds(['def-a', 'def-b', 'def-c'])).toEqual(['def-b'])
  })

  it('applies BOTH bounds when run-as and an invoker are present', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('human-1', fakeCaps(['def-a', 'def-b']))
    capsByUser.set('human-2', fakeCaps(['def-a']))

    const caps = await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: 'human-1',
        permissionPolicy: policy({ 'def-a': 'view', 'def-b': 'view', 'def-c': 'view' }),
      },
      organizationId: ORG,
      invokerUserId: 'human-2',
    })

    expect(caps?.canViewEntity('def-a')).toBe(true)
    // Published + delegate hold it, but the invoker does not.
    expect(caps?.canViewEntity('def-b')).toBe(false)
    // Published only.
    expect(caps?.canViewEntity('def-c')).toBe(false)
  })

  it('does not double-resolve when the invoker IS the run-as delegate', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('human-1', fakeCaps(['def-a']))

    await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: 'human-1',
        permissionPolicy: policy({ 'def-a': 'view' }),
      },
      organizationId: ORG,
      invokerUserId: 'human-1',
    })

    expect(getCapabilitiesSpy).toHaveBeenCalledTimes(1)
  })

  it('an autonomous run uses the published policy alone', async () => {
    const caps = await resolveAgentRunCapabilities({
      agent: {
        userId: 'agent-user',
        runAsUserId: null,
        permissionPolicy: policy({ 'def-a': 'view' }),
      },
      organizationId: ORG,
      invokerUserId: null,
    })

    expect(caps?.canViewEntity('def-a')).toBe(true)
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })
})

describe("source: 'draft' resolves the live binding, 'active' the snapshot (§15)", () => {
  const agent = {
    userId: 'agent-user',
    runAsUserId: null,
    id: 'ag-1',
    kind: 'internal' as const,
    permissionProfileId: 'p-draft',
    // The ACTIVE snapshot says read on def-a.
    permissionPolicy: policy({ 'def-a': 'view' }),
  }

  beforeEach(() => {
    // …while the DRAFT profile says edit on def-a and nothing else.
    draftProfiles = [
      {
        id: 'p-draft',
        slug: 'custom',
        name: 'Custom',
        description: null,
        icon: null,
        seat: 'admin',
        appliesTo: 'agent',
        baseLevel: null,
        ceiling: null,
        isSystem: false,
        updatedAt: null,
        agentPolicy: {
          areas: { default: 'admin', overrides: {} },
          definitions: { default: 'none', overrides: { 'def-a': 'edit' } },
          resources: {},
        },
      },
    ]
  })

  it("defaults to 'active' — production never reads the mutable draft binding", async () => {
    const caps = await resolveAgentRunCapabilities({ agent, organizationId: ORG })
    expect(caps?.canViewEntity('def-a')).toBe(true)
    expect(caps?.canEditEntity('def-a')).toBe(false)
  })

  it("source: 'draft' enforces the draft profile instead", async () => {
    const caps = await resolveAgentRunCapabilities({ agent, organizationId: ORG, source: 'draft' })
    expect(caps?.canEditEntity('def-a')).toBe(true)
  })
})
