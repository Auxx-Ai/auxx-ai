// packages/lib/src/ai/providers/typesafe/__tests__/typesafe-integration.test.ts
//
// TypeSafe's Jev against the real API. Opt-in: LIVE_API_TESTS=1 plus TYPESAFE_API_KEY.
// The mocked suite pins our mapping; this one catches the vendor changing its answers.

import { describe, expect, it } from 'vitest'
import { canRunLiveApi } from '../../../../test/live-api'
import type { DecisionQuestion } from '../../../decision/client'
import { TypeSafeApiError, TypeSafeDecisionClient } from '../typesafe-decision-client'
import { TYPESAFE_MODELS } from '../typesafe-defaults'

const apiKey = process.env.TYPESAFE_API_KEY
const MODEL = 'jev-1.13.0'

const INTENT_OPTIONS = {
  refund: 'Money back for an order',
  tracking: 'Where their parcel is',
  other: null,
}

const QUESTIONS: Record<string, DecisionQuestion> = {
  intent: { type: 'choice', instructions: 'What does the customer want?', options: INTENT_OPTIONS },
  frustration: {
    type: 'score',
    instructions: 'How frustrated is the customer?',
    levels: ['Calm', 'Annoyed', 'Furious'],
  },
  urgent: {
    type: 'noul',
    instructions: 'Does this need action today?',
    criteria: { true: 'A deadline or harm today', false: 'It can wait' },
  },
}

const STATE = {
  subject: 'Charged twice for order #4521',
  body: 'I was charged twice for order #4521. Please refund the duplicate charge.',
}

function client(key = apiKey!) {
  return new TypeSafeDecisionClient(key, undefined, { timeoutMs: 30_000 })
}

describe.skipIf(!canRunLiveApi(apiKey))('TypeSafe Jev integration', () => {
  it('pins a model that is still in the catalog', () => {
    expect(TYPESAFE_MODELS[MODEL]).toBeDefined()
  })

  it('answers choice, score and noul questions in the shapes the runner expects', async () => {
    const result = await client().evaluate({
      provider: 'typesafe',
      model: MODEL,
      state: STATE,
      questions: QUESTIONS,
    })

    expect(result.confidenceKind).toBe('calibrated')
    expect(result.provider).toBe('typesafe')
    expect(result.model).toBe(MODEL)
    expect(result.usage.inputTokens).toBeGreaterThan(0)

    const { intent, frustration, urgent } = result.answers
    expect(intent?.type).toBe('choice')
    if (intent?.type === 'choice') {
      expect(Object.keys(INTENT_OPTIONS)).toContain(intent.choice)
      expect(intent.confidence).toBeGreaterThanOrEqual(0)
      expect(intent.confidence).toBeLessThanOrEqual(1)
      const total = Object.values(intent.probabilities ?? {}).reduce((sum, p) => sum + p, 0)
      expect(total).toBeCloseTo(1, 1)
    }

    expect(frustration?.type).toBe('score')
    if (frustration?.type === 'score') {
      // 1-based on both paths; `expected` is the vendor's 0-based score shifted by one.
      expect(frustration.level).toBeGreaterThanOrEqual(1)
      expect(frustration.level).toBeLessThanOrEqual(3)
      expect(frustration.expected).not.toBeNull()
      expect(frustration.expected!).toBeGreaterThanOrEqual(1)
      expect(frustration.expected!).toBeLessThanOrEqual(3)
    }

    expect(urgent?.type).toBe('noul')
    if (urgent?.type === 'noul') {
      expect(urgent.probability).toBeGreaterThanOrEqual(0)
      expect(urgent.probability).toBeLessThanOrEqual(1)
    }
  }, 60_000)

  it('picks the obvious option on an unambiguous mail', async () => {
    const result = await client().evaluate({
      provider: 'typesafe',
      model: MODEL,
      state: STATE,
      questions: { intent: QUESTIONS.intent! },
    })
    expect(result.answers.intent).toMatchObject({ type: 'choice', choice: 'refund' })
  }, 60_000)

  it('maps a rejected key to INVALID_CREDENTIALS / 401', async () => {
    const error = await client('ts-invalid-key')
      .evaluate({ provider: 'typesafe', model: MODEL, state: STATE, questions: QUESTIONS })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TypeSafeApiError)
    expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
  }, 60_000)
})
