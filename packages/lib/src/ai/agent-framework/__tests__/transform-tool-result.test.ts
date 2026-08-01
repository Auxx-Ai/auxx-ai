// packages/lib/src/ai/agent-framework/__tests__/transform-tool-result.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentToolDefinition,
  AgentToolResult,
  AssistantSessionMessage,
  LLMCallParams,
  LLMStreamEvent,
  SessionMessage,
  ToolCallPart,
} from '../types'

/**
 * Return the first tool_call part for the given toolCallId across all
 * assistant messages. In the parts-based model, tool output lives on the
 * assistant's tool_call part — no separate tool message.
 */
function findToolCallPart(
  messages: SessionMessage[],
  toolCallId: string
): ToolCallPart | undefined {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const m = msg as AssistantSessionMessage
    for (const p of m.parts ?? []) {
      if (p.type === 'tool_call' && p.toolCallId === toolCallId) return p
    }
  }
  return undefined
}

/** Return the most-recent tool_call part with matching toolCallId. */
function findLastToolCallPart(
  messages: SessionMessage[],
  toolCallId: string
): ToolCallPart | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'assistant') continue
    const m = msg as AssistantSessionMessage
    for (let j = (m.parts?.length ?? 0) - 1; j >= 0; j--) {
      const p = m.parts[j]
      if (p?.type === 'tool_call' && p.toolCallId === toolCallId) return p
    }
  }
  return undefined
}

const ZERO_USAGE: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

interface ScriptedTurn {
  content: string
  toolCalls: ToolCall[]
}

const tc = (id: string, name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

interface BuildOpts {
  turns: ScriptedTurn[]
  tools: AgentToolDefinition[]
  onToolResult?: AgentDomainConfig['onToolResult']
  transformToolResult?: AgentDomainConfig['transformToolResult']
  maxIterations?: number
  maxApprovalsPerTurn?: number
  maxTotalIterations?: number
}

function buildEngine(opts: BuildOpts) {
  let turnIdx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[turnIdx++] ?? { content: '', toolCalls: [] }
    yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls, usage: ZERO_USAGE }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools,
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: opts.maxIterations ?? 10,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
    ...(opts.onToolResult ? { onToolResult: opts.onToolResult } : {}),
    ...(opts.transformToolResult ? { transformToolResult: opts.transformToolResult } : {}),
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
    domainConfig,
    callModel,
    ...(opts.maxApprovalsPerTurn !== undefined
      ? { maxApprovalsPerTurn: opts.maxApprovalsPerTurn }
      : {}),
    ...(opts.maxTotalIterations !== undefined
      ? { maxTotalIterations: opts.maxTotalIterations }
      : {}),
  }

  return new AgentEngine(config)
}

describe('AgentDomainConfig.transformToolResult — live tool-call path', () => {
  it('rewrites the LLM-visible tool message after onToolResult', async () => {
    const sentinelTool: AgentToolDefinition = {
      name: 'emit_sentinel',
      displayName: 'Emit sentinel',
      description: 't',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true, output: { _patch: 42 } }),
    }

    const engine = buildEngine({
      tools: [sentinelTool],
      turns: [
        { content: '', toolCalls: [tc('c1', 'emit_sentinel')] },
        { content: 'ok', toolCalls: [] },
      ],
      onToolResult: (_name, _result, state) => state,
      transformToolResult: (name, result) => {
        if (name !== 'emit_sentinel') return undefined
        const patch = (result.output as { _patch: number })._patch
        return { success: true, output: { canonical: patch * 2 } }
      },
    })

    await drain(engine.submitMessage('go'))

    const part = findToolCallPart(engine.getState().messages, 'c1')
    expect(part).toBeDefined()
    // The persisted tool_call part should carry the rewritten output, not the
    // raw `_patch` sentinel — proving transformToolResult ran before the part
    // was finalized.
    expect(part?.output).toEqual({ canonical: 84 })
  })

  it('runs after onToolResult, with state mining already applied', async () => {
    const sentinelTool: AgentToolDefinition = {
      name: 'emit',
      displayName: 'Emit',
      description: 't',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true, output: { delta: 1 } }),
    }

    const engine = buildEngine({
      tools: [sentinelTool],
      turns: [
        { content: '', toolCalls: [tc('c1', 'emit')] },
        { content: 'ok', toolCalls: [] },
      ],
      onToolResult: (_name, _result, state) => ({
        ...state,
        domainState: { ...(state.domainState as Record<string, unknown>), counter: 7 },
      }),
      transformToolResult: (_name, _result, state) => {
        const counter = (state.domainState as { counter?: number }).counter
        return { success: true, output: { counter } }
      },
    })

    await drain(engine.submitMessage('go'))

    const part = findToolCallPart(engine.getState().messages, 'c1')
    // The transform sees the post-onToolResult state — counter is already 7.
    expect(part?.output).toEqual({ counter: 7 })
  })

  it('flips success → false when the transform returns a recoverable error', async () => {
    const sentinelTool: AgentToolDefinition = {
      name: 'emit',
      displayName: 'Emit',
      description: 't',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true, output: { _patch: 1 } }),
    }

    const engine = buildEngine({
      tools: [sentinelTool],
      turns: [
        { content: '', toolCalls: [tc('c1', 'emit')] },
        { content: 'noted', toolCalls: [] },
      ],
      transformToolResult: () => ({
        success: false,
        output: { plan: null },
        error: 'no active plan; call plan_create first',
      }),
    })

    await drain(engine.submitMessage('go'))

    const part = findToolCallPart(engine.getState().messages, 'c1')
    expect(part?.status).toBe('error')
    expect(part?.error).toMatch(/no active plan/i)
    expect(part?.output).toEqual({ plan: null })
  })
})

