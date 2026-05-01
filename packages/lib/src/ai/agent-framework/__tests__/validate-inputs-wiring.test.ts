// packages/lib/src/ai/agent-framework/__tests__/validate-inputs-wiring.test.ts

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

describe('validateInputs wiring — non-approval (read) tool', () => {
  it('rejects on validateInputs failure, emits tool-completed(success:false), skips execute', async () => {
    let executeCalls = 0
    const lookup = makeToolCall('call_1', 'lookup', { recordId: 'bad:bad:shape' })

    let turnIdx = 0
    const turns = [
      { content: '', toolCalls: [lookup] as ToolCall[] },
      { content: 'gave up', toolCalls: [] as ToolCall[] },
    ]
    const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
      const t = turns[turnIdx++] ?? { content: '', toolCalls: [] }
      yield { type: 'done', content: t.content, toolCalls: t.toolCalls, usage: ZERO_USAGE }
    }

    const agent: AgentDefinition = {
      name: 'agent',
      tools: [
        {
          name: 'lookup',
          description: 'lookup',
          parameters: {
            type: 'object',
            properties: { recordId: { type: 'string' } },
            required: ['recordId'],
          },
          validateInputs: async (args) => {
            const id = args.recordId as string
            if (id.split(':').length !== 2) {
              return { ok: false, error: `recordId '${id}' must be 2-part.` }
            }
            return { ok: true, args }
          },
          execute: async () => {
            executeCalls++
            return { success: true, output: { ran: true } }
          },
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
      // biome-ignore lint/suspicious/noExplicitAny: db handle unused in test
      db: {} as any,
      domainConfig,
      callModel,
    }

    const engine = new AgentEngine(config)
    const events = await drain(engine.submitMessage('go'))

    expect(executeCalls).toBe(0)

    const completed = events.find((e) => e.type === 'tool-completed' && e.toolCallId === 'call_1')
    expect(completed).toBeDefined()
    if (completed?.type === 'tool-completed') {
      expect(completed.result.success).toBe(false)
      expect(completed.result.error).toContain('must be 2-part')
    }

    const state = engine.getState()
    const toolMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_1')
    expect(toolMsg).toBeDefined()
    const parsed = JSON.parse(toolMsg?.content ?? '{}')
    expect(parsed.error).toContain('must be 2-part')
  })

  it('rewrites args before execute when validateInputs returns ok with new args', async () => {
    let receivedArgs: Record<string, unknown> | null = null
    const lookup = makeToolCall('call_1', 'lookup', { recordId: 'contacts:def_id:inst_id' })

    let turnIdx = 0
    const turns = [
      { content: '', toolCalls: [lookup] as ToolCall[] },
      { content: 'done', toolCalls: [] as ToolCall[] },
    ]
    const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
      const t = turns[turnIdx++] ?? { content: '', toolCalls: [] }
      yield { type: 'done', content: t.content, toolCalls: t.toolCalls, usage: ZERO_USAGE }
    }

    const agent: AgentDefinition = {
      name: 'agent',
      tools: [
        {
          name: 'lookup',
          description: 'lookup',
          parameters: { type: 'object', properties: { recordId: { type: 'string' } } },
          validateInputs: async (args) => {
            const parts = (args.recordId as string).split(':')
            if (parts.length === 3) {
              return {
                ok: true,
                args: { ...args, recordId: `${parts[1]}:${parts[2]}` },
                warnings: ['stripped slug prefix'],
              }
            }
            return { ok: true, args }
          },
          execute: async (args) => {
            receivedArgs = args
            return { success: true, output: { ran: true } }
          },
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

    const engine = new AgentEngine({
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      // biome-ignore lint/suspicious/noExplicitAny: db handle unused in test
      db: {} as any,
      domainConfig,
      callModel,
    })

    await drain(engine.submitMessage('go'))

    expect(receivedArgs).not.toBeNull()
    expect((receivedArgs as Record<string, unknown>).recordId).toBe('def_id:inst_id')
  })
})

describe('validateInputs wiring — approval-required tool, pre-pause', () => {
  it('rejects on validateInputs failure, never emits approval-required, persists synthetic error', async () => {
    let executeCalls = 0
    const writer = makeToolCall('call_1', 'writer', { target: 'bad:bad:shape' })

    let turnIdx = 0
    const turns = [
      { content: '', toolCalls: [writer] as ToolCall[] },
      { content: 'fixed', toolCalls: [] as ToolCall[] },
    ]
    const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
      const t = turns[turnIdx++] ?? { content: '', toolCalls: [] }
      yield { type: 'done', content: t.content, toolCalls: t.toolCalls, usage: ZERO_USAGE }
    }

    const agent: AgentDefinition = {
      name: 'agent',
      tools: [
        {
          name: 'writer',
          description: 'writer',
          parameters: {
            type: 'object',
            properties: { target: { type: 'string' } },
            required: ['target'],
          },
          requiresApproval: true,
          validateInputs: async (args) => {
            const id = args.target as string
            if (id.split(':').length !== 2) {
              return { ok: false, error: `target '${id}' must be 2-part.` }
            }
            return { ok: true, args }
          },
          execute: async () => {
            executeCalls++
            return { success: true, output: { ran: true } }
          },
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

    const engine = new AgentEngine({
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      // biome-ignore lint/suspicious/noExplicitAny: db handle unused in test
      db: {} as any,
      domainConfig,
      callModel,
    })
    const events = await drain(engine.submitMessage('go'))

    expect(executeCalls).toBe(0)

    // Pre-pause validation: NO approval-required emitted.
    const approval = events.find((e) => e.type === 'approval-required')
    expect(approval).toBeUndefined()

    // Synthetic tool message persisted, ready for the LLM's retry on the
    // next iteration.
    const state = engine.getState()
    const toolMsg = state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_1')
    expect(toolMsg).toBeDefined()
    const parsed = JSON.parse(toolMsg?.content ?? '{}')
    expect(parsed.error).toContain('must be 2-part')

    // Engine is not stuck waiting for approval.
    expect(state.waitingForApproval).toBeFalsy()
    expect(state.pendingToolCall).toBeUndefined()
  })

  it('rewrites approvalArgs and emits approval-required with the rewritten args', async () => {
    const writer = makeToolCall('call_1', 'writer', { target: 'contacts:def:inst' })

    let turnIdx = 0
    const turns = [{ content: '', toolCalls: [writer] as ToolCall[] }]
    const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
      const t = turns[turnIdx++] ?? { content: '', toolCalls: [] }
      yield { type: 'done', content: t.content, toolCalls: t.toolCalls, usage: ZERO_USAGE }
    }

    const agent: AgentDefinition = {
      name: 'agent',
      tools: [
        {
          name: 'writer',
          description: 'writer',
          parameters: { type: 'object', properties: { target: { type: 'string' } } },
          requiresApproval: true,
          validateInputs: async (args) => {
            const parts = (args.target as string).split(':')
            if (parts.length === 3) {
              return { ok: true, args: { ...args, target: `${parts[1]}:${parts[2]}` } }
            }
            return { ok: true, args }
          },
          execute: async () => ({ success: true, output: {} }),
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

    const engine = new AgentEngine({
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      // biome-ignore lint/suspicious/noExplicitAny: db handle unused in test
      db: {} as any,
      domainConfig,
      callModel,
    })

    const events = await drain(engine.submitMessage('go'))

    const approval = events.find((e) => e.type === 'approval-required')
    expect(approval).toBeDefined()
    if (approval?.type === 'approval-required') {
      expect(approval.args.target).toBe('def:inst')
    }
    const state = engine.getState()
    expect(state.pendingToolCall?.args.target).toBe('def:inst')
  })
})
