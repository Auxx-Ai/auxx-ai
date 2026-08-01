// packages/lib/src/ai/agent-framework/__tests__/resume-parts.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AgentToolDefinition,
  AssistantSessionMessage,
  LLMCallParams,
  LLMStreamEvent,
  SessionMessage,
  SystemSessionMessage,
  ToolCallPart,
} from '../types'

/**
 * Pause/approve/reject mutates the existing tool_call part in place — no
 * splice, no new assistant message. Mirrors the engine-pending invariants
 * but focuses on the parts[] mutation semantics rather than the
 * pendingToolCall pointer.
 */

const ZERO_USAGE: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

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

interface ScriptedTurn {
  content: string
  toolCalls?: ToolCall[]
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  tools: AgentToolDefinition[]
  maxIterations?: number
}) {
  let turnIdx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[turnIdx++] ?? { content: '' }
    yield {
      type: 'done',
      content: turn.content,
      toolCalls: turn.toolCalls ?? [],
      usage: ZERO_USAGE,
    }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools,
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: opts.maxIterations ?? 5,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: db handle unused in tests
    db: {} as any,
    domainConfig,
    callModel,
  }

  return new AgentEngine(config)
}

function getPartAt(messages: SessionMessage[], messageId: string, partIndex: number): ToolCallPart {
  const msg = messages.find(
    (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === messageId
  )
  if (!msg) throw new Error(`message ${messageId} not found`)
  const part = msg.parts[partIndex]
  if (!part || part.type !== 'tool_call') {
    throw new Error(`part at ${partIndex} is not a tool_call`)
  }
  return part
}

describe('parts-based resume — in-place mutation invariants', () => {
  it('pause writes status=awaiting-approval on the right part', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { ok: true } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [{ content: 'I will write.', toolCalls: [tc('tc_1', 'writer')] }],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    const pending = state.pendingToolCall
    expect(pending).toBeDefined()
    const part = getPartAt(state.messages, pending!.messageId, pending!.partIndex)
    expect(part.toolCallId).toBe('tc_1')
    expect(part.name).toBe('writer')
    expect(part.status).toBe('awaiting-approval')
  })

  it('approve mutates that part to status=completed with output (same messageId, same partIndex)', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { sent: 1 } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'I will write.', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'all done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    const { messageId, partIndex } = engine.getState().pendingToolCall!

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined()
    const part = getPartAt(state.messages, messageId, partIndex)
    expect(part.status).toBe('completed')
    expect(part.output).toEqual({ sent: 1 })
    expect(part.toolCallId).toBe('tc_1') // unchanged
  })

  it('reject mutates that part to status=rejected with synthetic output (same messageId, same partIndex)', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { sent: 1 } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'I will write.', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'fine, dropped it', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    const { messageId, partIndex } = engine.getState().pendingToolCall!

    await drain(engine.resume({ action: 'reject' }))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined()
    const part = getPartAt(state.messages, messageId, partIndex)
    expect(part.status).toBe('rejected')
    expect(part.output).toBeDefined()
    expect(part.output).toMatchObject({ rejected: true })
  })

  it('subsequent parts append to the same messageId after resume', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { ok: true } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'going to write', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'okay, written and reporting back.', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    const pausedMessageId = engine.getState().pendingToolCall!.messageId
    const partsBefore = (
      engine
        .getState()
        .messages.find(
          (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pausedMessageId
        ) as AssistantSessionMessage
    ).parts.length

    await drain(engine.resume({ action: 'approve' }))

    const sameMessage = engine
      .getState()
      .messages.find(
        (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pausedMessageId
      )!
    // Strict contract from plan §5.6: the same message id keeps appending
    // parts after resume. The trailing text part includes the responder reply.
    expect(sameMessage.parts.length).toBeGreaterThan(partsBefore)
    const finalProse = sameMessage.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(finalProse).toContain('reporting back')
  })

  it('approve when the tool throws mutates the part to status=error with the message', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => {
        throw new Error('upstream fail')
      },
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'risky', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'recovered', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    const { messageId, partIndex } = engine.getState().pendingToolCall!

    await drain(engine.resume({ action: 'approve' }))

    const part = getPartAt(engine.getState().messages, messageId, partIndex)
    expect(part.status).toBe('error')
    expect(part.error).toMatch(/upstream fail/)
  })

  it('pause persists a system approval message alongside the assistant message', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { ok: true } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [{ content: 'I will write.', toolCalls: [tc('tc_1', 'writer')] }],
    })

    const events = await drain(engine.submitMessage('go'))

    // The approval-required event carries the persisted message id.
    const approvalEvent = events.find((e) => e.type === 'approval-required')
    expect(approvalEvent).toBeDefined()
    const approvalMsgId =
      approvalEvent && approvalEvent.type === 'approval-required'
        ? approvalEvent.approvalMessageId
        : undefined
    expect(approvalMsgId).toBeTruthy()

    const sysMsg = engine
      .getState()
      .messages.find(
        (m): m is SystemSessionMessage => m.role === 'system' && m.id === approvalMsgId
      )
    expect(sysMsg).toBeDefined()
    expect(sysMsg!.approval).toBeDefined()
    expect(sysMsg!.approval!.toolCallId).toBe('tc_1')
    expect(sysMsg!.approval!.toolName).toBe('writer')
    expect(sysMsg!.approval!.status).toBe('pending')
  })

  it('approve flips the system approval message to status=approved', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { ok: true } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'go', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    await drain(engine.resume({ action: 'approve' }))

    const sysMsg = engine
      .getState()
      .messages.find(
        (m): m is SystemSessionMessage => m.role === 'system' && m.approval?.toolCallId === 'tc_1'
      )
    expect(sysMsg).toBeDefined()
    expect(sysMsg!.approval!.status).toBe('approved')
  })

  it('reject flips the system approval message to status=rejected', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { ok: true } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'go', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'dropped', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    await drain(engine.resume({ action: 'reject' }))

    const sysMsg = engine
      .getState()
      .messages.find(
        (m): m is SystemSessionMessage => m.role === 'system' && m.approval?.toolCallId === 'tc_1'
      )
    expect(sysMsg).toBeDefined()
    expect(sysMsg!.approval!.status).toBe('rejected')
  })

  it('does NOT create a duplicate tool_call part on the same toolCallId after resume', async () => {
    const writer: AgentToolDefinition = {
      name: 'writer',
      displayName: 'Writer',
      description: 'w',
      parameters: { type: 'object', properties: {}, required: [] },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { sent: 1 } }),
    }
    const engine = buildEngine({
      tools: [writer],
      turns: [
        { content: 'go', toolCalls: [tc('tc_1', 'writer')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))
    await drain(engine.resume({ action: 'approve' }))

    // Count every tool_call part with toolCallId 'tc_1' across all assistant
    // messages — must be exactly 1. A regression would push a second part on
    // resume instead of mutating in place.
    let count = 0
    for (const msg of engine.getState().messages) {
      if (msg.role !== 'assistant') continue
      const m = msg as AssistantSessionMessage
      for (const p of m.parts ?? []) {
        if (p.type === 'tool_call' && p.toolCallId === 'tc_1') count++
      }
    }
    expect(count).toBe(1)
  })
})
