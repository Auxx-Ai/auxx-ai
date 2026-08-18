// packages/lib/src/ai/agent-framework/__tests__/iteration-cap-close.test.ts

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
} from '../types'

/**
 * D10 — a turn that runs the iteration cap out must still SAY something.
 *
 * The cap-exhausted path used to fall straight through to the abnormal-exit
 * commit: parts persisted, no `assistant-message-finished`, no reply. The user
 * saw a turn that did a lot of visible work and then went silent. One real
 * turn ended exactly that way. The close is one LLM call with tools withheld,
 * so the model cannot start more work — the only thing it can emit is the
 * summary.
 */

const ZERO: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

const makeToolCall = (id: string, name: string): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
})

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

const busyTool: AgentToolDefinition = {
  name: 'poke',
  displayName: 'Poke',
  description: 'Never finishes anything',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: true, output: { ok: true } }),
}

function buildEngine(opts: {
  maxIterations: number
  onClosingCall?: () => void
  failClose?: boolean
}) {
  const calls: LLMCallParams[] = []
  // The model NEVER stops calling tools — the only way out is the cap.
  const callModel = async function* (params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    calls.push(params)
    const toolsWithheld = params.tools === undefined
    if (toolsWithheld) {
      opts.onClosingCall?.()
      if (opts.failClose) throw new Error('closing call exploded')
      yield { type: 'text-delta', delta: 'Here is what I got done: ' }
      yield { type: 'text-delta', delta: 'two nodes fixed, one still needs you.' }
      yield {
        type: 'done',
        content: 'Here is what I got done: two nodes fixed, one still needs you.',
        toolCalls: [],
        usage: ZERO,
      }
      return
    }
    yield { type: 'done', content: '', toolCalls: [makeToolCall('c1', 'poke')], usage: ZERO }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: [busyTool],
    buildMessages: async () => [{ role: 'user', content: 'go' }],
    processResult: async (_c, _tc, state) => state,
    maxIterations: opts.maxIterations,
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

  return { engine: new AgentEngine(config), calls }
}

function finalText(messages: Array<{ role: string }>): string {
  let out = ''
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const p of (msg as AssistantSessionMessage).parts ?? []) {
      if (p.type === 'text') out += (p as TextPart).text
    }
  }
  return out
}

describe('iteration cap graceful close', () => {
  it('ends a cap-exhausted turn with a real assistant reply', async () => {
    const { engine } = buildEngine({ maxIterations: 3 })

    const events = await drain(engine.submitMessage('go'))

    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(true)
    expect(finalText(engine.getState().messages)).toContain('two nodes fixed')
  })

  it('withholds tools on the closing call, so no further work is expressible', async () => {
    const { engine, calls } = buildEngine({ maxIterations: 3 })

    await drain(engine.submitMessage('go'))

    // Every in-loop call offers tools; the last one must not.
    expect(calls.length).toBe(4)
    for (const c of calls.slice(0, 3)) expect(c.tools).toBeDefined()
    expect(calls.at(-1)?.tools).toBeUndefined()
    // And it carries the nudge telling the model why it has none.
    const nudge = calls.at(-1)?.messages.at(-1)
    expect(nudge?.role).toBe('system')
    expect(String(nudge?.content)).toContain('run out of tool steps')
  })

  it('does NOT fire the closing call on a turn that ended naturally', async () => {
    let closingCalls = 0
    // maxIterations high enough that the tool loop is never the exit — but this
    // model always calls tools, so raise the cap and assert by call shape.
    const { engine, calls } = buildEngine({
      maxIterations: 2,
      onClosingCall: () => {
        closingCalls++
      },
    })
    await drain(engine.submitMessage('go'))
    expect(closingCalls).toBe(1)
    expect(calls.filter((c) => c.tools === undefined)).toHaveLength(1)
  })

  it('falls back to the silent commit when the closing call itself fails', async () => {
    const { engine } = buildEngine({ maxIterations: 2, failClose: true })

    // Must not throw or emit turn-error: a failed close can only fail to ADD a
    // reply, never break a turn that already did its work.
    const events = await drain(engine.submitMessage('go'))

    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    expect(events.some((e) => e.type === 'assistant-message-finished')).toBe(false)
  })
})
