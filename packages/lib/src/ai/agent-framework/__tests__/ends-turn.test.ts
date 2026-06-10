// packages/lib/src/ai/agent-framework/__tests__/ends-turn.test.ts

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
  TextPart,
  ToolCallPart,
} from '../types'

/**
 * `endsTurn` terminal tools — an iteration whose tool calls are ALL endsTurn
 * tools and ALL succeed finalizes the turn instead of re-invoking the LLM —
 * plus the identical-args success-streak backstop.
 */

const ZERO: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

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

interface ScriptedTurn {
  content: string
  toolCalls: ToolCall[]
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  tools: AgentToolDefinition[]
  approvalMode?: 'pause' | 'capture'
  postProcessFinalContent?: AgentDomainConfig['postProcessFinalContent']
}) {
  let llmCalls = 0
  const callModel = async function* (_params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[llmCalls++] ?? { content: '', toolCalls: [] }
    yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls, usage: ZERO }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools,
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: 8,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
    ...(opts.postProcessFinalContent
      ? { postProcessFinalContent: opts.postProcessFinalContent }
      : {}),
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
    domainConfig,
    callModel,
    ...(opts.approvalMode ? { approvalMode: opts.approvalMode } : {}),
  }

  return { engine: new AgentEngine(config), getLlmCalls: () => llmCalls }
}

const chipsTool = (overrides?: Partial<AgentToolDefinition>): AgentToolDefinition => ({
  name: 'suggest_chips',
  displayName: 'Suggest chips',
  description: 'UI-only chips',
  parameters: { type: 'object', properties: {} },
  endsTurn: true,
  execute: async () => ({ success: true, output: { chips: ['a', 'b'] } }),
  ...overrides,
})

const writeTool = (overrides?: Partial<AgentToolDefinition>): AgentToolDefinition => ({
  name: 'write_thing',
  displayName: 'Write thing',
  description: 'A regular tool',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: true, output: { ok: true } }),
  ...overrides,
})

function collectParts(messages: Array<{ role: string }>) {
  const toolParts: ToolCallPart[] = []
  const textParts: TextPart[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const p of (msg as AssistantSessionMessage).parts ?? []) {
      if (p.type === 'tool_call') toolParts.push(p)
      if (p.type === 'text') textParts.push(p)
    }
  }
  return { toolParts, textParts }
}

