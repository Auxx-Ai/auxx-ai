// packages/lib/src/ai/agent-framework/__tests__/resume-missing-tool.test.ts

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
import { partsToWireFormat } from '../utils'

/**
 * §1.3 — when a continuation turn rebuilds a toolset that no longer contains
 * the paused tool, resume must NOT leave the part dangling. It settles the
 * part as an error (a valid tool_result projection) and clears the pending
 * pointer, so the session recovers instead of 400ing on every later turn.
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

function makeConfig(
  tools: AgentToolDefinition[],
  firstTurnToolCalls: ToolCall[] = []
): AgentEngineConfig {
  let turnIdx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    const toolCalls = turnIdx++ === 0 ? firstTurnToolCalls : []
    yield { type: 'done', content: '', toolCalls, usage: ZERO_USAGE }
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
    defaultModel: 'm',
    defaultProvider: 'p',
  }
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: db handle unused in tests
    db: {} as any,
    domainConfig,
    callModel,
  }
}

const writer: AgentToolDefinition = {
  name: 'writer',
  displayName: 'Writer',
  description: 'w',
  parameters: { type: 'object', properties: {}, required: [] },
  requiresApproval: true,
  execute: async () => ({ success: true, output: { ok: true } }),
}

describe('resume against a toolset missing the paused tool', () => {
  it('settles the part as error, clears pending, and emits tool-call-failed', async () => {
    // Turn 1: pause on `writer` with the full toolset.
    const paused = new AgentEngine(makeConfig([writer], [tc('tc_1', 'writer')]))
    await drain(paused.submitMessage('go'))
    const pausedState = paused.getState()
    expect(pausedState.pendingToolCall).toBeDefined()
    const { messageId, partIndex, toolCallId } = pausedState.pendingToolCall!

    // Continuation: rebuild the engine with a toolset that lost `writer`
    // (the page surface was dropped), carrying the paused state forward.
    const resumed = new AgentEngine(makeConfig([]), {
      messages: pausedState.messages,
      domainState: pausedState.domainState,
      waitingForApproval: pausedState.waitingForApproval,
      pendingToolCall: pausedState.pendingToolCall,
      currentRoute: pausedState.currentRoute,
    })

    const events = await drain(resumed.resume({ action: 'approve' }))

    // No turn-error that leaves the session wedged — a clean tool-call-failed.
    expect(events.some((e) => e.type === 'tool-call-failed')).toBe(true)

    const state = resumed.getState()
    expect(state.waitingForApproval).toBe(false)
    expect(state.pendingToolCall).toBeUndefined()

    // The part is settled as error (carries a tool_use id AND an error output).
    const msg = state.messages.find(
      (m): m is AssistantSessionMessage => m.role === 'assistant' && m.id === messageId
    )!
    const part = msg.parts[partIndex]
    expect(part?.type).toBe('tool_call')
    if (part?.type === 'tool_call') {
      expect(part.status).toBe('error')
      expect(part.toolCallId).toBe(toolCallId)
      expect(part.error).toMatch(/not found/)
    }

    // Critical: the message now projects a matching tool_result — no dangling
    // tool_use, so the next provider call won't 400.
    const wire = partsToWireFormat(msg.parts)
    expect(wire[0]?.tool_calls?.some((t) => t.id === toolCallId)).toBe(true)
    const toolResult = wire.find((w) => w.role === 'tool' && w.tool_call_id === toolCallId)
    expect(toolResult).toBeDefined()
  })
})
