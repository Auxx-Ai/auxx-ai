// packages/lib/src/ai/agent-framework/__tests__/query-loop-validation.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  AssistantSessionMessage,
  LLMCallParams,
  LLMStreamEvent,
  ToolCallPart,
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
          displayName: 'Auto tool',
          description: 'auto',
          parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
          execute: async () => ({ success: true, output: { ok: true } }),
        },
        {
          name: 'risky_tool',
          displayName: 'Risky tool',
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
      // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
      db: {} as any,
      domainConfig,
      callModel,
    }

    const engine = new AgentEngine(config)
    await drain(engine.submitMessage('go'))

    const state = engine.getState()

    // BOTH emitted calls survive into state, each with a resolved status. The
    // branch used to drop the sibling instead; keeping it and marking it
    // skipped is what makes the wire format well-formed AND tells the model
    // why the sibling never ran.
    const allToolCallParts: ToolCallPart[] = []
    for (const msg of state.messages) {
      if (msg.role !== 'assistant') continue
      const m = msg as AssistantSessionMessage
      for (const p of m.parts ?? []) {
        if (p.type === 'tool_call') allToolCallParts.push(p)
      }
    }
    expect(allToolCallParts).toHaveLength(2)

    const approvalPart = allToolCallParts.find((p) => p.toolCallId === 'call_appr')
    expect(approvalPart?.name).toBe('risky_tool')
    expect(approvalPart?.status).toBe('error')
    expect(approvalPart?.error).toMatch(/Missing required parameters: target/)

    const siblingPart = allToolCallParts.find((p) => p.toolCallId === 'call_auto')
    expect(siblingPart?.name).toBe('auto_tool')
    expect(siblingPart?.status).toBe('error')
    expect(siblingPart?.error).toMatch(/Skipped/)

    // The actual invariant: every emitted tool_call resolves to a terminal
    // status, so `partsToWireFormat` emits a tool message for each and no
    // tool_call_id is left dangling on the next LLM call.
    const unresolved = allToolCallParts.filter(
      (p) => p.status !== 'completed' && p.status !== 'error' && p.status !== 'rejected'
    )
    expect(unresolved).toHaveLength(0)
  })
})