describe('endsTurn terminal tools', () => {
  it('finalizes after one LLM call when the iteration is text + a successful endsTurn tool', async () => {
    const { engine, getLlmCalls } = buildEngine({
      turns: [
        { content: 'All done!', toolCalls: [makeToolCall('c1', 'suggest_chips')] },
        // Would be iteration 2 — must never be reached.
        { content: 'SHOULD NOT RUN', toolCalls: [] },
      ],
      tools: [chipsTool()],
    })

    const events = await drain(engine.submitMessage('go'))

    expect(getLlmCalls()).toBe(1)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)

    const { toolParts, textParts } = collectParts(engine.getState().messages)
    expect(toolParts).toHaveLength(1)
    expect(toolParts[0]?.status).toBe('completed')
    expect(textParts.map((p) => p.text).join('')).toBe('All done!')
  })

  it('does NOT finalize a mixed iteration (endsTurn + regular tool)', async () => {
    const { engine, getLlmCalls } = buildEngine({
      turns: [
        {
          content: 'Working…',
          toolCalls: [makeToolCall('c1', 'write_thing'), makeToolCall('c2', 'suggest_chips')],
        },
        { content: 'Now done.', toolCalls: [] },
      ],
      tools: [chipsTool(), writeTool()],
    })

    const events = await drain(engine.submitMessage('go'))

    // The loop continued so the model saw the write result; the no-tool
    // response on iteration 2 ended the turn normally.
    expect(getLlmCalls()).toBe(2)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)
  })

  it('does NOT finalize when the endsTurn tool fails — the model gets the error', async () => {
    const { engine, getLlmCalls } = buildEngine({
      turns: [
        { content: 'Done?', toolCalls: [makeToolCall('c1', 'suggest_chips')] },
        { content: 'Recovered without chips.', toolCalls: [] },
      ],
      tools: [
        chipsTool({
          execute: async () => ({ success: false, output: null, error: 'bad chip args' }),
        }),
      ],
    })

    const events = await drain(engine.submitMessage('go'))

    expect(getLlmCalls()).toBe(2)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)

    const { toolParts } = collectParts(engine.getState().messages)
    expect(toolParts[0]?.status).toBe('error')
  })

  it('runs postProcessFinalContent on the endsTurn finalize path', async () => {
    const { engine } = buildEngine({
      turns: [{ content: 'final text', toolCalls: [makeToolCall('c1', 'suggest_chips')] }],
      tools: [chipsTool()],
      postProcessFinalContent: (content) => ({ content: content.toUpperCase() }),
    })

    await drain(engine.submitMessage('go'))

    const { textParts } = collectParts(engine.getState().messages)
    expect(textParts.map((p) => p.text).join('')).toBe('FINAL TEXT')
  })

  it('finalizes in capture mode too (endsTurn tool executes rather than being captured)', async () => {
    const { engine, getLlmCalls } = buildEngine({
      turns: [
        { content: 'Done (sim).', toolCalls: [makeToolCall('c1', 'suggest_chips')] },
        { content: 'SHOULD NOT RUN', toolCalls: [] },
      ],
      tools: [chipsTool()],
      approvalMode: 'capture',
    })

    const events = await drain(engine.submitMessage('go'))

    expect(getLlmCalls()).toBe(1)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)

    const { toolParts } = collectParts(engine.getState().messages)
    expect(toolParts[0]?.status).toBe('completed')
  })
})

describe('same-tool identical-args success-streak guard', () => {
  const repeated: ScriptedTurn = {
    content: 'Wrapped up!',
    toolCalls: [makeToolCall('c', 'write_thing', { a: 1, b: 2 })],
  }

  it('finalizes gracefully (no turn-error) after 3 identical-args successes and dedupes the repeated text', async () => {
    const { engine, getLlmCalls } = buildEngine({
      turns: [repeated, repeated, repeated, { content: 'SHOULD NOT RUN', toolCalls: [] }],
      tools: [writeTool()],
    })

    const events = await drain(engine.submitMessage('go'))

    expect(getLlmCalls()).toBe(3)
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)

    // The identical wrap-up streamed once per round — the final reply must
    // carry it once, not three times.
    const { textParts, toolParts } = collectParts(engine.getState().messages)
    expect(textParts.map((p) => p.text).join('')).toBe('Wrapped up!')
    // The executed calls themselves stay in the persisted shape.
    expect(toolParts).toHaveLength(3)
  })

  it('does not fire when args differ between rounds', async () => {
    const turns: ScriptedTurn[] = [1, 2, 3, 4].map((i) => ({
      content: `step ${i}`,
      toolCalls: [makeToolCall(`c${i}`, 'write_thing', { step: i })],
    }))
    const { engine, getLlmCalls } = buildEngine({
      turns: [...turns, { content: 'done', toolCalls: [] }],
      tools: [writeTool()],
    })

    await drain(engine.submitMessage('go'))

    // All 4 distinct-args rounds ran, then the no-tool round ended the turn.
    expect(getLlmCalls()).toBe(5)
  })

  it('does not fire when iterations carry no assistant text (poll-loop shape)', async () => {
    const silent: ScriptedTurn = {
      content: '',
      toolCalls: [makeToolCall('c', 'write_thing', { poll: true })],
    }
    const { engine, getLlmCalls } = buildEngine({
      turns: [silent, silent, silent, silent, { content: 'finished', toolCalls: [] }],
      tools: [writeTool()],
    })

    await drain(engine.submitMessage('go'))

    expect(getLlmCalls()).toBe(5)
  })
})
