// packages/lib/src/ai/agent-framework/__tests__/turn-token-meter.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolCall, UsageMetrics } from '../../clients/base/types'
import { KOPILOT_TURN_BUDGET } from '../../kopilot/turn-budget'
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
import { meterRollupTokens, normalizeCallUsage, promptIncludesCachedReads } from '../usage-metering'

/**
 * The per-turn token budget used to charge for the conversation, not the work.
 *
 * It summed each LLM call's `total_tokens`, which includes prompt tokens — and
 * the entire conversation is re-sent every iteration. So the meter grew
 * superlinearly in iteration count while the turn produced a steady trickle of
 * genuinely new tokens, and a long editing turn died on bookkeeping after doing
 * all of its work. The meter now charges non-cached input + completion, read off
 * the raw per-call `IterationUsage` records rather than the cumulative roll-up.
 *
 * These tests pin the unit, the two provider semantics that make it
 * expressible, the fallback when neither is reported, and — critically — that
 * the budget still bounds the one loop it is the only bound on.
 */

// ===== USAGE SHAPES =====

/**
 * Anthropic-shaped usage: `prompt_tokens` is the UNCACHED remainder; cache
 * reads and writes arrive as separate counts and are NOT inside it.
 */
const anthropicUsage = (
  uncachedInput: number,
  cachedInput: number,
  completion: number,
  cacheWrite = 0
): UsageMetrics => ({
  prompt_tokens: uncachedInput,
  completion_tokens: completion,
  total_tokens: uncachedInput + completion,
  cached_input_tokens: cachedInput,
  cache_write_tokens: cacheWrite,
})

/**
 * OpenAI-shaped usage (and every other provider in the registry, which all
 * share `OpenAILLMClient.convertUsage`): `prompt_tokens` INCLUDES the cached
 * reads, and there is no explicit write count.
 */
const openaiUsage = (
  promptTokens: number,
  cachedInput: number,
  completion: number
): UsageMetrics => ({
  prompt_tokens: promptTokens,
  completion_tokens: completion,
  total_tokens: promptTokens + completion,
  cached_input_tokens: cachedInput,
})

/** A provider that reports no cache accounting at all. */
const bareUsage = (prompt: number, completion: number): UsageMetrics => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
})

// ===== HARNESS =====

interface CallScript {
  content?: string
  toolCalls?: ToolCall[]
  usage: UsageMetrics
}

const toolCall = (n: number): ToolCall[] => [
  // Args vary per iteration on purpose: identical (name, args) pairs trip the
  // turn-wide identical-call budget long before 30 iterations, and this suite
  // is about tokens, not repetition.
  { id: `c${n}`, type: 'function', function: { name: 'edit', arguments: `{"n":${n}}` } },
]

const editTool: AgentToolDefinition = {
  name: 'edit',
  displayName: 'Edit',
  description: 'Applies one graph edit',
  parameters: { type: 'object', properties: { n: { type: 'number' } } },
  execute: async () => ({ success: true, output: { applied: true } }),
}

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

function turnError(events: AgentEvent[]) {
  return events.find((e) => e.type === 'turn-error') as
    | Extract<AgentEvent, { type: 'turn-error' }>
    | undefined
}

interface HarnessOptions {
  script: CallScript[]
  provider?: string
  maxTokensPerTurn?: number
  maxIterations?: number
}

