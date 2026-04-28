// packages/lib/src/ai/agent-framework/__tests__/query-loop-validation.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  LLMCallParams,
  LLMStreamEvent,
} from '../types'

const ZERO_USAGE: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

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

describe('query-loop validation-error branch — sibling tool_call orphan regression', () => {
  it('persists assistant with toolCalls=[approvalTool] only when missing-params + sibling auto-tool', async () => {
    // Model emits both an auto-tool and an approval-tool with missing required args
    // in the same response. The validation-error branch synthesizes a tool result
    // for the approval tool only — without the rewrite, the auto-tool's
    // tool_call_id would be left dangling in state.messages.
    const auto = makeToolCall('call_auto', 'auto_tool', { x: 1 })
    const approval = makeToolCall('call_appr', 'risky_tool', {}) // missing required `target`

    let turnIdx = 0
    const turns = [
      // Iteration 1: emit both calls — triggers validation error on approval tool.
      { content: 'mixed', toolCalls: [auto, approval] as ToolCall[] },
      // Iteration 2: agent retries with valid args — return no tool calls to exit.
      { content: 'fixed', toolCalls: [] as ToolCall[] },
    ]
    const callModel = async function* (_params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
      const turn = turns[turnIdx++] ?? { content: '', toolCalls: [] }
      yield { type: 'done', content: turn.content, toolCalls: turn.toolCalls, usage: ZERO_USAGE }
    }

    const agent: AgentDefinition = {
      name: 'agent',
      tools: [
        {
          name: 'auto_tool',
          description: 'auto',
          parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
          execute: async () => ({ success: true, output: { ok: true } }),
        },
        {
          name: 'risky_tool',
          description: 'approval',
          parameters: {
            type: 'object',
            properties: { target: { type: 'string' } },
            required: ['target'], // approval tool emitted without this → validation error
          },
          requiresApproval: true,
          execute: async () => ({ success: true, output: { ran: true } }),
        },
      ],
      buildMessages: async () => [],
      processResult: async (_c, _tc, state) => state,
      maxIterations: 3,
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
      domainConfig,
      callModel,
    }

    const engine = new AgentEngine(config)
    await drain(engine.submitMessage('go'))

    const state = engine.getState()

    // The persisted assistant message from the validation-error branch must
    // carry toolCalls=[approvalTool] only — the sibling auto-tool was dropped.
    const persistedAssistant = state.messages.find(
      (m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
    )
    expect(persistedAssistant).toBeDefined()
    expect(persistedAssistant?.toolCalls).toHaveLength(1)
    expect(persistedAssistant?.toolCalls?.[0]?.id).toBe('call_appr')
    expect(persistedAssistant?.toolCalls?.[0]?.function.name).toBe('risky_tool')

    // The synthetic tool result must match the only persisted tool_call.
    const toolMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_appr')
    expect(toolMsg).toBeDefined()
    const parsed = JSON.parse(toolMsg?.content ?? '{}')
    expect(parsed.error).toMatch(/Missing required parameters: target/)

    // Critically: NO tool message exists for the dropped sibling tool_call_id,
    // and NO assistant message references call_auto. Together these mean the
    // next LLM call will not see a dangling tool_call_id.
    const orphanRefs = state.messages.filter(
      (m) =>
        (m.role === 'tool' && m.toolCallId === 'call_auto') ||
        (m.role === 'assistant' && m.toolCalls?.some((c) => c.id === 'call_auto'))
    )
    expect(orphanRefs).toHaveLength(0)
  })
})
