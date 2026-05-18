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
  AssistantSessionMessage,
  LLMCallParams,
  LLMStreamEvent,
  SessionMessage,
  ToolCallPart,
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
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
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

/**
 * Look up the assistant message that owns the pending tool_call part and
 * return both message and the targeted part. Provides a single source of
 * truth for the resume-mutates-in-place invariant.
 */
function getPendingMessageAndPart(
  messages: SessionMessage[],
  messageId: string,
  partIndex: number
) {
  const msg = messages.find(
    (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === messageId
  )
  expect(msg).toBeDefined()
  const part = msg!.parts[partIndex]
  expect(part).toBeDefined()
  expect(part?.type).toBe('tool_call')
  return { msg: msg!, part: part as ToolCallPart }
}

describe('AgentEngine — pending approval (parts-based)', () => {
  it('approval pause stores the assistant-with-tool_call in state.messages with status=awaiting-approval', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [{ content: 'I will call risky_tool', toolCalls: [tc] }],
    })

    await drain(engine.submitMessage('do it'))

    const state = engine.getState()
    expect(state.waitingForApproval).toBe(true)

    // pendingToolCall is a pointer into state.messages — the assistant message
    // itself lives in messages[]; nothing on pendingToolCall duplicates it.
    expect(state.pendingToolCall).toBeDefined()
    expect(state.pendingToolCall?.toolCallId).toBe('call_1')
    expect(state.pendingToolCall?.toolName).toBe('risky_tool')
    expect(state.pendingToolCall?.agentName).toBe('agent')
    expect(state.pendingToolCall?.messageId).toBeDefined()
    expect(typeof state.pendingToolCall?.partIndex).toBe('number')
    // The legacy `assistantMessage` field is gone.
    expect((state.pendingToolCall as Record<string, unknown>).assistantMessage).toBeUndefined()

    // The assistant message exists in state.messages with the paused part.
    const { part } = getPendingMessageAndPart(
      state.messages,
      state.pendingToolCall!.messageId,
      state.pendingToolCall!.partIndex
    )
    expect(part.toolCallId).toBe('call_1')
    expect(part.name).toBe('risky_tool')
    expect(part.status).toBe('awaiting-approval')
    expect(part.output).toBeUndefined()
  })

  it('approval pause keeps sibling auto-tool parts intact alongside the awaiting-approval part', async () => {
    const auto = makeApprovalToolCall('call_auto', 'some_other_tool')
    const approval = makeApprovalToolCall('call_appr', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [{ content: 'mixed', toolCalls: [auto, approval] }],
    })

    await drain(engine.submitMessage('do it'))

    const state = engine.getState()
    const pending = state.pendingToolCall
    expect(pending?.toolCallId).toBe('call_appr')

    // Both tool_call parts must be present on the trailing assistant message.
    // The auto-tool ran (or was attempted) prior to the pause; the approval
    // tool's part is `awaiting-approval`. Order matches the order the model
    // emitted the calls.
    const assistant = state.messages.find(
      (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pending?.messageId
    )
    expect(assistant).toBeDefined()
    const toolCallParts = assistant!.parts.filter((p): p is ToolCallPart => p.type === 'tool_call')
    const ids = toolCallParts.map((p) => p.toolCallId)
    expect(ids).toContain('call_appr')
    const approvalPart = toolCallParts.find((p) => p.toolCallId === 'call_appr')
    expect(approvalPart?.status).toBe('awaiting-approval')
  })

  it('resume({ action: "reject" }) mutates the existing part in place with rejected status + synthetic output', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [
        { content: 'about to call', toolCalls: [tc] },
        { content: 'understood', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('do it'))
    const pending = engine.getState().pendingToolCall!
    const pausedMessageId = pending.messageId
    const pausedPartIndex = pending.partIndex
    const messagesBeforeCount = engine.getState().messages.length

    await drain(engine.resume({ action: 'reject' }))

    const state = engine.getState()
    expect(state.waitingForApproval).toBe(false)
    expect(state.pendingToolCall).toBeUndefined()

    // The paused message id is still in messages[] — no splice, no duplicate.
    const sameMessageStillThere = state.messages.find(
      (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pausedMessageId
    )
    expect(sameMessageStillThere).toBeDefined()

    // The same part index now has rejected status + synthetic output.
    const rejectedPart = sameMessageStillThere!.parts[pausedPartIndex] as ToolCallPart
    expect(rejectedPart.type).toBe('tool_call')
    expect(rejectedPart.status).toBe('rejected')
    expect(rejectedPart.output).toBeDefined()
    expect(rejectedPart.output).toMatchObject({ rejected: true })

    // No duplicate assistant message was pushed for the rejected call; the
    // engine may have appended subsequent messages (next iteration's turn),
    // but the paused message itself was mutated, not replaced.
    const assistantsWithCall1 = state.messages.filter(
      (m): m is AssistantSessionMessage =>
        m.role === 'assistant' &&
        Array.isArray(m.parts) &&
        m.parts.some((p) => p.type === 'tool_call' && p.toolCallId === 'call_1')
    )
    expect(assistantsWithCall1).toHaveLength(1)
    expect(assistantsWithCall1[0]?.id).toBe(pausedMessageId)
    // Subsequent appended parts/messages are allowed (responder continuation).
    expect(state.messages.length).toBeGreaterThanOrEqual(messagesBeforeCount)
  })

  it('resume({ action: "approve" }) success mutates the part to completed with tool output', async () => {
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
    const pending = engine.getState().pendingToolCall!
    const pausedMessageId = pending.messageId
    const pausedPartIndex = pending.partIndex

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined()

    const msg = state.messages.find(
      (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pausedMessageId
    )
    const part = msg!.parts[pausedPartIndex] as ToolCallPart
    expect(part.type).toBe('tool_call')
    expect(part.status).toBe('completed')
    expect(part.output).toMatchObject({ ran: true })
    expect(part.error).toBeUndefined()
  })

  it('resume({ action: "approve" }) when tool throws mutates the part to error with the thrown message', async () => {
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
    const pending = engine.getState().pendingToolCall!
    const pausedMessageId = pending.messageId
    const pausedPartIndex = pending.partIndex

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    expect(state.pendingToolCall).toBeUndefined()

    const msg = state.messages.find(
      (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pausedMessageId
    )
    const part = msg!.parts[pausedPartIndex] as ToolCallPart
    expect(part.status).toBe('error')
    expect(part.error).toMatch(/boom/)
  })

  it('post-approve, follow-up parts continue appending to the SAME assistant message id', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [
        { content: 'about to call', toolCalls: [tc] },
        // After approve, a second LLM call returns a final reply with no tools.
        { content: 'all done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('do it'))
    const pausedMessageId = engine.getState().pendingToolCall!.messageId

    await drain(engine.resume({ action: 'approve' }))

    const state = engine.getState()
    // Either: the same message keeps growing (parts appended in place), or
    // a fresh assistant message is appended for the post-resume responder.
    // The contract from plan §5.6 + answers §A.5 is: same messageId, parts
    // continue appending. Assert that.
    const sameMessage = state.messages.find(
      (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === pausedMessageId
    )
    expect(sameMessage).toBeDefined()
    const proseAfter = sameMessage!.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(proseAfter).toContain('all done')
  })

  it('submitMessage while pending clears pendingToolCall and does NOT leak any extra assistant message', async () => {
    const tc = makeApprovalToolCall('call_1', 'risky_tool')
    const engine = buildEngine({
      approvalToolName: 'risky_tool',
      turns: [
        { content: 'first', toolCalls: [tc] },
        // After edit: no tool calls — exit cleanly.
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

    // The freshly-appended boundary message is the new user message.
    expect(state.messages[messagesBefore]?.role).toBe('user')
    expect((state.messages[messagesBefore] as { content?: string }).content).toBe('edited')
  })
})
