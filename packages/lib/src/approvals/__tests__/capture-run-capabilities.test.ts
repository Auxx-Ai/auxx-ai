// packages/lib/src/approvals/__tests__/capture-run-capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolDeps } from '../../ai/kopilot/capabilities/types'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { emptyAgentPolicy } from '../../permissions/profiles/agent-policy'
import { AgentPolicyCapabilities } from '../../permissions/profiles/agent-policy-capabilities'
import { Result } from '../../result'

interface FakeMember {
  userId: string
  status: string
  role: string
  user: { userType: string } | null
}

const members: FakeMember[] = []

vi.mock('../../cache/org-cache-helpers', () => ({
  getCachedMembers: async () => members,
  findCachedResource: async () => ({ label: 'Contact' }),
  getCachedKbCatalog: async () => [],
}))

const capsByUser = new Map<string, CapabilityView>()
const getCapabilitiesSpy = vi.fn(async (userId: string, _orgId: string) => {
  const hit = capsByUser.get(userId)
  if (!hit) throw new Error(`no fake capabilities registered for ${userId}`)
  return hit
})
vi.mock('../../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: (userId: string, orgId: string) => getCapabilitiesSpy(userId, orgId),
}))

/**
 * Every capability factory the two runners register hands its `getDeps` here, so
 * the suite can read back exactly what the tools would have seen.
 */
const { seenDeps, capture } = vi.hoisted(() => {
  const seen: unknown[] = []
  return {
    seenDeps: seen,
    capture: (getDeps: () => unknown) => {
      seen.push(getDeps())
      return { page: '__global__', tools: [] }
    },
  }
})

/** Read-back helper: `seenDeps` is untyped so the hoisted factory stays literal. */
const deps = () => seenDeps as ToolDeps[]

vi.mock('../../ai/kopilot/capabilities', () => ({
  createActorCapabilities: capture,
  createAppCapabilities: async (opts: { getToolDeps: () => unknown }) => {
    seenDeps.push(opts.getToolDeps())
    return { page: '__global__', tools: [] }
  },
  createCapabilityRegistry: () => ({ register: () => {}, getTools: () => [] }),
  createEntityCapabilities: capture,
  createKbReadCapabilities: capture,
  createKnowledgeCapabilities: capture,
  createLearnedKbCapabilities: capture,
  createMailCapabilities: capture,
  createTaskCapabilities: capture,
}))

vi.mock('../../ai/mcp', () => ({
  createMcpCapabilities: async () => ({ page: '__global__', tools: [] }),
}))

vi.mock('../../ai/agent-framework/engine', () => ({
  AgentEngine: class {
    async *submitMessage() {
      yield {
        type: 'assistant-message-finished',
        parts: [{ type: 'text', text: '[noop] nothing durable' }],
      }
    }
    getState() {
      return { capturedActions: [] }
    }
  },
}))

import { resolveCaptureRunPrincipal, runHeadlessSuggestion } from '../headless-runner'
import { runLearnedExtraction } from '../learned-extraction-runner'

const ORG = 'org-1'

/**
 * A real `None` policy view — the exact object an agent published at `None`
 * would run under. Used as the fake principal so "denies" is proven against
 * production code, not a hand-written stub that always returns false.
 */
const NONE_VIEW = new AgentPolicyCapabilities(emptyAgentPolicy()) as unknown as CapabilityView

/** Chainable Drizzle query-builder stub that awaits to `rows`. */
function chain(rows: unknown[] = []) {
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(rows)
        return () => proxy
      },
    }
  )
  return proxy
}

const ENTITY_ROW = {
  id: 'ei-1',
  entityDefinitionId: 'def-a',
  organizationId: ORG,
  archivedAt: null,
  displayName: 'Acme',
  secondaryDisplayValue: null,
  lastActivityAt: null,
}

const THREAD_ROW = {
  id: 'thread-1',
  organizationId: ORG,
  subject: 'Refund policy',
  lastMessageAt: null,
  messageCount: 2,
  latestMessageId: 'msg-9',
  primaryEntityInstanceId: null,
  primaryEntityDefinitionId: null,
}

function fakeDb() {
  return {
    query: {
      EntityInstance: { findFirst: async () => ENTITY_ROW },
      Thread: { findFirst: async () => THREAD_ROW },
    },
    select: () => chain([]),
    selectDistinct: () => chain([]),
  } as any
}

const callModel = async function* () {
  yield { type: 'text', text: '' }
} as any

beforeEach(() => {
  members.length = 0
  capsByUser.clear()
  seenDeps.length = 0
  getCapabilitiesSpy.mockClear()
})

