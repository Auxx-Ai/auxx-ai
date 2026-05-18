// packages/lib/src/ai/agent-framework/__tests__/parts-builder.test.ts

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
  ContentPart,
  LLMCallParams,
  LLMStreamEvent,
  TextPart,
  ThinkingPart,
  ToolCallPart,
} from '../types'

/**
 * End-to-end coverage of query-loop's delta → parts state machine.
 *
 * The query-loop owns the mapping from streaming LLM adapter events
 * (`text-delta` / `reasoning-delta` / tool calls / `done`) onto a parts[]
 * array that lives on a single assistant message. These tests drive a
 * scripted `callModel` to verify the resulting parts shape across the major
 * shapes the model can take.
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
  /** Streaming events to yield BEFORE the terminal `done` event. */
  stream?: LLMStreamEvent[]
  /** Terminal content + tool calls (yielded as the `done` event). */
  content: string
  toolCalls?: ToolCall[]
  /** Terminal reasoning_content sent on the `done` event (provider-side). */
  reasoning_content?: string
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  tools?: AgentToolDefinition[]
  maxIterations?: number
}) {
  let turnIdx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[turnIdx++] ?? { content: '' }
    for (const ev of turn.stream ?? []) yield ev
    yield {
      type: 'done',
      content: turn.content,
      toolCalls: turn.toolCalls ?? [],
      usage: ZERO_USAGE,
      ...(turn.reasoning_content !== undefined
        ? { reasoning_content: turn.reasoning_content }
        : {}),
    }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools ?? [],
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
    // biome-ignore lint/suspicious/noExplicitAny: db handle unused in tests
    db: {} as any,
    domainConfig,
    callModel,
  }

  return new AgentEngine(config)
}

function trailingAssistant(engine: AgentEngine): AssistantSessionMessage | undefined {
  const msgs = engine.getState().messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m?.role === 'assistant') return m as AssistantSessionMessage
  }
  return undefined
}

const isText = (p: ContentPart): p is TextPart => p.type === 'text'
const isThinking = (p: ContentPart): p is ThinkingPart => p.type === 'thinking'
const isToolCall = (p: ContentPart): p is ToolCallPart => p.type === 'tool_call'

const noopExecute: AgentToolDefinition['execute'] = async () => ({
  success: true,
  output: { ran: true },
})

