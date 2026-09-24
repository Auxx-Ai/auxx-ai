// packages/lib/src/ai/decision/__tests__/llm-decision-client.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import type { LLMOrchestrator } from '../../orchestrator/llm-orchestrator'
import type { DecisionQuestion } from '../client'
import { buildDecisionPrompt, buildDecisionSchema, LlmDecisionClient } from '../llm-decision-client'

const invoke = vi.fn()
const orchestrator = { invoke } as unknown as LLMOrchestrator

const questions: Record<string, DecisionQuestion> = {
  category: {
    type: 'choice',
    instructions: 'Which team owns this mail?',
    options: { billing: 'Invoices and refunds', sales: null },
  },
  urgency: { type: 'score', instructions: 'How urgent is it?', levels: ['low', 'mid', 'high'] },
  spam: {
    type: 'noul',
    instructions: 'Is this spam?',
    criteria: { true: 'Unsolicited bulk mail', false: 'A real customer' },
  },
}

function client(sourceId?: string) {
  return new LlmDecisionClient(orchestrator, {
    organizationId: 'org_1',
    userId: null,
    source: 'mail_classification',
    sourceId,
  })
}

function respond(structured: Record<string, unknown> | undefined) {
  invoke.mockResolvedValue({
    structured_output: structured,
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  })
}

const params = { provider: 'openai', model: 'gpt-x', state: { subject: 'Refund' }, questions }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildDecisionSchema', () => {
  const { schema, strict } = buildDecisionSchema(questions)

  it('is strict, closed, and requires every property', () => {
    expect(strict).toBe(true)
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(Object.keys(schema.properties))
  })

  it('puts each answer before its confidence', () => {
    expect(Object.keys(schema.properties)).toEqual([
      'category',
      'category_confidence',
      'urgency',
      'urgency_confidence',
      'spam',
    ])
  })

  it('emits a string enum of option keys for choice', () => {
    expect(schema.properties.category).toEqual({ type: 'string', enum: ['billing', 'sales'] })
    expect(schema.properties.category_confidence?.type).toBe('number')
  })

  it("emits a string enum '1'..'n' for score", () => {
    expect(schema.properties.urgency).toEqual({ type: 'string', enum: ['1', '2', '3'] })
    expect(schema.properties.urgency_confidence?.type).toBe('number')
  })

  it('emits a bare number for noul, with no confidence sibling', () => {
    expect(schema.properties.spam?.type).toBe('number')
    expect(schema.properties.spam_confidence).toBeUndefined()
  })

  it('keeps a 60-member enum intact', () => {
    const options = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`tag_${i}`, null]))
    const big = buildDecisionSchema({ tag: { type: 'choice', instructions: 'x', options } })
    expect(big.schema.properties.tag?.enum).toHaveLength(60)
  })
})

describe('buildDecisionPrompt', () => {
  const prompt = buildDecisionPrompt(questions)

  it('carries instructions, options, levels and criteria', () => {
    expect(prompt).toContain('You answer fixed questions about the material below.')
    expect(prompt).toContain('Which team owns this mail?')
    expect(prompt).toContain('- billing: Invoices and refunds')
    expect(prompt).toContain('- sales')
    expect(prompt).toContain('1. low')
    expect(prompt).toContain('3. high')
    expect(prompt).toContain('True when: Unsolicited bulk mail')
    expect(prompt).toContain('False when: A real customer')
  })
})

describe('LlmDecisionClient.evaluate', () => {
  it('invokes once with structured output, temperature 0, no tools, no streaming', async () => {
    respond({
      category: 'billing',
      category_confidence: 0.9,
      urgency: '2',
      urgency_confidence: 0.5,
      spam: 0.1,
    })
    await client('msg_1').evaluate(params)

    expect(invoke).toHaveBeenCalledTimes(1)
    const request = invoke.mock.calls[0]![0]
    expect(request.provider).toBe('openai')
    expect(request.model).toBe('gpt-x')
    expect(request.userId).toBeNull()
    expect(request.structuredOutput).toEqual({
      enabled: true,
      schema: buildDecisionSchema(questions),
    })
    expect(request.parameters.temperature).toBe(0)
    expect(request.parameters.max_tokens).toBeGreaterThan(0)
    expect(request.tools).toBeUndefined()
    expect(request.streaming).toBeUndefined()
    expect(request.context).toEqual({ source: 'mail_classification', sourceId: 'msg_1' })
    expect(request.messages[1].content).toBe(JSON.stringify({ subject: 'Refund' }, null, 2))
  })

  it('passes a string state through as-is', async () => {
    respond({
      category: 'sales',
      category_confidence: 1,
      urgency: '1',
      urgency_confidence: 1,
      spam: 0,
    })
    await client().evaluate({ ...params, state: 'raw text' })
    expect(invoke.mock.calls[0]![0].messages[1].content).toBe('raw text')
  })

  it('maps answers back, self-reported, with no fake distributions', async () => {
    respond({
      category: 'billing',
      category_confidence: 0.9,
      urgency: '3',
      urgency_confidence: 0.4,
      spam: 0.2,
    })
    const result = await client().evaluate(params)

    expect(result.confidenceKind).toBe('self-reported')
    expect(result.answers.category).toEqual({
      type: 'choice',
      choice: 'billing',
      probabilities: null,
      confidence: 0.9,
    })
    expect(result.answers.urgency).toEqual({
      type: 'score',
      level: 3,
      expected: null,
      probabilities: null,
      confidence: 0.4,
    })
    expect(result.answers.spam).toEqual({ type: 'noul', probability: 0.2 })
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
    expect(result).toMatchObject({ provider: 'openai', model: 'gpt-x' })
  })

  it('clamps confidences and probabilities to [0, 1]', async () => {
    respond({
      category: 'billing',
      category_confidence: 7,
      urgency: '1',
      urgency_confidence: -2,
      spam: 1.5,
    })
    const { answers } = await client().evaluate(params)
    expect(answers.category).toMatchObject({ confidence: 1 })
    expect(answers.urgency).toMatchObject({ confidence: 0 })
    expect(answers.spam).toEqual({ type: 'noul', probability: 1 })
  })

  it('rejects a choice outside the enum with UnprocessableEntityError naming the question', async () => {
    respond({
      category: 'legal',
      category_confidence: 0.9,
      urgency: '1',
      urgency_confidence: 1,
      spam: 0,
    })
    const run = client().evaluate(params)
    await expect(run).rejects.toBeInstanceOf(UnprocessableEntityError)
    await expect(run).rejects.toThrow(/category/)
  })

  it('rejects a score level outside the scale', async () => {
    respond({
      category: 'billing',
      category_confidence: 1,
      urgency: '4',
      urgency_confidence: 1,
      spam: 0,
    })
    await expect(client().evaluate(params)).rejects.toThrow(/urgency/)
  })

  it('rejects a missing structured output', async () => {
    respond(undefined)
    await expect(client().evaluate(params)).rejects.toBeInstanceOf(UnprocessableEntityError)
  })
})
