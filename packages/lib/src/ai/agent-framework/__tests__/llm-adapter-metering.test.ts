// packages/lib/src/ai/agent-framework/__tests__/llm-adapter-metering.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMStreamChunk, UsageMetrics } from '../../clients/base/types'
import type { UsageTrackingRequest } from '../../orchestrator/types'
import type { LLMCallParams } from '../types'

/**
 * `LLMOrchestrator.streamInvoke` enforces the quota gate but records nothing —
 * it hands back `usage` / `providerType` / `credentialSource` and leaves billing
 * to its caller. It has exactly one caller, `createCallModel`, so metering there
 * is what covers every agent path (kopilot, agent worker, chat widget, workflow
 * AI turns, evals, headless capture runs). These tests pin that contract:
 * one `AiUsage` write per LLM call, including calls that error or are aborted.
 */

const USAGE: UsageMetrics = { prompt_tokens: 200, completion_tokens: 300, total_tokens: 500 }
const ZERO_USAGE: UsageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

const gateChunk = (
  providerType = 'SYSTEM',
  credentialSource = 'SYSTEM'
): Partial<LLMStreamChunk> => ({
  id: 'gate',
  model: 'claude-opus-5',
  content: '',
  delta: '',
  metadata: { chunkIndex: -1, totalLength: 0, providerType, credentialSource },
})

/** Per-test script for the faked orchestrator stream. */
const state = vi.hoisted(() => ({
  chunks: [] as unknown[],
  response: undefined as unknown,
  throwAfterChunks: false,
  onChunk: undefined as ((index: number) => void) | undefined,
}))

vi.mock('../../orchestrator/llm-orchestrator', () => ({
  LLMOrchestrator: class {
    async *streamInvoke() {
      let index = 0
      for (const chunk of state.chunks) {
        yield chunk
        state.onChunk?.(index)
        index++
      }
      if (state.throwAfterChunks) throw new Error('provider exploded')
      return state.response
    }
  },
}))

const { createCallModel } = await import('../llm-adapter')

const PARAMS: LLMCallParams = {
  model: 'claude-opus-5',
  provider: 'anthropic',
  messages: [{ role: 'user', content: 'hi' }],
}

function makeUsageService() {
  const calls: UsageTrackingRequest[] = []
  return {
    calls,
    service: {
      trackUsage: async (request: UsageTrackingRequest) => {
        calls.push(request)
      },
    },
  }
}

/** Drive `callModel` to completion, swallowing provider errors. */
async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  try {
    for await (const _event of gen) {
      // events are irrelevant here — only the billing side effect is asserted
    }
  } catch {
    // provider failures are rethrown by the adapter; the billing assertion is the point
  }
}

describe('createCallModel — usage metering', () => {
  beforeEach(() => {
    state.chunks = []
    state.response = undefined
    state.throwAfterChunks = false
    state.onChunk = undefined
  })

  it('writes one usage entry per call, carrying the credential metadata', async () => {
    state.chunks = [gateChunk(), { id: 'c1', model: 'claude-opus-5', content: '', delta: 'hi' }]
    state.response = {
      content: 'hi',
      tool_calls: [],
      usage: USAGE,
      providerType: 'SYSTEM',
      credentialSource: 'SYSTEM',
    }
    const { calls, service } = makeUsageService()

    const callModel = createCallModel({
      organizationId: 'org-1',
      userId: 'user-1',
      source: 'learned_extraction',
      sourceId: 'thread-1',
      usageService: service,
    })
    await drain(callModel(PARAMS))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: 'anthropic',
      model: 'claude-opus-5',
      usage: USAGE,
      source: 'learned_extraction',
      sourceId: 'thread-1',
      providerType: 'SYSTEM',
      credentialSource: 'SYSTEM',
    })
    // Credits are metered from real USD COGS downstream — never overridden here.
    expect(calls[0]?.creditsUsed).toBeUndefined()
  })

  it('bills BYO calls too (0 credits is resolved downstream, not by skipping the row)', async () => {
    state.chunks = [gateChunk('CUSTOM', 'MODEL_SPECIFIC')]
    state.response = {
      content: '',
      tool_calls: [],
      usage: USAGE,
      providerType: 'CUSTOM',
      credentialSource: 'MODEL_SPECIFIC',
    }
    const { calls, service } = makeUsageService()

    const callModel = createCallModel({
      organizationId: 'org-1',
      userId: 'user-1',
      usageService: service,
    })
    await drain(callModel(PARAMS))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      providerType: 'CUSTOM',
      credentialSource: 'MODEL_SPECIFIC',
      // Default label for a caller that doesn't set one.
      source: 'agent',
    })
  })

  it('writes nothing when the provider reported no tokens', async () => {
    state.chunks = [gateChunk()]
    state.response = { content: '', tool_calls: [], usage: ZERO_USAGE, providerType: 'SYSTEM' }
    const { calls, service } = makeUsageService()

    const callModel = createCallModel({
      organizationId: 'org-1',
      userId: 'user-1',
      usageService: service,
    })
    await drain(callModel(PARAMS))

    expect(calls).toHaveLength(0)
  })

  it('bills tokens spent before an aborted stream, with the gate credential type', async () => {
    const controller = new AbortController()
    state.chunks = [
      gateChunk(),
      { id: 'c1', model: 'claude-opus-5', content: '', delta: 'part', usage: USAGE },
    ]
    // Abort once the usage-bearing chunk has been consumed: the adapter checks
    // the signal before its next `stream.next()` and returns early.
    state.onChunk = (index) => {
      if (index === 1) controller.abort()
    }
    const { calls, service } = makeUsageService()

    const callModel = createCallModel({
      organizationId: 'org-1',
      userId: 'user-1',
      source: 'chat',
      usageService: service,
    })
    await drain(callModel({ ...PARAMS, signal: controller.signal }))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      usage: USAGE,
      source: 'chat',
      // Without the orchestrator's synthetic gate chunk this would be undefined,
      // and an aborted SYSTEM call would silently bill 0 credits.
      providerType: 'SYSTEM',
      credentialSource: 'SYSTEM',
    })
  })

  it('bills tokens spent before a provider error', async () => {
    state.chunks = [
      gateChunk(),
      { id: 'c1', model: 'claude-opus-5', content: '', delta: 'part', usage: USAGE },
    ]
    state.throwAfterChunks = true
    const { calls, service } = makeUsageService()

    const callModel = createCallModel({
      organizationId: 'org-1',
      userId: 'user-1',
      usageService: service,
    })
    await drain(callModel(PARAMS))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.usage).toEqual(USAGE)
  })

  it('bills once when the consumer abandons the stream mid-turn', async () => {
    state.chunks = [
      gateChunk(),
      { id: 'c1', model: 'claude-opus-5', content: '', delta: 'first', usage: USAGE },
      { id: 'c2', model: 'claude-opus-5', content: '', delta: 'second' },
    ]
    const { calls, service } = makeUsageService()

    const callModel = createCallModel({
      organizationId: 'org-1',
      userId: 'user-1',
      usageService: service,
    })
    const gen = callModel(PARAMS)
    for await (const _event of gen) {
      break // closing the generator runs its `finally`
    }

    expect(calls).toHaveLength(1)
  })
})