function buildEngine(opts: HarnessOptions) {
  const outcomes: TurnOutcome[] = []
  const calls: LLMCallParams[] = []

  let index = 0
  // Past the end of the script the last step repeats — that step is always the
  // text-only reply, so the loop terminates naturally.
  const callModel = async function* (params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    calls.push(params)
    const step = opts.script[Math.min(index, opts.script.length - 1)]!
    index++
    yield {
      type: 'done',
      content: step.content ?? '',
      toolCalls: step.toolCalls ?? [],
      usage: step.usage,
    }
  }

  const agent: AgentDefinition = {
    name: 'agent',
    tools: [editTool],
    buildMessages: async () => [{ role: 'user', content: 'go' }],
    processResult: async (_c, _tc, state) => state,
    maxIterations: opts.maxIterations ?? 40,
  }

  const domainConfig: AgentDomainConfig = {
    type: 'kopilot',
    agents: { agent },
    routes: [{ name: 'default', agents: ['agent'] }],
    createInitialState: () => ({}),
    defaultModel: 'model-x',
    defaultProvider: opts.provider ?? 'anthropic',
    onTurnEnd: async (_state, outcome) => {
      outcomes.push(outcome)
    },
  }

  const config: AgentEngineConfig = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    db: {} as never,
    domainConfig,
    callModel,
    ...(opts.maxTokensPerTurn !== undefined ? { maxTokensPerTurn: opts.maxTokensPerTurn } : {}),
  }

  return { engine: new AgentEngine(config), outcomes, calls }
}

/**
 * A twelve-tool-iteration editing turn in the OpenAI shape, where the whole
 * conversation is re-sent every call and almost all of it comes back from the
 * prompt cache. Each call presents a bigger prompt but does the same small
 * amount of new work: 2,000 fresh input tokens + a 500-token completion.
 */
function growingPromptScript(): { script: CallScript[]; metered: number; oldMeter: number } {
  const script: CallScript[] = []
  let metered = 0
  let oldMeter = 0
  for (let i = 0; i <= 12; i++) {
    const promptTokens = 20_000 + i * 5_000
    const usage = openaiUsage(promptTokens, promptTokens - 2_000, 500)
    metered += 2_000 + 500
    oldMeter += usage.total_tokens
    script.push(
      i < 12 ? { toolCalls: toolCall(i), usage } : { content: 'twelve edits applied', usage }
    )
  }
  return { script, metered, oldMeter }
}

// ===== THE NORMALIZATION HELPER =====

describe('normalizeCallUsage', () => {
  it('reconciles the OpenAI and Anthropic shapes of the SAME call', () => {
    // One physical call: 30k input presented, 20k of it served from cache,
    // 1k completion. Each provider reports that differently.
    const asOpenai = normalizeCallUsage(openaiUsage(30_000, 20_000, 1_000), 'openai')
    const asAnthropic = normalizeCallUsage(anthropicUsage(10_000, 20_000, 1_000), 'anthropic')

    expect(asOpenai.totalInput).toBe(30_000)
    expect(asAnthropic.totalInput).toBe(30_000)
    expect(asOpenai.rateLimitInput).toBe(10_000)
    expect(asAnthropic.rateLimitInput).toBe(10_000)
    // The whole point: the budget cannot depend on which vendor served the call.
    expect(asOpenai.meteredTokens).toBe(11_000)
    expect(asAnthropic.meteredTokens).toBe(asOpenai.meteredTokens)
  })

  it('treats every non-Anthropic provider as prompt-includes-cached', () => {
    // They all share OpenAILLMClient.convertUsage, so a substring test for
    // "openai" would double-charge their cached prefix.
    for (const provider of [
      'openai',
      'google',
      'groq',
      'deepseek',
      'qwen',
      'kimi',
      'zai',
      'grok',
    ]) {
      expect(promptIncludesCachedReads(provider)).toBe(true)
      expect(normalizeCallUsage(openaiUsage(30_000, 20_000, 1_000), provider).meteredTokens).toBe(
        11_000
      )
    }
    expect(promptIncludesCachedReads('anthropic')).toBe(false)
    expect(promptIncludesCachedReads('Anthropic')).toBe(false)
  })

  it('charges cache writes on both shapes — they are new input', () => {
    expect(
      normalizeCallUsage(anthropicUsage(1_000, 20_000, 100, 4_000), 'anthropic')
    ).toMatchObject({ rateLimitInput: 5_000, meteredTokens: 5_100, totalInput: 25_000 })
  })

  it('falls back to prompt + completion when no cache field is reported', () => {
    for (const provider of ['anthropic', 'openai', undefined]) {
      const norm = normalizeCallUsage(bareUsage(9_000, 700), provider)
      expect(norm.meteredTokens).toBe(9_700)
      expect(Number.isNaN(norm.meteredTokens)).toBe(false)
      expect(norm.meteredTokens).toBeGreaterThan(0)
    }
  })

  it('never yields NaN or a negative charge from malformed counts', () => {
    // A deliberately malformed provider payload.
    const nan = normalizeCallUsage(
      { prompt_tokens: Number.NaN, total_tokens: Number.NaN } as UsageMetrics,
      'openai'
    )
    expect(nan.meteredTokens).toBe(0)
    expect(Number.isNaN(nan.meteredTokens)).toBe(false)

    // cached > prompt is nonsense, but it must not produce a negative charge
    // that would refund the meter.
    const inverted = normalizeCallUsage(openaiUsage(1_000, 5_000, 200), 'openai')
    expect(inverted.rateLimitInput).toBe(0)
    expect(inverted.meteredTokens).toBe(200)

    expect(normalizeCallUsage(undefined, 'openai').meteredTokens).toBe(0)
  })

  it('meters an unknown-provider roll-up on prompt + completion', () => {
    // A roll-up can span providers, so neither cache semantics applies — and a
    // silent 0 would disable the budget outright.
    expect(meterRollupTokens(openaiUsage(30_000, 20_000, 1_000))).toBe(31_000)
    expect(meterRollupTokens(undefined)).toBe(0)
  })
})

