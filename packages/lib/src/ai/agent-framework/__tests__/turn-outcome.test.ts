// packages/lib/src/ai/agent-framework/__tests__/turn-outcome.test.ts

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
  TurnOutcome,
} from '../types'

/**
 * A failed turn used to destroy the work it had already done.
 *
 * `onTurnEnd`'s outcome was one bit — `'completed' | 'error'` — so "ran out of
 * tokens after twelve good edits" and "threw mid-write" arrived at the domain
 * hook identically, and the hook rolled the whole turn back. These tests pin
 * the widened vocabulary and, critically, that the classification reads the
 * `turn-error` event's `reason` discriminator and NEVER its message text.
 */

const ZERO_USAGE: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
const SOME_USAGE: UsageMetrics = { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }

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

/**
 * A `callModel` that fails the way a provider outage does. Rejects rather than
 * `throw`ing so the generator body keeps a reachable `yield`.
 */
function explodingModel(message: string) {
  return async function* (): AsyncGenerator<LLMStreamEvent> {
    await Promise.reject(new Error(message))
    yield { type: 'done', content: '', toolCalls: [], usage: ZERO_USAGE }
  }
}

const okTool: AgentToolDefinition = {
  name: 'poke',
  displayName: 'Poke',
  description: 'Always succeeds',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: true, output: { ok: true } }),
}

const failingTool: AgentToolDefinition = {
  name: 'boom',
  displayName: 'Boom',
  description: 'Always fails',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: false, output: undefined, error: 'nope' }),
}

interface HarnessOptions {
  callModel: (params: LLMCallParams) => AsyncGenerator<LLMStreamEvent>
  agents?: Record<string, AgentDefinition>
  route?: string[]
  tools?: AgentToolDefinition[]
  maxIterations?: number
  maxTokensPerTurn?: number
  maxTotalIterations?: number
  maxApprovalsPerTurn?: number
  signal?: AbortSignal
}