describe('query-loop parts builder', () => {
  it('text-only turn collapses streamed deltas into a single text part', async () => {
    const engine = buildEngine({
      turns: [
        {
          stream: [
            { type: 'text-delta', delta: 'Hello ' },
            { type: 'text-delta', delta: 'world' },
            { type: 'text-delta', delta: '!' },
          ],
          content: 'Hello world!',
        },
      ],
    })

    await drain(engine.submitMessage('hi'))
    const assistant = trailingAssistant(engine)!
    const textParts = assistant.parts.filter(isText)
    expect(textParts).toHaveLength(1)
    expect(textParts[0]?.text).toBe('Hello world!')
    expect(assistant.parts.filter(isToolCall)).toHaveLength(0)
    expect(assistant.parts.filter(isThinking)).toHaveLength(0)
  })

  it('thinking-only turn collapses streamed reasoning into a single thinking part', async () => {
    const engine = buildEngine({
      turns: [
        {
          stream: [
            { type: 'reasoning-delta', delta: 'Let me think… ' },
            { type: 'reasoning-delta', delta: 'okay.' },
          ],
          content: '',
        },
        // Second pass: a final no-tool reply so the loop terminates.
        { content: 'done' },
      ],
    })

    await drain(engine.submitMessage('hi'))
    const assistant = trailingAssistant(engine)!
    const thinkingParts = assistant.parts.filter(isThinking)
    // Implementations may either emit a single thinking part (preferred — see
    // answers §A.3) or one per reasoning span; the contract is that the
    // concatenated text matches what the model produced.
    expect(thinkingParts.length).toBeGreaterThanOrEqual(1)
    expect(thinkingParts.map((p) => p.text).join('')).toBe('Let me think… okay.')
  })

  it('text → tool → text produces interleaved parts in order', async () => {
    const lookup: AgentToolDefinition = {
      name: 'lookup',
      description: 'l',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true, output: { rows: 7 } }),
    }
    const engine = buildEngine({
      tools: [lookup],
      turns: [
        {
          // Iteration 1: prose then a tool call.
          stream: [
            { type: 'text-delta', delta: 'Sure! ' },
            { type: 'text-delta', delta: 'Looking…' },
          ],
          content: 'Sure! Looking…',
          toolCalls: [tc('c1', 'lookup')],
        },
        // Iteration 2: post-tool prose, no more tools.
        {
          stream: [{ type: 'text-delta', delta: 'Found 7 rows.' }],
          content: 'Found 7 rows.',
        },
      ],
    })

    await drain(engine.submitMessage('go'))

    const assistant = trailingAssistant(engine)!
    // Single message per turn — both iterations append to the same parts[].
    const types = assistant.parts.map((p) => p.type)
    // First content kind must be text (the pre-tool prose).
    expect(types[0]).toBe('text')
    // A tool_call appears before any post-tool prose.
    const firstToolIdx = types.indexOf('tool_call')
    expect(firstToolIdx).toBeGreaterThan(-1)
    const postToolText = assistant.parts.slice(firstToolIdx + 1).find(isText)
    expect(postToolText?.text).toContain('Found 7 rows.')

    const toolCallParts = assistant.parts.filter(isToolCall)
    expect(toolCallParts).toHaveLength(1)
    expect(toolCallParts[0]?.status).toBe('completed')
    expect(toolCallParts[0]?.output).toEqual({ rows: 7 })
  })

  it('multiple tool calls in one turn produce one tool_call part each, in order', async () => {
    const tools: AgentToolDefinition[] = [
      {
        name: 'a',
        description: 'a',
        parameters: { type: 'object', properties: {} },
        execute: noopExecute,
      },
      {
        name: 'b',
        description: 'b',
        parameters: { type: 'object', properties: {} },
        execute: noopExecute,
      },
      {
        name: 'c',
        description: 'c',
        parameters: { type: 'object', properties: {} },
        execute: noopExecute,
      },
    ]
    const engine = buildEngine({
      tools,
      turns: [
        {
          content: '',
          toolCalls: [tc('t1', 'a'), tc('t2', 'b'), tc('t3', 'c')],
        },
        { content: 'wrap up' },
      ],
    })

    await drain(engine.submitMessage('go'))

    const assistant = trailingAssistant(engine)!
    const toolCallParts = assistant.parts.filter(isToolCall)
    expect(toolCallParts.map((p) => p.toolCallId)).toEqual(['t1', 't2', 't3'])
    expect(toolCallParts.map((p) => p.name)).toEqual(['a', 'b', 'c'])
    expect(toolCallParts.every((p) => p.status === 'completed')).toBe(true)
  })

  it('interleaved thinking + tools: thinking precedes the tool that consumed it', async () => {
    const lookup: AgentToolDefinition = {
      name: 'lookup',
      description: 'l',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: noopExecute,
    }
    const engine = buildEngine({
      tools: [lookup],
      turns: [
        {
          stream: [{ type: 'reasoning-delta', delta: 'I need to look this up.' }],
          content: '',
          toolCalls: [tc('c1', 'lookup')],
        },
        {
          stream: [
            { type: 'reasoning-delta', delta: 'Now I should reply.' },
            { type: 'text-delta', delta: 'Here you go.' },
          ],
          content: 'Here you go.',
        },
      ],
    })

    await drain(engine.submitMessage('go'))

    const assistant = trailingAssistant(engine)!
    const parts = assistant.parts
    const firstToolIdx = parts.findIndex(isToolCall)
    expect(firstToolIdx).toBeGreaterThan(0)
    // A thinking part exists before the tool call.
    const preToolThinking = parts.slice(0, firstToolIdx).filter(isThinking)
    expect(preToolThinking.length).toBeGreaterThanOrEqual(1)
    expect(preToolThinking.map((p) => p.text).join('')).toContain('look this up')
    // And a thinking part exists between the tool and the final text.
    const lastTextIdx = parts.length - 1
    const between = parts.slice(firstToolIdx + 1, lastTextIdx).filter(isThinking)
    expect(between.map((p) => p.text).join('')).toContain('reply')
  })

  it('terminal-only reasoning_content falls back to a thinking part when no streaming deltas arrived', async () => {
    // Per answers §A.3: trust streaming deltas if any arrived; otherwise fall
    // back to the terminal `reasoning_content` on the `done` event.
    const engine = buildEngine({
      turns: [
        {
          // No streaming deltas — terminal-only reasoning (DeepSeek shape).
          content: 'Computed answer.',
          reasoning_content: 'I reasoned about it carefully.',
        },
      ],
    })

    await drain(engine.submitMessage('go'))

    const assistant = trailingAssistant(engine)!
    const thinkingParts = assistant.parts.filter(isThinking)
    expect(thinkingParts).toHaveLength(1)
    expect(thinkingParts[0]?.text).toContain('reasoned about it carefully')

    const textParts = assistant.parts.filter(isText)
    expect(textParts.map((p) => p.text).join('')).toBe('Computed answer.')
  })

  it('streamed reasoning deltas are trusted over terminal reasoning_content (no double-count)', async () => {
    const engine = buildEngine({
      turns: [
        {
          stream: [
            { type: 'reasoning-delta', delta: 'streamed reasoning' },
            { type: 'text-delta', delta: 'done.' },
          ],
          // Provider also sends a terminal duplicate — must be ignored.
          reasoning_content: 'streamed reasoning',
          content: 'done.',
        },
      ],
    })

    await drain(engine.submitMessage('go'))

    const assistant = trailingAssistant(engine)!
    const thinkingText = assistant.parts
      .filter(isThinking)
      .map((p) => p.text)
      .join('')
    // The streamed deltas land once; the terminal duplicate is dropped.
    expect(thinkingText).toBe('streamed reasoning')
  })
})
