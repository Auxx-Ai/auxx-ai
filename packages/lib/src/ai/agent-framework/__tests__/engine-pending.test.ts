// packages/lib/src/ai/agent-framework/__tests__/engine-pending.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentToolDefinition,
  LLMCallParams,
  LLMStreamEvent,
} from '../types'

const ZERO_USAGE: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

interface ScriptedTurn {
  content: string
  toolCalls: ToolCall[]
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  approvalToolName?: string
  toolExecute?: AgentToolDefinition['execute']
}) {
  let turnIdx = 0

  const callModel = async function* (_params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[turnIdx++] ?? { content: '', toolCalls: [] }
    yield {
      type: 'done',
      content: turn.content,
      toolCalls: turn.toolCalls,
      usage: ZERO_USAGE,
    }
  }

  const tools: AgentToolDefinition[] = []
  if (opts.approvalToolName) {
    tools.push({
      name: opts.approvalToolName,
      description: 'approval-gated tool',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: opts.toolExecute ?? (async () => ({ success: true, output: { ok: true } })),
    })
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools,
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: 5,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'test-model',
    defaultProvider: 'test-provider',
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    domainConfig,
    callModel,
  }

  return new AgentEngine(config)
}

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

const makeApprovalToolCall = (id: string, name: string, args = {}): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

describe('AgentEngine — pending approval persistence invariants', () => {
  it('approval pause does NOT push the assistant-with-tool_calls into state.messages', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [{ content: 'I will call risky_tool', toolCalls: [tc] }],
    })

    await drain(engine.submitMessage('do it'))

    const state = engine.getState()
    expect(state.waitingForApproval).toBe(true)
    expect(state.pendingToolCall?.toolCallId).toBe('call_1')
    // The assistant message lives on pendingToolCall, NOT in state.messages.
    expect(state.pendingToolCall?.assistantMessage.toolCalls?.[0]?.id).toBe('call_1')
    const assistantInMessages = state.messages.find(
      (m) => m.role === 'assistant' && m.toolCalls?.length
    )
    expect(assistantInMessages).toBeUndefined()
  })

  it('approval pause rewrites toolCalls to [approvalTool] only on the stashed assistant', async () => {
    const auto = makeApprovalToolCall('call_auto', 'some_other_tool')
    const approval = makeApprovalToolCall('call_appr', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [{ content: 'mixed', toolCalls: [auto, approval] }],
    })

    await drain(engine.submitMessage('do it'))

    const stashed = engine.getState().pendingToolCall?.assistantMessage
    expect(stashed?.toolCalls).toHaveLength(1)
    expect(stashed?.toolCalls?.[0]?.id).toBe('call_appr')
    expect(stashed?.toolCalls?.[0]?.function.name).toBe('risky_tool')
  })

  it('resume({ action: "reject" }) appends [assistantMessage, toolResultMsg] in order', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [
        { content: 'about to call', toolCalls: [tc] },
        // After reject the engine re-enters the agent loop; emit a no-tool exit.
        { content: 'understood', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('do it'))
    const messagesBefore = engine.getState().messages.length

    await drain(engine.resume({ action: 'reject' }))

    const state = engine.getState()
    const newSlice = state.messages.slice(messagesBefore)
    // First two newly-appended items must be the paired assistant + tool result.
    expect(newSlice[0]?.role).toBe('assistant')
    expect(newSlice[0]?.toolCalls?.[0]?.id).toBe('call_1')
    expect(newSlice[1]?.role).toBe('tool')
    expect(newSlice[1]?.toolCallId).toBe('call_1')
    expect(JSON.parse(newSlice[1]?.content ?? '{}')).toMatchObject({ rejected: true })
    expect(state.waitingForApproval).toBe(false)
    expect(state.pendingToolCall).toBeUndefined()
  })

  it('resume({ action: "approve" }) success appends [assistantMessage, toolResultMsg] in order', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      toolExecute: async () => ({ success: true, output: { ran: true } }),
      turns: [
        { content: 'about to call', toolCalls: [tc] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('do it'))
    const messagesBefore = engine.getState().messages.length

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    const newSlice = state.messages.slice(messagesBefore)
    expect(newSlice[0]?.role).toBe('assistant')
    expect(newSlice[0]?.toolCalls?.[0]?.id).toBe('call_1')
    expect(newSlice[1]?.role).toBe('tool')
    expect(newSlice[1]?.toolCallId).toBe('call_1')
    expect(JSON.parse(newSlice[1]?.content ?? '{}')).toMatchObject({ ran: true })
    expect(state.pendingToolCall).toBeUndefined()
  })

  it('resume({ action: "approve" }) when tool throws still appends [assistantMessage, errorToolMsg]', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      toolExecute: async () => {
        throw new Error('boom')
      },
      turns: [
        { content: 'about to call', toolCalls: [tc] },
        { content: 'recovered', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('do it'))
    const messagesBefore = engine.getState().messages.length

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    const newSlice = state.messages.slice(messagesBefore)
    expect(newSlice[0]?.role).toBe('assistant')
    expect(newSlice[0]?.toolCalls?.[0]?.id).toBe('call_1')
    expect(newSlice[1]?.role).toBe('tool')
    expect(newSlice[1]?.toolCallId).toBe('call_1')
    expect(JSON.parse(newSlice[1]?.content ?? '{}')).toMatchObject({ error: 'boom' })
    expect(state.pendingToolCall).toBeUndefined()
  })

  it('submitMessage while pending clears pendingToolCall and only appends the new user message', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [
        { content: 'first', toolCalls: [tc] },
        // Second turn (after edit): no tool calls — exit cleanly.
        { content: 'reply to edit', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('original'))
    expect(engine.getState().pendingToolCall).toBeDefined()
    const messagesBefore = engine.getState().messages.length

    await drain(engine.submitMessage('edited'))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined()
    expect(state.waitingForApproval).toBe(false)

    // The abandoned assistant-with-tool_calls must NOT have leaked into messages
    // — it lived only on the (now-cleared) pendingToolCall.
    const orphan = state.messages.find(
      (m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.id === 'call_1')
    )
    expect(orphan).toBeUndefined()

    // The freshly-appended message at the boundary is the new user message.
    expect(state.messages[messagesBefore]?.role).toBe('user')
    expect(state.messages[messagesBefore]?.content).toBe('edited')
  })
})