describe('resolveCaptureRunPrincipal — the bundle owner is the bound', () => {
  it('resolves the owner’s own CapabilityView for an ACTIVE human member', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('human-1', NONE_VIEW)

    const out = await resolveCaptureRunPrincipal({ organizationId: ORG, ownerUserId: 'human-1' })

    expect(out.ok).toBe(true)
    if (out.ok) expect(out.capabilities).toBe(NONE_VIEW)
    expect(getCapabilitiesSpy).toHaveBeenCalledWith('human-1', ORG)
  })

  it('refuses when the owner is not a member — the system-user fallback case', async () => {
    const out = await resolveCaptureRunPrincipal({
      organizationId: ORG,
      ownerUserId: 'system-user',
    })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('not a member')
    // FAIL CLOSED: no capability blob is even read, and nothing runs.
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })

  it('refuses a deactivated member and an AGENT pseudo-user', async () => {
    members.push({ userId: 'gone', status: 'INACTIVE', role: 'USER', user: { userType: 'USER' } })
    members.push({
      userId: 'bot',
      status: 'ACTIVE',
      role: 'USER',
      user: { userType: 'AGENT' },
    })

    const inactive = await resolveCaptureRunPrincipal({ organizationId: ORG, ownerUserId: 'gone' })
    const agent = await resolveCaptureRunPrincipal({ organizationId: ORG, ownerUserId: 'bot' })

    expect(inactive.ok).toBe(false)
    if (!inactive.ok) expect(inactive.reason).toContain('INACTIVE')
    expect(agent.ok).toBe(false)
    if (!agent.ok) expect(agent.reason).toContain('not a human member')
    expect(getCapabilitiesSpy).not.toHaveBeenCalled()
  })
})

describe('runHeadlessSuggestion — capabilities reach every tool factory', () => {
  it('threads the owner’s view into ToolDeps.capabilities', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('human-1', NONE_VIEW)

    const out = await runHeadlessSuggestion(
      { db: fakeDb(), callModel },
      {
        organizationId: ORG,
        ownerUserId: 'human-1',
        entityInstanceId: 'ei-1',
        triggerSource: 'stale_scan',
        modelId: 'openai:gpt-4',
      }
    )

    expect(Result.isOk(out)).toBe(true)
    expect(seenDeps.length).toBeGreaterThan(0)
    // The whole point of #1332: no factory may see `undefined` any more.
    for (const d of deps()) expect(d.capabilities).toBe(NONE_VIEW)
  })

  it('a None-published policy actually denies — every def read and write is refused', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('human-1', NONE_VIEW)

    await runHeadlessSuggestion(
      { db: fakeDb(), callModel },
      {
        organizationId: ORG,
        ownerUserId: 'human-1',
        entityInstanceId: 'ei-1',
        triggerSource: 'stale_scan',
        modelId: 'openai:gpt-4',
      }
    )

    const view = deps()[0]?.capabilities
    expect(view).toBeDefined()
    expect(view?.canViewEntity('def-a')).toBe(false)
    expect(view?.canEditEntity('def-a')).toBe(false)
    expect(view?.filterViewableDefIds(['def-a', 'def-b'])).toEqual([])
  })

  it('skips the run entirely when no human principal is reachable', async () => {
    const out = await runHeadlessSuggestion(
      { db: fakeDb(), callModel },
      {
        organizationId: ORG,
        ownerUserId: 'system-user',
        entityInstanceId: 'ei-1',
        triggerSource: 'stale_scan',
        modelId: 'openai:gpt-4',
      }
    )

    expect(Result.isOk(out)).toBe(true)
    if (Result.isOk(out)) {
      expect(out.value.actions).toEqual([])
      expect(out.value.noopReason).toContain('no_permission_principal')
    }
    // No tool factory was constructed, so no ungated surface was ever built.
    expect(seenDeps).toEqual([])
  })
})

describe('runLearnedExtraction — same bind, same refusal', () => {
  it('threads the owner’s view into ToolDeps.capabilities', async () => {
    members.push({ userId: 'human-1', status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set('human-1', NONE_VIEW)

    const out = await runLearnedExtraction(
      { db: fakeDb(), callModel },
      {
        organizationId: ORG,
        ownerUserId: 'human-1',
        threadId: 'thread-1',
        anchor: { entityInstanceId: 'ei-1', entityDefinitionId: 'def-a' },
        modelId: 'openai:gpt-4',
      }
    )

    expect(Result.isOk(out)).toBe(true)
    expect(seenDeps.length).toBeGreaterThan(0)
    for (const d of deps()) expect(d.capabilities).toBe(NONE_VIEW)
    // A `None` principal refuses the KB instances the learned write door needs.
    expect(deps()[0]?.capabilities?.canViewInstance('kb', 'kb-1')).toBe(false)
    expect(deps()[0]?.capabilities?.canEditInstance('kb', 'kb-1')).toBe(false)
  })

  it('returns a noop bundle instead of running unbounded when the owner is the system user', async () => {
    const out = await runLearnedExtraction(
      { db: fakeDb(), callModel },
      {
        organizationId: ORG,
        ownerUserId: 'system-user',
        threadId: 'thread-1',
        anchor: { entityInstanceId: 'ei-1', entityDefinitionId: 'def-a' },
        modelId: 'openai:gpt-4',
      }
    )

    expect(Result.isOk(out)).toBe(true)
    if (Result.isOk(out)) {
      expect(out.value.actions).toEqual([])
      expect(out.value.noopReason).toContain('no_permission_principal')
    }
    expect(seenDeps).toEqual([])
  })
})
