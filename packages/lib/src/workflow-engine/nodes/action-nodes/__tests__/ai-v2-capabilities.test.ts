// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/ai-v2-capabilities.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolDeps } from '../../../../ai/kopilot/capabilities/types'
import type { CapabilityView } from '../../../../permissions/capabilities/capability-view'
import { emptyAgentPolicy } from '../../../../permissions/profiles/agent-policy'
import { AgentPolicyCapabilities } from '../../../../permissions/profiles/agent-policy-capabilities'

interface FakeMember {
  userId: string
  status: string
  role: string
  user: { userType: string } | null
}
const members: FakeMember[] = []
vi.mock('../../../../cache/org-cache-helpers', () => ({
  getCachedMembers: async () => members,
}))

const capsByUser = new Map<string, CapabilityView>()
const getCapabilitiesSpy = vi.fn(async (userId: string, _orgId: string) => {
  const hit = capsByUser.get(userId)
  if (!hit) throw new Error(`no fake capabilities registered for ${userId}`)
  return hit
})
vi.mock('../../../../permissions/capabilities/get-capabilities', () => ({
  getCapabilities: (userId: string, orgId: string) => getCapabilitiesSpy(userId, orgId),
}))

vi.mock('../../../../agents', () => ({
  getOrgToolCatalog: vi.fn(async () => []),
  getOrgToolsetCatalog: vi.fn(async () => []),
  filterToolsByToolsets: vi.fn(() => []),
}))

const { seenDeps, emptyCapability } = vi.hoisted(() => ({
  seenDeps: [] as unknown[],
  emptyCapability: () => ({ page: '__global__', tools: [] }),
}))

// `workflows/workflow-execution-service` → `workflow-engine` → the node-processor
// registry → `text-classifier extends BaseAiNodeProcessor` is a real import cycle
// that leaves the base class undefined mid-init (it breaks the sibling
// `ai-v2.test.ts` suite too). Cutting it here is a test-harness concern only.
vi.mock('../../../../workflows/workflow-execution-service', () => ({
  WorkflowExecutionService: class {},
  createWorkflowRun: vi.fn(),
}))

vi.mock('../../../../ai/kopilot/capabilities', () => ({
  createActorCapabilities: emptyCapability,
  createEntityCapabilities: emptyCapability,
  createKnowledgeCapabilities: emptyCapability,
  createMailCapabilities: emptyCapability,
  createTaskCapabilities: emptyCapability,
}))

vi.mock('../../../../ai/kopilot', () => ({
  createActorCapabilities: emptyCapability,
  createAppCapabilities: async () => ({ page: '__global__', tools: [] }),
  createEntityCapabilities: emptyCapability,
  createKbCapabilities: emptyCapability,
  createKbReadCapabilities: emptyCapability,
  createKnowledgeCapabilities: emptyCapability,
  createMailCapabilities: emptyCapability,
  createNativeWorkflowCapabilities: emptyCapability,
  createTaskCapabilities: emptyCapability,
  createToolDepsFactory: (params: unknown) => {
    seenDeps.push(params)
    return () => params as ToolDeps
  },
  runStructuredOutputPass: vi.fn(),
  runWorkflowAiTurn: vi.fn(async () => ({ finalText: 'done', toolCalls: [], usage: undefined })),
}))

vi.mock('../../utils/ai-node-utils', () => ({
  extractModelConfig: (m: unknown) => m,
  logUnresolvedVariables: () => {},
  resolveModelConfig: async () => ({ provider: 'openai', model: 'gpt-4' }),
}))

vi.mock('../../utils/model-capability-gates', () => ({
  resolveCapabilityGates: () => ({ skipStructuredOutput: false, skipFiles: false, warnings: [] }),
}))

import { WorkflowNodeType } from '../../../core/types'
import { AIProcessorV2 } from '../ai-v2'

const ORG = 'org_test_123'
const AUTHOR = 'user_test_123'

const NONE_VIEW = new AgentPolicyCapabilities(emptyAgentPolicy()) as unknown as CapabilityView

const config = {
  model: { provider: 'openai', model: 'gpt-4' },
  prompt_template: [],
  prompt: 'hello',
  toolsEnabled: true,
  toolsets: [{ slug: 'entities', enabled: true, source: 'manual' }],
} as any

const node = {
  nodeId: 'ai-1',
  id: 'ai-1',
  name: 'AI',
  type: WorkflowNodeType.AI,
  // `buildMessages` reads `node.data`, not the config argument.
  data: config,
} as any

function fakeContextManager() {
  return {
    getVariable: vi.fn(async (path: string) => {
      if (path === 'sys.organizationId') return ORG
      if (path === 'sys.userId') return AUTHOR
      if (path === 'sys.workflow') return { id: 'wf-1' }
      return undefined
    }),
    setVariable: vi.fn(),
    setNodeVariable: vi.fn(),
    interpolateVariables: vi.fn(async (t: string) => t),
    log: vi.fn(),
    getAllVariables: vi.fn(() => ({})),
    buildOptimizedContext: vi.fn(async () => new Map()),
    formatForDisplay: vi.fn((v: unknown) => String(v)),
  } as any
}

async function runWithTools(ctxManager: ReturnType<typeof fakeContextManager>) {
  const processor = new AIProcessorV2()
  // `executeNodeWithTools` is the whole tool surface; calling it directly keeps
  // the mock surface to the capability plumbing this suite is about.
  await (processor as any).executeNodeWithTools(node, config, ctxManager)
}

beforeEach(() => {
  members.length = 0
  capsByUser.clear()
  seenDeps.length = 0
  getCapabilitiesSpy.mockClear()
})

describe('AI node tool execution is bound by the workflow author', () => {
  it('threads the `sys.userId` principal into ToolDeps.capabilities', async () => {
    members.push({ userId: AUTHOR, status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set(AUTHOR, NONE_VIEW)

    const ctxManager = fakeContextManager()
    await runWithTools(ctxManager)

    expect(getCapabilitiesSpy).toHaveBeenCalledWith(AUTHOR, ORG)
    expect(seenDeps.length).toBe(1)
    const params = seenDeps[0] as { capabilities?: CapabilityView }
    // Was `capabilities: undefined` — the documented KNOWN GAP — until now.
    expect(params.capabilities).toBe(NONE_VIEW)
  })

  it('a None-published policy actually denies every def read and write', async () => {
    members.push({ userId: AUTHOR, status: 'ACTIVE', role: 'USER', user: { userType: 'USER' } })
    capsByUser.set(AUTHOR, NONE_VIEW)

    await runWithTools(fakeContextManager())

    const view = (seenDeps[0] as { capabilities?: CapabilityView }).capabilities
    expect(view?.canViewEntity('def-a')).toBe(false)
    expect(view?.canEditEntity('def-a')).toBe(false)
    expect(view?.filterViewableDefIds(['def-a', 'def-b'])).toEqual([])
  })

  it('warns into the run log when the principal is not an active member', async () => {
    // The scheduled-trigger fallback: `workflowApp.createdById || 'system'`.
    capsByUser.set(AUTHOR, NONE_VIEW)

    const ctxManager = fakeContextManager()
    await runWithTools(ctxManager)

    const warned = ctxManager.log.mock.calls.some(
      (call: unknown[]) => call[0] === 'WARN' && String(call[2]).includes('not an active member')
    )
    expect(warned).toBe(true)
    // Still fails CLOSED — the view is threaded, never omitted.
    expect((seenDeps[0] as { capabilities?: CapabilityView }).capabilities).toBe(NONE_VIEW)
  })
})