// ===== THE METER, END TO END THROUGH THE ENGINE =====

describe('per-turn token meter', () => {
  it('does not grow with re-sent prompt tokens across iterations', async () => {
    const { script, metered, oldMeter } = growingPromptScript()
    // Sanity-check the fixture itself: the old unit really was ~20x the new one
    // on this turn, and really did exceed the framework default.
    expect(metered).toBe(32_500)
    expect(oldMeter).toBe(656_500)

    const { engine, outcomes } = buildEngine({
      script,
      provider: 'openai',
      // Below the old meter (656_500), far above the new one (32_500).
      maxTokensPerTurn: 200_000,
    })

    const events = await drain(engine.submitMessage('build the workflow'))

    expect(turnError(events)).toBeUndefined()
    expect(events.some((e) => e.type === 'turn-completed')).toBe(true)
    expect(outcomes).toEqual(['completed'])
  })

  it('meters exactly the new work — bracketing the budget pins the value', async () => {
    const { script, metered } = growingPromptScript()

    const under = buildEngine({ script, provider: 'openai', maxTokensPerTurn: metered + 1 })
    expect(turnError(await drain(under.engine.submitMessage('go')))).toBeUndefined()

    const over = buildEngine({ script, provider: 'openai', maxTokensPerTurn: metered })
    const events = await drain(over.engine.submitMessage('go'))
    expect(turnError(events)?.reason).toBe('token-budget')
    expect(turnError(events)?.error).toContain(`${metered}/${metered}`)
  })

  it('lets a long editing turn (30 tool iterations) finish under the Kopilot budget', async () => {
    // The pessimistic per-call reading the constant is sized against: the
    // observed `promptInput: 34389` treated as ALL uncached (Anthropic shape),
    // plus a 1,500-token completion. 31 calls ≈ 1.11M metered.
    const script: CallScript[] = []
    for (let i = 0; i <= 30; i++) {
      const usage = anthropicUsage(34_389, 19_072, 1_500)
      script.push(i < 30 ? { toolCalls: toolCall(i), usage } : { content: 'done', usage })
    }

    const { engine, outcomes } = buildEngine({
      script,
      provider: 'anthropic',
      maxTokensPerTurn: KOPILOT_TURN_BUDGET.maxTokensPerTurn,
      maxIterations: 40,
    })

    const events = await drain(engine.submitMessage('build the workflow'))

    expect(turnError(events)).toBeUndefined()
    expect(outcomes).toEqual(['completed'])
  })

  it('still trips on a genuine runaway', async () => {
    // Same per-call cost, but the model will not stop: 80 tool iterations of
    // real new input is real spend, and the budget must say so. It is scripted
    // to reply at the end only so the query loop finalizes normally — the meter
    // is what is under test, not the iteration cap's close.
    const script: CallScript[] = []
    for (let i = 0; i <= 80; i++) {
      const usage = anthropicUsage(34_389, 19_072, 1_500)
      script.push(i < 80 ? { toolCalls: toolCall(i), usage } : { content: 'done', usage })
    }

    const { engine, outcomes } = buildEngine({
      script,
      provider: 'anthropic',
      maxTokensPerTurn: KOPILOT_TURN_BUDGET.maxTokensPerTurn,
      maxIterations: 100,
    })

    const events = await drain(engine.submitMessage('go'))

    expect(turnError(events)?.reason).toBe('token-budget')
    // Exhaustion, not corruption — the work this turn did stays.
    expect(outcomes).toEqual(['exhausted'])
  })

  it('uses the documented fallback for a provider reporting no cache fields', async () => {
    const script: CallScript[] = [
      { toolCalls: toolCall(0), usage: bareUsage(1_000, 100) },
      { toolCalls: toolCall(1), usage: bareUsage(1_000, 100) },
      { content: 'done', usage: bareUsage(1_000, 100) },
    ]
    // prompt + completion, three calls = 3,300. Never NaN, never 0.
    const under = buildEngine({ script, maxTokensPerTurn: 3_301 })
    expect(turnError(await drain(under.engine.submitMessage('go')))).toBeUndefined()

    const over = buildEngine({ script, maxTokensPerTurn: 3_300 })
    const events = await drain(over.engine.submitMessage('go'))
    expect(turnError(events)?.reason).toBe('token-budget')
    expect(turnError(events)?.error).toContain('3300/3300')
    expect(turnError(events)?.error).not.toContain('NaN')
  })

  it('reads the same meter for OpenAI-shaped and Anthropic-shaped turns', async () => {
    // Identical physical turns, reported in each vendor's native shape. Both
    // must trip at the same budget and clear the same one.
    const build = (provider: string, usage: UsageMetrics, cap: number) =>
      buildEngine({
        script: [
          { toolCalls: toolCall(0), usage },
          { toolCalls: toolCall(1), usage },
          { content: 'done', usage },
        ],
        provider,
        maxTokensPerTurn: cap,
      })

    const openai = openaiUsage(30_000, 20_000, 1_000)
    const anthropic = anthropicUsage(10_000, 20_000, 1_000)
    const perCall = 11_000
    const total = perCall * 3

    for (const [provider, usage] of [
      ['openai', openai],
      ['anthropic', anthropic],
    ] as const) {
      const cleared = build(provider, usage, total + 1)
      expect(turnError(await drain(cleared.engine.submitMessage('go')))).toBeUndefined()

      const tripped = build(provider, usage, total)
      const events = await drain(tripped.engine.submitMessage('go'))
      expect(turnError(events)?.reason).toBe('token-budget')
      expect(turnError(events)?.error).toContain(`${total}/${total}`)
    }
  })

  it('[C8] still bounds a runaway continueTurn() reinvoke loop', async () => {
    // `continueTurn` deliberately does NOT reset turn usage, and
    // `maxTotalIterations` counts agents, so the token budget is the only thing
    // standing between a broken procedure stepper and an infinite loop.
    const usage = anthropicUsage(29_000, 50_000, 1_000) // 30,000 metered per call
    const { engine, calls } = buildEngine({
      script: [{ content: 'still going', usage }],
      provider: 'anthropic',
      maxTokensPerTurn: 100_000,
    })

    expect(turnError(await drain(engine.submitMessage('go')))).toBeUndefined() // 30k
    expect(turnError(await drain(engine.continueTurn()))).toBeUndefined() // 60k
    expect(turnError(await drain(engine.continueTurn()))).toBeUndefined() // 90k

    // The fourth continuation crosses the cap on its way out.
    expect(turnError(await drain(engine.continueTurn()))?.reason).toBe('token-budget')

    // And the fifth is refused BEFORE the model is called — the loop is bounded,
    // not merely reported on.
    const callsSoFar = calls.length
    expect(turnError(await drain(engine.continueTurn()))?.reason).toBe('token-budget')
    expect(calls.length).toBe(callsSoFar)
  })
})
