// packages/lib/src/ai/agent-framework/__tests__/continue-turn.test.ts

import { describe, expect, it } from 'vitest'
import type { UsageMetrics } from '../../clients/base/types'
import { AgentEngine } from '../engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentEvent,
  LLMCallParams,
  LLMStreamEvent,
} from '../types'

/**
 * `continueTurn` — the v9 procedure-stepper re-entry point: re-run the query loop
 * in the SAME customer turn with NO new user message and NO turn-state reset.
 */

const ZERO: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

function buildEngine(contents: string[], resetTurnDomainState = false) {
  let idx = 0
  const callModel = async function* (_p: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    yield { type: 'done', content: contents[idx++] ?? '', toolCalls: [], usage: ZERO }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: [],
    buildMessages: async () => [],
    processResult: async (_c, _tc, state) => state,
    maxIterations: 6,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'claude-opus-4-7',
    defaultProvider: 'anthropic',
    // Mirror the real kopilot reset: wipe a turn-scoped key on a fresh user
    // message. `continueTurn` must NOT invoke this.
    ...(resetTurnDomainState
      ? {
          resetTurnDomainState: (ds: Record<string, unknown>) => {
            const { __turnScoped, ...rest } = ds
            return rest
          },
        }
      : {}),
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    db: {} as never,
    domainConfig,
    callModel,
  }

  return new AgentEngine(config, { messages: [], domainState: { __turnScoped: 'keep-me' } })
}

describe('AgentEngine.continueTurn', () => {
  it('regenerates an assistant message WITHOUT appending a new user message', async () => {
    const engine = buildEngine(['first reply', 'second reply'])

    await drain(engine.submitMessage('hi'))
    let messages = engine.getState().messages
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])

    await drain(engine.continueTurn())
    messages = engine.getState().messages
    // One more assistant message, NO second user message.
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('does NOT run resetTurnDomainState (turn-scoped state survives), unlike submitMessage', async () => {
    // submitMessage runs the reset → the turn-scoped key is dropped.
    const viaSubmit = buildEngine(['a'], /* resetTurnDomainState */ true)
    await drain(viaSubmit.submitMessage('hi'))
    expect(viaSubmit.getState().domainState.__turnScoped).toBeUndefined()

    // continueTurn skips the reset → the same key survives the re-drain.
    const viaContinue = buildEngine(['b'], /* resetTurnDomainState */ true)
    await drain(viaContinue.continueTurn())
    expect(viaContinue.getState().domainState.__turnScoped).toBe('keep-me')
  })

  it('emits a turn-completed event', async () => {
    const engine = buildEngine(['x', 'y'])
    await drain(engine.submitMessage('hi'))
    const events = await drain(engine.continueTurn())
    expect(events.some((e) => e.type === 'turn-completed')).toBe(true)
  })
})