function buildEngine(opts: HarnessOptions) {
  const outcomes: TurnOutcome[] = []

  const agents: Record<string, AgentDefinition> = opts.agents ?? {
    agent: {
      name: 'agent',
      tools: opts.tools ?? [okTool],
      buildMessages: async () => [{ role: 'user', content: 'go' }],
      processResult: async (_c, _tc, state) => state,
      ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    },
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents,
    routes: [{ name: 'default', agents: opts.route ?? ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'm',
    defaultProvider: 'p',
    onTurnEnd: async (_state, outcome) => {
      outcomes.push(outcome)
    },
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // biome-ignore lint/suspicious/noExplicitAny: tests don't touch the db handle
    db: {} as any,
    domainConfig,
    callModel: opts.callModel,
    ...(opts.maxTokensPerTurn !== undefined ? { maxTokensPerTurn: opts.maxTokensPerTurn } : {}),
    ...(opts.maxTotalIterations !== undefined
      ? { maxTotalIterations: opts.maxTotalIterations }
      : {}),
    ...(opts.maxApprovalsPerTurn !== undefined
      ? { maxApprovalsPerTurn: opts.maxApprovalsPerTurn }
      : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  }

  return { engine: new AgentEngine(config), outcomes }
}

function turnError(events: AgentEvent[]) {
  return events.find((e) => e.type === 'turn-error') as
    | Extract<AgentEvent, { type: 'turn-error' }>
    | undefined
}

describe('turn outcome vocabulary', () => {
  it('reports "completed" for a turn that finishes normally', async () => {
    const { engine, outcomes } = buildEngine({
      callModel: async function* () {
        yield { type: 'done', content: 'all set', toolCalls: [], usage: ZERO_USAGE }
      },
    })

    const events = await drain(engine.submitMessage('go'))

    expect(events.some((e) => e.type === 'turn-completed')).toBe(true)
    expect(outcomes).toEqual(['completed'])
  })

  it('reports "exhausted" — not "error" — when the token budget runs out', async () => {
    const { engine, outcomes } = buildEngine({
      maxTokensPerTurn: 5,
      callModel: async function* () {
        yield { type: 'done', content: 'did a lot of work', toolCalls: [], usage: SOME_USAGE }
      },
    })

    const events = await drain(engine.submitMessage('go'))

    expect(turnError(events)?.reason).toBe('token-budget')
    expect(outcomes).toEqual(['exhausted'])
  })

  it('reports "exhausted" when the same tool fails three times in a row', async () => {
    const { engine, outcomes } = buildEngine({
      tools: [failingTool],
      callModel: async function* () {
        yield {
          type: 'done',
          content: '',
          toolCalls: [makeToolCall('c1', 'boom')],
          usage: ZERO_USAGE,
        }
      },
    })

    const events = await drain(engine.submitMessage('go'))

    expect(turnError(events)?.reason).toBe('tool-failure-streak')
    expect(outcomes).toEqual(['exhausted'])
  })

  it('reports "exhausted" when the turn chains past the max-approvals cap', async () => {
    // The cap trips BETWEEN approvals — the tool that tripped it already ran and
    // settled — so this is a resource cap like the others, not corruption.
    // Reachable in practice: Kopilot allows 50, and a long authoring turn chains
    // approvals.
    const approvalTool: AgentToolDefinition = {
      name: 'write',
      displayName: 'Write',
      description: 'Needs approval',
      parameters: { type: 'object', properties: {} },
      requiresApproval: true,
      execute: async () => ({ success: true, output: { written: true } }),
    }

    const { engine, outcomes } = buildEngine({
      tools: [approvalTool],
      maxApprovalsPerTurn: 0,
      callModel: async function* () {
        yield {
          type: 'done',
          content: '',
          toolCalls: [makeToolCall('c1', 'write')],
          usage: ZERO_USAGE,
        }
      },
    })

    await drain(engine.submitMessage('go'))
    // The pause is not a turn end — `waitingForApproval` suppresses the hook.
    expect(engine.getState().pendingToolCall).toBeDefined()
    expect(outcomes).toEqual([])

    const events = await drain(engine.resume({ action: 'approve' }))

    expect(turnError(events)?.reason).toBe('max-approvals')
    expect(outcomes).toEqual(['exhausted'])
  })

  it('reports "error" for a thrown failure inside the turn', async () => {
    const { engine, outcomes } = buildEngine({
      callModel: explodingModel('provider exploded'),
    })

    const events = await drain(engine.submitMessage('go'))

    expect(turnError(events)?.reason).toBe('internal')
    expect(outcomes).toEqual(['error'])
  })

  it('reports "aborted" when the consumer stops draining an interrupted turn', async () => {
    // The real scenario: the SSE route's request-abort listener calls
    // interrupt() and then the response generator is cancelled, so no terminal
    // event is ever yielded and only `withTurnEnd`'s finally guard runs.
    const { engine, outcomes } = buildEngine({
      callModel: async function* () {
        yield { type: 'done', content: 'hi', toolCalls: [], usage: ZERO_USAGE }
      },
    })

    const gen = engine.submitMessage('go')
    await gen.next() // turn-started
    engine.interrupt()
    await gen.return(undefined as never)

    expect(outcomes).toEqual(['aborted'])
  })

  it('still reports "error" for an undrained close that was NOT aborted', async () => {
    const { engine, outcomes } = buildEngine({
      callModel: async function* () {
        yield { type: 'done', content: 'hi', toolCalls: [], usage: ZERO_USAGE }
      },
    })

    const gen = engine.submitMessage('go')
    await gen.next()
    await gen.return(undefined as never)

    expect(outcomes).toEqual(['error'])
  })

  it('classifies on `reason`, never on the error text', async () => {
    // An LLM failure whose message is a verbatim copy of the token-budget
    // wording. Text-matching would call this exhaustion; the discriminator says
    // it is a real error.
    const { engine, outcomes } = buildEngine({
      callModel: explodingModel('Turn exceeded token budget (999/100)'),
    })

    const events = await drain(engine.submitMessage('go'))

    expect(turnError(events)?.error).toContain('Turn exceeded token budget')
    expect(turnError(events)?.reason).toBe('internal')
    expect(outcomes).toEqual(['error'])
  })
})

describe('maxTotalIterations counts iterations, not agents (fix 10.1)', () => {
  it('advances the total by one agent run’s LLM calls, not by 1', async () => {
    // `assistant-message-finished` fires once per AGENT, so the old
    // `totalIterations++` could never exceed 1 on a route — a cap of 3 was
    // unreachable no matter how long the agent looped. The first agent here
    // burns four metered LLM calls; the cap must bite before the second agent
    // ever starts.
    let calls = 0
    const callModel = async function* (): AsyncGenerator<LLMStreamEvent> {
      calls++
      if (calls < 4) {
        yield {
          type: 'done',
          content: '',
          toolCalls: [makeToolCall(`c${calls}`, 'poke')],
          usage: SOME_USAGE,
        }
        return
      }
      yield { type: 'done', content: 'done', toolCalls: [], usage: SOME_USAGE }
    }

    const makeAgent = (name: string): AgentDefinition => ({
      name,
      tools: [okTool],
      buildMessages: async () => [{ role: 'user', content: 'go' }],
      processResult: async (_c, _tc, state) => state,
      maxIterations: 10,
    })

    const { engine, outcomes } = buildEngine({
      callModel,
      agents: { first: makeAgent('first'), second: makeAgent('second') },
      route: ['first', 'second'],
      maxTotalIterations: 3,
    })

    const events = await drain(engine.submitMessage('go'))

    expect(turnError(events)?.reason).toBe('max-iterations')
    // The second agent never got to run — proof the counter saw 4, not 1.
    expect(events.some((e) => e.type === 'agent-started' && e.agent === 'second')).toBe(false)
    expect(calls).toBe(4)
    // A cap is exhaustion, not corruption.
    expect(outcomes).toEqual(['exhausted'])
  })

  it('does not trip the cap when the agent stays under it', async () => {
    let calls = 0
    const callModel = async function* (): AsyncGenerator<LLMStreamEvent> {
      calls++
      if (calls < 2) {
        yield {
          type: 'done',
          content: '',
          toolCalls: [makeToolCall('c1', 'poke')],
          usage: SOME_USAGE,
        }
        return
      }
      yield { type: 'done', content: 'done', toolCalls: [], usage: SOME_USAGE }
    }

    const { engine, outcomes } = buildEngine({
      callModel,
      maxIterations: 10,
      maxTotalIterations: 5,
    })

    const events = await drain(engine.submitMessage('go'))

    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    expect(outcomes).toEqual(['completed'])
  })
})

describe('AgentEngineConfig.signal is honoured (fix 10.2)', () => {
  it('stops a turn whose caller-supplied signal is already aborted', async () => {
    const caller = new AbortController()
    caller.abort()

    let calls = 0
    const { engine } = buildEngine({
      signal: caller.signal,
      callModel: async function* (): AsyncGenerator<LLMStreamEvent> {
        calls++
        yield { type: 'done', content: 'hi', toolCalls: [], usage: ZERO_USAGE }
      },
    })

    await drain(engine.submitMessage('go'))

    // The engine used to overwrite `config.signal` with its own controller's
    // signal, so the caller's abort was invisible and the model still ran.
    expect(calls).toBe(0)
  })

  it('stops a turn when the caller aborts mid-flight', async () => {
    const caller = new AbortController()

    const abortingTool: AgentToolDefinition = {
      name: 'poke',
      displayName: 'Poke',
      description: 'Aborts the caller signal',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        caller.abort()
        return { success: true, output: { ok: true } }
      },
    }

    let calls = 0
    const { engine } = buildEngine({
      signal: caller.signal,
      tools: [abortingTool],
      maxIterations: 10,
      callModel: async function* (): AsyncGenerator<LLMStreamEvent> {
        calls++
        yield {
          type: 'done',
          content: '',
          toolCalls: [makeToolCall(`c${calls}`, 'poke')],
          usage: ZERO_USAGE,
        }
      },
    })

    await drain(engine.submitMessage('go'))

    expect(calls).toBe(1)
  })

  it('leaves engine.interrupt() working when no caller signal is supplied', async () => {
    let calls = 0
    const { engine } = buildEngine({
      maxIterations: 10,
      tools: [okTool],
      callModel: async function* (): AsyncGenerator<LLMStreamEvent> {
        calls++
        if (calls === 1) engine.interrupt()
        yield {
          type: 'done',
          content: '',
          toolCalls: [makeToolCall(`c${calls}`, 'poke')],
          usage: ZERO_USAGE,
        }
      },
    })

    await drain(engine.submitMessage('go'))

    expect(calls).toBe(1)
  })
})