describe('AgentDomainConfig.transformToolResult — approval resume path', () => {
  it('rewrites the tool message when an approved tool returns a sentinel', async () => {
    const approvalTool: AgentToolDefinition = {
      name: 'risky',
      displayName: 'Risky',
      description: 't',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { _patch: 'foo' } }),
    }

    const engine = buildEngine({
      tools: [approvalTool],
      turns: [
        { content: 'about to', toolCalls: [tc('c1', 'risky')] },
        { content: 'done', toolCalls: [] },
      ],
      transformToolResult: (name, result) => {
        if (name !== 'risky') return undefined
        const patch = (result.output as { _patch: string })._patch
        return { success: true, output: { canonical: patch.toUpperCase() } }
      },
    })

    await drain(engine.submitMessage('do it'))
    expect(engine.getState().waitingForApproval).toBe(true)

    await drain(engine.resume({ action: 'approve' }))

    const part = findLastToolCallPart(engine.getState().messages, 'c1')
    expect(part).toBeDefined()
    expect(part?.status).toBe('completed')
    expect(part?.output).toEqual({ canonical: 'FOO' })
  })
})

describe('AgentEngineConfig overrides — kopilot cap lifts', () => {
  it('with maxApprovalsPerTurn: 50, six chained approvals all complete', async () => {
    let calls = 0
    const approvalTool: AgentToolDefinition = {
      name: 'risky',
      displayName: 'Risky',
      description: 't',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => {
        calls++
        return { success: true, output: { ok: true } }
      },
    }

    // 6 successive approval turns, then a final no-tool reply.
    const turns: ScriptedTurn[] = []
    for (let i = 0; i < 6; i++) {
      turns.push({ content: '', toolCalls: [tc(`c${i}`, 'risky')] })
    }
    turns.push({ content: 'wrap up', toolCalls: [] })

    const engine = buildEngine({
      tools: [approvalTool],
      turns,
      maxApprovalsPerTurn: 50,
    })

    await drain(engine.submitMessage('start'))
    for (let i = 0; i < 6; i++) {
      await drain(engine.resume({ action: 'approve' }))
    }

    expect(calls).toBe(6)
    expect(engine.getState().waitingForApproval).toBe(false)
  })

  it('with the framework default (5), the 6th approval surfaces a turn-error', async () => {
    const approvalTool: AgentToolDefinition = {
      name: 'risky',
      displayName: 'Risky',
      description: 't',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { ok: true } }),
    }

    const turns: ScriptedTurn[] = []
    for (let i = 0; i < 6; i++) {
      turns.push({ content: '', toolCalls: [tc(`c${i}`, 'risky')] })
    }

    const engine = buildEngine({
      tools: [approvalTool],
      turns,
      // no maxApprovalsPerTurn — default 5 from engine.ts
    })

    await drain(engine.submitMessage('start'))
    for (let i = 0; i < 5; i++) {
      await drain(engine.resume({ action: 'approve' }))
    }

    const events = await drain(engine.resume({ action: 'approve' }))
    const turnError = events.find((e) => e.type === 'turn-error')
    expect(turnError).toBeDefined()
    if (turnError && turnError.type === 'turn-error') {
      expect(turnError.error).toMatch(/max approvals/i)
    }
  })
})
