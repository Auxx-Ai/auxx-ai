// packages/lib/src/evals/__tests__/runtime-snapshot.test.ts

import { describe, expect, it } from 'vitest'
import type { EffectiveAgentRuntime } from '../../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import {
  type AgentRuntimeSnapshotV1,
  buildToolManifest,
  createAgentRuntimeSnapshot,
  toolSchemaDigest,
  verifyRuntimeAgainstSnapshot,
} from '../runtime-snapshot'

const tool = (over: Partial<AgentToolDefinition>): AgentToolDefinition =>
  ({
    name: 'find_threads',
    displayName: 'Find',
    description: '',
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async () => ({ success: true, output: {} }),
    ...over,
  }) as AgentToolDefinition

const runtime = (tools: AgentToolDefinition[]): EffectiveAgentRuntime =>
  ({
    domainConfig: {} as never,
    tools,
    applyToolRestrictions: (async () => ({ ok: true, args: {} })) as never,
    agentConfig: { toolRestrictions: null } as never,
    model: { provider: 'anthropic', model: 'claude' },
    utilityModel: { provider: 'anthropic', model: 'haiku' },
  }) as EffectiveAgentRuntime

const baseInput = (tools: AgentToolDefinition[]) => ({
  runtime: runtime(tools),
  scope: 'procedure' as const,
  agentId: 'agent_1',
  agentKind: 'internal' as const,
  procedures: [],
  appAccountRefs: {},
  personaModel: { provider: 'anthropic', model: 'claude' },
  graderModel: { provider: 'anthropic', model: 'claude' },
  mockPolicy: 'error' as const,
  limits: { maxCustomerTurns: 8, maxReinvokes: 8, maxIterations: 30 },
  time: { frozenAt: null },
  codeRevision: 'rev-1',
})

describe('toolSchemaDigest', () => {
  it('is stable for identical contracts and changes when parameters change', () => {
    const a = toolSchemaDigest(tool({}))
    const b = toolSchemaDigest(tool({}))
    expect(a).toBe(b)
    const c = toolSchemaDigest(tool({ parameters: { type: 'object', properties: {} } }))
    expect(c).not.toBe(a)
  })

  it('changes when idempotency or output-schema presence changes', () => {
    const base = toolSchemaDigest(tool({}))
    expect(toolSchemaDigest(tool({ idempotent: true }))).not.toBe(base)
  })
})

describe('createAgentRuntimeSnapshot', () => {
  it('captures models, manifest, and pins code revision; stores no executables', () => {
    const snap = createAgentRuntimeSnapshot(baseInput([tool({})]))
    expect(snap.version).toBe(1)
    expect(snap.codeRevision).toBe('rev-1')
    expect(snap.agent.model).toEqual({ provider: 'anthropic', model: 'claude' })
    expect(snap.agent.toolManifest).toEqual(buildToolManifest([tool({})]))
    // No function leaked into the persisted manifest.
    expect(JSON.stringify(snap)).not.toContain('function')
  })
})

describe('verifyRuntimeAgainstSnapshot', () => {
  const snap: AgentRuntimeSnapshotV1 = createAgentRuntimeSnapshot(baseInput([tool({})]))

  it('is compatible when the live toolset matches the manifest', () => {
    const v = verifyRuntimeAgainstSnapshot(runtime([tool({})]), snap)
    expect(v.compatible).toBe(true)
    expect(v.missingTools).toEqual([])
    expect(v.digestMismatches).toEqual([])
  })

  it('flags a missing tool', () => {
    const v = verifyRuntimeAgainstSnapshot(runtime([]), snap)
    expect(v.compatible).toBe(false)
    expect(v.missingTools).toEqual(['find_threads'])
  })

  it('flags a drifted schema digest', () => {
    const drifted = runtime([tool({ parameters: { type: 'object', properties: {} } })])
    const v = verifyRuntimeAgainstSnapshot(drifted, snap)
    expect(v.compatible).toBe(false)
    expect(v.digestMismatches).toEqual(['find_threads'])
  })

  it('reports code-revision drift as a soft signal, not incompatibility', () => {
    const v = verifyRuntimeAgainstSnapshot(runtime([tool({})]), { ...snap, codeRevision: 'other' })
    expect(v.compatible).toBe(true)
    expect(v.codeRevisionDrifted).toBe(true)
  })
})
