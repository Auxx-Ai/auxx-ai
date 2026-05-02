// packages/lib/src/ai/agent-framework/__tests__/capture-mode.test.ts

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

const makeToolCall = (id: string, name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  tools: AgentToolDefinition[]
  approvalMode?: 'pause' | 'capture'
  maxIterations?: number
}) {
  let turnIdx = 0

  const callModel = async function* (_params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[turnIdx++] ?? { content: '', toolCalls: [] }
    yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls, usage: ZERO_USAGE }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools,
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: opts.maxIterations ?? 6,
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
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
    domainConfig,
    callModel,
    approvalMode: opts.approvalMode,
  }

  return new AgentEngine(config)
}

const noopExecute = async () => ({ success: true, output: { ran: true } })

describe('AgentEngine — capture mode', () => {
  it('collects N captured calls in a single turn (pure approval tools)', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'create',
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
      {
        name: 'spawn_work_item',
        description: 'spawn',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]
    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        {
          content: 'planning',
          toolCalls: [
            makeToolCall('c1', 'create_task', { title: 'A' }),
            makeToolCall('c2', 'create_task', { title: 'B' }),
            makeToolCall('c3', 'spawn_work_item', { name: 'X' }),
          ],
        },
        // Second turn: model finishes with no tool calls (text-only exit).
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(3)
    expect(state.capturedActions?.map((c) => c.toolName)).toEqual([
      'create_task',
      'create_task',
      'spawn_work_item',
    ])
    expect(state.capturedActions?.map((c) => c.localIndex)).toEqual([0, 1, 2])
    expect(state.waitingForApproval).toBeFalsy()
    expect(state.pendingToolCall).toBeUndefined()
  })

  it('pause mode is unchanged — first approval tool still pauses the loop', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'risky_tool',
        description: 'r',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]
    const engine = buildEngine({
      // No approvalMode → default pause
      tools,
      turns: [{ content: 'first', toolCalls: [makeToolCall('r1', 'risky_tool')] }],
    })

    await drain(engine.submitMessage('do it'))

    const state = engine.getState()
    expect(state.waitingForApproval).toBe(true)
    expect(state.pendingToolCall?.toolCallId).toBe('r1')
    expect(state.capturedActions ?? []).toHaveLength(0)
  })

  it('read-only tool fires execute even when capture-mode is on', async () => {
    let readExecuted = false
    const tools: AgentToolDefinition[] = [
      {
        name: 'search_entities',
        description: 's',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => {
          readExecuted = true
          return { success: true, output: { matches: [] } }
        },
      },
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        {
          content: 'mixed',
          toolCalls: [makeToolCall('r', 'search_entities'), makeToolCall('c', 'create_task')],
        },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(readExecuted).toBe(true)
    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(1)
    expect(state.capturedActions?.[0]?.toolName).toBe('create_task')

    // Conversation history must contain a real tool result for the read tool
    // AND a synthetic _captured: true result for the approval tool.
    const readMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'r')
    const captureMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c')
    expect(readMsg).toBeDefined()
    expect(captureMsg).toBeDefined()
    expect(JSON.parse(readMsg?.content ?? '{}')).toMatchObject({ matches: [] })
    expect(JSON.parse(captureMsg?.content ?? '{}')).toMatchObject({
      _captured: true,
      status: 'queued_for_approval',
    })
  })

  it('mixed turn (1 approval + 2 reads) — reads execute, approval captures, loop continues', async () => {
    let readCount = 0
    const tools: AgentToolDefinition[] = [
      {
        name: 'list_threads',
        description: 'l',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => {
          readCount++
          return { success: true, output: { threads: [] } }
        },
      },
      {
        name: 'search_entities',
        description: 's',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => {
          readCount++
          return { success: true, output: { matches: [] } }
        },
      },
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        {
          content: 'mixed',
          toolCalls: [
            makeToolCall('r1', 'list_threads'),
            makeToolCall('c1', 'create_task', { title: 'follow up' }),
            makeToolCall('r2', 'search_entities'),
          ],
        },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    expect(readCount).toBe(2)
    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(1)
    expect(state.capturedActions?.[0]?.localIndex).toBe(0)
    // All three tool result messages exist and are in original order.
    const toolMsgs = state.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.map((m) => m.toolCallId)).toEqual(['r1', 'c1', 'r2'])
  })

  it('captureMint predicted output is what the model sees', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: [] },
        requiresApproval: true,
        captureMint: (args, ctx) => ({
          id: `temp_${ctx.localIndex}`,
          title: args.title,
        }),
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        {
          content: 'plan',
          toolCalls: [makeToolCall('c1', 'create_task', { title: 'review draft' })],
        },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(1)
    const captured = state.capturedActions?.[0]
    expect(captured?.predictedOutput).toEqual({
      _captured: true,
      id: 'temp_0',
      title: 'review draft',
    })
    const toolMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c1')
    expect(JSON.parse(toolMsg?.content ?? '{}')).toEqual({
      _captured: true,
      id: 'temp_0',
      title: 'review draft',
    })
  })

  it('no captureMint falls back to placeholder', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'transition_stage',
        description: 't',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        { content: 'plan', toolCalls: [makeToolCall('t1', 'transition_stage')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions?.[0]?.predictedOutput).toEqual({
      _captured: true,
      status: 'queued_for_approval',
    })
  })

  it('chained captured calls — temp-ID arg references are retained verbatim (apply-time substitution is not capture-time concern)', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: [] },
        requiresApproval: true,
        captureMint: (_args, ctx) => ({ id: `temp_${ctx.localIndex}` }),
        execute: noopExecute,
      },
      {
        name: 'update_task',
        description: 'u',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['id'],
        },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        // Turn 1: model captures create_task → sees temp_0 in result.
        {
          content: 'creating',
          toolCalls: [makeToolCall('c1', 'create_task', { title: 'A' })],
        },
        // Turn 2: model "reads" temp_0 from history and chains an update_task.
        {
          content: 'updating',
          toolCalls: [
            makeToolCall('u1', 'update_task', {
              id: 'temp_0',
              note: 'priority',
            }),
          ],
        },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(2)
    expect(state.capturedActions?.[0]?.localIndex).toBe(0)
    expect(state.capturedActions?.[1]?.localIndex).toBe(1)
    expect(state.capturedActions?.[1]?.args).toEqual({ id: 'temp_0', note: 'priority' })
  })

  it('schema-validation failure on captured tool emits tool-error and does NOT capture', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'c',
        parameters: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        // First call: missing required `title`.
        { content: 'oops', toolCalls: [makeToolCall('c1', 'create_task', {})] },
        // Retry with valid args.
        {
          content: 'fixed',
          toolCalls: [makeToolCall('c2', 'create_task', { title: 'good' })],
        },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    // Only the second call should have been captured.
    expect(state.capturedActions).toHaveLength(1)
    expect(state.capturedActions?.[0]?.toolCallId).toBe('c2')

    const errorMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c1')
    expect(errorMsg).toBeDefined()
    expect(JSON.parse(errorMsg?.content ?? '{}')).toMatchObject({
      error: expect.stringMatching(/Missing required parameters: title/),
    })
  })

  it('capture-mode terminates cleanly when the responder stops calling tools', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        // Iteration 1: capture the approval-required tool.
        { content: '', toolCalls: [makeToolCall('c1', 'create_task')] },
        // Iteration 2: no tool calls — implicit termination, content becomes the final message.
        { content: 'all set', toolCalls: [] },
      ],
    })

    const events = await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(1)
    expect(state.waitingForApproval).toBeFalsy()
    expect(state.pendingToolCall).toBeUndefined()
    const finalEvt = events.find((e) => e.type === 'final-message')
    expect(finalEvt).toBeDefined()
    expect((finalEvt as { content?: string }).content).toBe('all set')
  })

  it('captureMint that throws falls back to placeholder (best-effort)', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'flaky',
        description: 'f',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        captureMint: () => {
          throw new Error('boom')
        },
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        { content: '', toolCalls: [makeToolCall('f1', 'flaky')] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions).toHaveLength(1)
    expect(state.capturedActions?.[0]?.predictedOutput).toEqual({
      _captured: true,
      status: 'queued_for_approval',
    })
  })

  it('tool.summary fallback produces a readable default when not provided', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        { content: '', toolCalls: [makeToolCall('c1', 'create_task', { title: 'X' })] },
        { content: 'done', toolCalls: [] },
      ],
    })

    await drain(engine.submitMessage('go'))

    const summary = engine.getState().capturedActions?.[0]?.summary
    expect(summary).toBe('create_task({"title":"X"})')
  })

  it('localIndex is monotonic across turns within one engine run', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'create_task',
        description: 'c',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresApproval: true,
        captureMint: (_args, ctx) => ({ id: `temp_${ctx.localIndex}` }),
        execute: noopExecute,
      },
    ]

    const engine = buildEngine({
      approvalMode: 'capture',
      tools,
      turns: [
        { content: 't1', toolCalls: [makeToolCall('c1', 'create_task')] },
        { content: 't2', toolCalls: [makeToolCall('c2', 'create_task')] },
        { content: 't3', toolCalls: [makeToolCall('c3', 'create_task')] },
        { content: 'done', toolCalls: [] },
      ],
      maxIterations: 6,
    })

    await drain(engine.submitMessage('go'))

    const state = engine.getState()
    expect(state.capturedActions?.map((c) => c.localIndex)).toEqual([0, 1, 2])
    expect(state.capturedActions?.map((c) => (c.predictedOutput as { id: string }).id)).toEqual([
      'temp_0',
      'temp_1',
      'temp_2',
    ])
  })
})
