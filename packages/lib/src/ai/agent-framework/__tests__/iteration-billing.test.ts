// packages/lib/src/ai/agent-framework/__tests__/iteration-billing.test.ts

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
} from '../types'

/**
 * Per-iteration billing context lives on the assistant message's
 * `metadata.iterations` AND on the `assistant-message-finished` event.
 * Each entry represents one LLM call within the turn, carrying provider,
 * model, providerType, credentialSource, and usage — enough for billing
 * consumers to apply SYSTEM-vs-CUSTOM credit gating.
 */

const USAGE_500: UsageMetrics = {
  prompt_tokens: 200,
  completion_tokens: 300,
  total_tokens: 500,
}
const USAGE_300: UsageMetrics = {
  prompt_tokens: 100,
  completion_tokens: 200,
  total_tokens: 300,
}
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
  usage?: UsageMetrics
  providerType?: 'SYSTEM' | 'CUSTOM'
  credentialSource?: 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED'
}

function buildEngine(opts: {
  turns: ScriptedTurn[]
  tools?: AgentToolDefinition[]
  provider?: string
  model?: string
}) {
  let turnIdx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const turn = opts.turns[turnIdx++] ?? { content: '' }
    yield {
      type: 'done',
      content: turn.content,
      toolCalls: turn.toolCalls ?? [],
      usage: turn.usage ?? ZERO_USAGE,
      ...(turn.providerType ? { providerType: turn.providerType } : {}),
      ...(turn.credentialSource ? { credentialSource: turn.credentialSource } : {}),
    }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: opts.tools ?? [],
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: 6,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: opts.model ?? 'claude-opus-4-7',
    defaultProvider: opts.provider ?? 'anthropic',
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    db: {} as never,
    domainConfig,
    callModel,
  }

  return new AgentEngine(config)
}

describe('per-iteration billing — IterationUsage on metadata + event', () => {
  it('single-call turn produces exactly one iteration entry', async () => {
    const engine = buildEngine({
      turns: [
        {
          content: 'Hello!',
          usage: USAGE_500,
          providerType: 'SYSTEM',
          credentialSource: 'SYSTEM',
        },
      ],
    })

    const events = await drain(engine.submitMessage('hi'))

    const finished = events.find((e) => e.type === 'assistant-message-finished')
    expect(finished).toBeDefined()
    if (finished?.type !== 'assistant-message-finished') throw new Error('no finished')

    expect(finished.iterations).toBeDefined()
    expect(finished.iterations!.length).toBe(1)
    const it0 = finished.iterations![0]!
    expect(it0.iteration).toBe(1)
    expect(it0.provider).toBe('anthropic')
    expect(it0.model).toBe('claude-opus-4-7')
    expect(it0.providerType).toBe('SYSTEM')
    expect(it0.credentialSource).toBe('SYSTEM')
    expect(it0.usage).toEqual(USAGE_500)

    // Same data persisted on metadata.
    const msg = engine
      .getState()
      .messages.find(
        (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === finished.messageId
      )!
    expect(msg.metadata?.iterations).toEqual(finished.iterations)
  })

  it('multi-iteration turn (tool → text) produces two iteration entries', async () => {
    const search: AgentToolDefinition = {
      name: 'search',
      displayName: 'Search',
      description: 's',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true, output: { hits: [] } }),
    }
    const engine = buildEngine({
      tools: [search],
      turns: [
        {
          content: 'Looking…',
          toolCalls: [tc('tc_1', 'search')],
          usage: USAGE_500,
          providerType: 'SYSTEM',
        },
        {
          content: 'Nothing found.',
          usage: USAGE_300,
          providerType: 'SYSTEM',
        },
      ],
    })

    const events = await drain(engine.submitMessage('find x'))
    const finished = events.find((e) => e.type === 'assistant-message-finished')
    if (finished?.type !== 'assistant-message-finished') throw new Error('no finished')

    expect(finished.iterations).toBeDefined()
    expect(finished.iterations!.length).toBe(2)
    expect(finished.iterations![0]!.iteration).toBe(1)
    expect(finished.iterations![0]!.usage).toEqual(USAGE_500)
    expect(finished.iterations![1]!.iteration).toBe(2)
    expect(finished.iterations![1]!.usage).toEqual(USAGE_300)
  })

  it('skips iterations with zero usage (cached / no-token calls)', async () => {
    const engine = buildEngine({
      turns: [
        {
          content: 'cached response',
          usage: ZERO_USAGE,
          providerType: 'SYSTEM',
        },
      ],
    })

    const events = await drain(engine.submitMessage('hi'))
    const finished = events.find((e) => e.type === 'assistant-message-finished')
    if (finished?.type !== 'assistant-message-finished') throw new Error('no finished')

    // No iteration entry was pushed; the field is therefore absent.
    expect(finished.iterations).toBeUndefined()
  })

  it('CUSTOM providerType is preserved verbatim for BYOK credit gating', async () => {
    const engine = buildEngine({
      turns: [
        {
          content: 'byok response',
          usage: USAGE_500,
          providerType: 'CUSTOM',
          credentialSource: 'CUSTOM',
        },
      ],
    })

    const events = await drain(engine.submitMessage('hi'))
    const finished = events.find((e) => e.type === 'assistant-message-finished')
    if (finished?.type !== 'assistant-message-finished') throw new Error('no finished')

    const it0 = finished.iterations?.[0]
    expect(it0?.providerType).toBe('CUSTOM')
    expect(it0?.credentialSource).toBe('CUSTOM')
  })

  it('pause path emits assistant-message-paused with iterations so billing fires before suspension', async () => {
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
        {
          content: 'will write',
          toolCalls: [tc('tc_1', 'writer')],
          usage: USAGE_500,
          providerType: 'SYSTEM',
        },
      ],
    })

    const events = await drain(engine.submitMessage('go'))
    // No `finished` on the suspending path — the message stays open.
    expect(events.find((e) => e.type === 'assistant-message-finished')).toBeUndefined()
    const paused = events.find((e) => e.type === 'assistant-message-paused')
    expect(paused).toBeDefined()
    if (paused?.type !== 'assistant-message-paused') throw new Error('no paused')
    expect(paused.iterations).toBeDefined()
    expect(paused.iterations!.length).toBe(1)
    expect(paused.iterations![0]!.usage).toEqual(USAGE_500)
  })
})
