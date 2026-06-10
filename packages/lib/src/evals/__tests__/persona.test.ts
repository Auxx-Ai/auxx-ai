// packages/lib/src/evals/__tests__/persona.test.ts

import { describe, expect, it } from 'vitest'
import type { LLMCallParams, LLMStreamEvent } from '../../ai/agent-framework/types'
import { LlmPersonaConversationSource } from '../simulation/persona'

const captureCallModel = (captured: LLMCallParams[]) =>
  async function* (params: LLMCallParams): AsyncGenerator<LLMStreamEvent> {
    captured.push(params)
    yield {
      type: 'done',
      content: JSON.stringify({ message: 'Sure, here it is.', done: false }),
      toolCalls: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      finishReason: 'stop',
    } as LLMStreamEvent
  }

const makePersona = (captured: LLMCallParams[]) =>
  new LlmPersonaConversationSource({
    openingMessage: 'I want a refund for order #10483.',
    customerContext: 'Received the wrong items.',
    channel: 'chat',
    identity: { name: 'Morgan Lee', email: 'morgan.lee@example.com' },
    model: { provider: 'openai', model: 'gpt-test' },
    callModel: captureCallModel(captured),
  })

describe('LlmPersonaConversationSource', () => {
  it('returns the opening message verbatim without a model call', async () => {
    const captured: LLMCallParams[] = []
    const persona = makePersona(captured)
    const first = await persona.nextTurn([])
    expect(first).toEqual({ done: false, text: 'I want a refund for order #10483.' })
    expect(captured).toHaveLength(0)
  })

  it('grounds the persona: scenario facts are ground truth, contradictions get pushback', async () => {
    const captured: LLMCallParams[] = []
    const persona = makePersona(captured)
    await persona.nextTurn([])
    await persona.nextTurn([
      { role: 'user', content: 'I want a refund for order #10483.' },
      { role: 'assistant', content: 'I found order #2088 — is that correct?' },
    ])

    expect(captured).toHaveLength(1)
    const system = captured[0]?.messages[0]
    expect(system?.role).toBe('system')
    const content = system?.content as string
    // Identity values stay pinned…
    expect(content).toContain('Morgan Lee')
    expect(content).toContain('morgan.lee@example.com')
    // …and everything stated (including invented values) is ground truth the
    // persona defends instead of confirming agent claims that contradict it.
    expect(content).toContain('ground truth')
    expect(content).toContain('do NOT confirm it')
    expect(content).toContain('Never confirm a detail you did not provide')
  })
})
