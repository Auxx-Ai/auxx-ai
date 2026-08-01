// packages/lib/src/approvals/__tests__/approval-apply-capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolDeps } from '../../ai/kopilot/capabilities/types'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { emptyAgentPolicy } from '../../permissions/profiles/agent-policy'
import { AgentPolicyCapabilities } from '../../permissions/profiles/agent-policy-capabilities'
import { Result } from '../../result'

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
 * A stand-in for every replayed tool. It answers the ONE question this suite
 * exists to ask: does the tool body see a `CapabilityView`, and does that view
 * decide the outcome?
 */
const { seenDeps, probeCapability, emptyCapability, probeState } = vi.hoisted(() => {
  const seen: unknown[] = []
  const state = { throwForbidden: false }
  return {
    seenDeps: seen,
    probeState: state,
    emptyCapability: () => ({ page: '__global__', tools: [] }),
    probeCapability: (getDeps: () => { capabilities?: unknown }) => ({
      page: '__global__',
      tools: [
        {
          name: 'probe_tool',
          description: 'test probe',
          parameters: { type: 'object', properties: {} },
          execute: async () => {
            const deps = getDeps()
            seen.push(deps)
            // How the real instance gates throw: `assertEditInstance` raises a
            // ForbiddenError rather than returning success=false.
            if (state.throwForbidden) {
              const { ForbiddenError } = await import('../../errors')
              throw new ForbiddenError('You do not have permission to edit this knowledge base.')
            }
            const view = deps.capabilities as CapabilityView | undefined
            if (!view) return { success: false, error: 'no_capability_view' }
            if (!view.canEditEntity('def-a')) return { success: false, error: 'denied' }
            return { success: true, output: { id: 'real-1' } }
          },
        },
      ],
    }),
  }
})

vi.mock('../../ai/kopilot/capabilities', () => ({
  createActorCapabilities: emptyCapability,
  createAppCapabilities: async () => ({ page: '__global__', tools: [] }),
  createCapabilityRegistry: () => {
    const tools: any[] = []
    return {
      register: (cap: any) => tools.push(...(cap?.tools ?? [])),
      getTools: () => tools,
    }
  },
  createEntityCapabilities: probeCapability,
  createKnowledgeCapabilities: emptyCapability,
  createLearnedKbCapabilities: emptyCapability,
  createMailCapabilities: emptyCapability,
  createTaskCapabilities: emptyCapability,
}))

vi.mock('../../ai/mcp', () => ({
  createMcpCapabilities: async () => ({ page: '__global__', tools: [] }),
}))

import { approveBundle } from '../actions-service'

const ORG = 'org-1'
const APPROVER = 'approver-1'

const NONE_VIEW = new AgentPolicyCapabilities(emptyAgentPolicy()) as unknown as CapabilityView

/** A view that permits exactly the def the probe tool asks about. */
const ALLOW_VIEW = {
  canEditEntity: (id: string) => id === 'def-a',
} as unknown as CapabilityView

/** Chainable Drizzle stub that awaits to `rows`. */
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

function bundleRow() {
  return {
    id: 'sug-1',
    organizationId: ORG,
    status: 'FRESH',
    triggerSource: 'learned-extraction',
    threadId: null,
    entityInstanceId: 'ei-1',
    createdAt: new Date(),
    computedForActivityAt: new Date(),
    bundle: {
      actions: [{ localIndex: 0, toolName: 'probe_tool', args: {}, summary: 'probe' }],
      modelId: 'openai:gpt-4',
      headlessTraceId: 'hrun-1',
    },
  }
}

function fakeDb(updateSpy?: () => void) {
  return {
    query: {
      AiSuggestion: { findFirst: async () => bundleRow() },
      EntityInstance: { findFirst: async () => undefined },
    },
    update: () => {
      updateSpy?.()
      return chain([])
    },
  } as any
}

beforeEach(() => {
  capsByUser.clear()
  seenDeps.length = 0
  getCapabilitiesSpy.mockClear()
  probeState.throwForbidden = false
})

describe('approveBundle — apply-time replay is bound by the APPROVER', () => {
  it('resolves the approver’s capabilities and hands them to the replayed tool', async () => {
    capsByUser.set(APPROVER, ALLOW_VIEW)

    const out = await approveBundle(fakeDb(), {
      bundleId: 'sug-1',
      organizationId: ORG,
      userId: APPROVER,
    })

    // 19b's open question, settled: `approveBundle`'s `userId` is the same value
    // written to `AiSuggestion.decidedById`, so the approver IS the bound.
    expect(getCapabilitiesSpy).toHaveBeenCalledWith(APPROVER, ORG)
    expect(seenDeps.length).toBe(1)
    expect((seenDeps[0] as ToolDeps).capabilities).toBe(ALLOW_VIEW)
    expect(Result.isOk(out)).toBe(true)
    if (Result.isOk(out)) {
      expect(out.value.status).toBe('APPROVED')
      expect(out.value.outcomes[0]?.status).toBe('success')
    }
  })

  it('a None policy denies the replay instead of executing it unrestricted', async () => {
    capsByUser.set(APPROVER, NONE_VIEW)

    const out = await approveBundle(fakeDb(), {
      bundleId: 'sug-1',
      organizationId: ORG,
      userId: APPROVER,
    })

    expect(Result.isOk(out)).toBe(true)
    if (Result.isOk(out)) {
      expect(out.value.status).toBe('REJECTED')
      expect(out.value.outcomes[0]?.status).toBe('failed')
      expect(out.value.outcomes[0]?.error).toBe('denied')
    }
    // And it was denied by a real view, not by the absence of one.
    expect((seenDeps[0] as ToolDeps).capabilities).toBe(NONE_VIEW)
  })

  it('leaves the bundle FRESH when every action is blocked by permissions', async () => {
    capsByUser.set(APPROVER, ALLOW_VIEW)
    probeState.throwForbidden = true
    const updateSpy = vi.fn()

    const out = await approveBundle(fakeDb(updateSpy), {
      bundleId: 'sug-1',
      organizationId: ORG,
      userId: APPROVER,
    })

    // A 403 says something about the approver, not the proposal — resolving the
    // bundle here would let anyone without the rung destroy it by clicking
    // Approve, with no way to get it back.
    expect(Result.isOk(out)).toBe(false)
    if (!Result.isOk(out)) {
      expect(out.error.name).toBe('ForbiddenError')
    }
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
