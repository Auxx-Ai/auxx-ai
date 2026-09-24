// packages/lib/src/ai/providers/typesafe/__tests__/typesafe-decision-client.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import type { DecisionQuestion } from '../../../decision/client'
import { ModelType } from '../../types'
import { TypeSafeClient } from '../typesafe-client'
import {
  TYPESAFE_ENDPOINT,
  TypeSafeApiError,
  TypeSafeDecisionClient,
  toVendorQuestion,
} from '../typesafe-decision-client'

const QUESTIONS: Record<string, DecisionQuestion> = {
  intent: {
    type: 'choice',
    instructions: 'What does the customer want?',
    options: { refund: 'Money back', tracking: null },
  },
  frustration: {
    type: 'score',
    instructions: 'How frustrated is the customer?',
    levels: ['Calm', 'Frustrated', 'Very angry'],
  },
  urgent: { type: 'noul', instructions: 'Is it urgent?', criteria: { true: 'Needs action today' } },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'jev-1.13.0',
    answers: {
      intent: {
        type: 'choice',
        choice: 'refund',
        probabilities: { refund: 0.9, tracking: 0.1 },
        confidence: 0.8,
      },
      frustration: {
        type: 'score',
        score: 1.05,
        legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
        probabilities: { '0': 0.0, '1': 0.95, '2': 0.05 },
        confidence: 0.92,
      },
      urgent: { type: 'noul', noul: 0.7 },
      ...overrides,
    },
    usage: { input_tokens: 304, output_tokens: 18 },
  }
}

function client() {
  return new TypeSafeDecisionClient('ts-test-key', undefined, {
    retryBaseDelayMs: 0,
    timeoutMs: 20,
  })
}

function evaluate(questions: Record<string, DecisionQuestion> = QUESTIONS, state: string = 'hi') {
  return client().evaluate({ provider: 'typesafe', model: 'jev-1.13.0', state, questions })
}

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toVendorQuestion', () => {
  it('maps choice options, score levels and noul criteria onto `criteria`', () => {
    expect(toVendorQuestion(QUESTIONS.intent!)).toEqual({
      type: 'choice',
      instructions: 'What does the customer want?',
      criteria: { refund: 'Money back', tracking: null },
    })
    expect(toVendorQuestion(QUESTIONS.frustration!)).toEqual({
      type: 'score',
      instructions: 'How frustrated is the customer?',
      criteria: ['Calm', 'Frustrated', 'Very angry'],
    })
    expect(toVendorQuestion(QUESTIONS.urgent!)).toEqual({
      type: 'noul',
      instructions: 'Is it urgent?',
      criteria: { true: 'Needs action today' },
    })
    expect(toVendorQuestion({ type: 'noul', instructions: 'x' })).toEqual({
      type: 'noul',
      instructions: 'x',
    })
  })
})

describe('TypeSafeDecisionClient.evaluate', () => {
  it('posts the vendor shape and maps every answer type back', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, okBody()))
    vi.stubGlobal('fetch', fetchMock)

    const result = await evaluate()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(TYPESAFE_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer ts-test-key')
    const sent = JSON.parse(init.body)
    expect(sent.model).toBe('jev-1.13.0')
    expect(sent.state).toBe('hi')
    expect(sent.questions.frustration.criteria).toEqual(['Calm', 'Frustrated', 'Very angry'])

    expect(result).toEqual({
      answers: {
        intent: {
          type: 'choice',
          choice: 'refund',
          probabilities: { refund: 0.9, tracking: 0.1 },
          confidence: 0.8,
        },
        frustration: {
          type: 'score',
          level: 2,
          expected: 2.05,
          probabilities: { '1': 0.0, '2': 0.95, '3': 0.05 },
          confidence: 0.92,
        },
        urgent: { type: 'noul', probability: 0.7 },
      },
      confidenceKind: 'calibrated',
      provider: 'typesafe',
      model: 'jev-1.13.0',
      usage: { inputTokens: 304, outputTokens: 18 },
    })
  })

  it('accepts score probabilities keyed by level text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          200,
          okBody({
            frustration: {
              type: 'score',
              score: 1.8,
              probabilities: { Calm: 0.1, Frustrated: 0.0, 'Very angry': 0.9 },
              confidence: 0.7,
            },
          })
        )
      )
    )
    const result = await evaluate()
    expect(result.answers.frustration).toEqual({
      type: 'score',
      level: 3,
      expected: 2.8,
      probabilities: { '1': 0.1, '2': 0.0, '3': 0.9 },
      confidence: 0.7,
    })
  })

  it('rejects a choice outside the question options, naming the question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          200,
          okBody({
            intent: { type: 'choice', choice: 'cancel', probabilities: {}, confidence: 1 },
          })
        )
      )
    )
    const error = await rejection(evaluate())
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain("'intent'")
  })

  it('retries a 429 and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, 'slow down'))
      .mockResolvedValueOnce(jsonResponse(200, okBody()))
    vi.stubGlobal('fetch', fetchMock)
    const result = await evaluate()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.answers.urgent).toEqual({ type: 'noul', probability: 0.7 })
  })

  it('gives up after three 529s with PROVIDER_UNAVAILABLE and status 529', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(529, 'overloaded'))
    vi.stubGlobal('fetch', fetchMock)
    const error = await rejection(evaluate())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(error).toBeInstanceOf(TypeSafeApiError)
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.status).toBe(529)
  })

  it('throws REQUEST_TIMEOUT when the request is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          })
      )
    )
    const error = await rejection(evaluate())
    expect(error.code).toBe('REQUEST_TIMEOUT')
  })

  it('maps a network failure to PROVIDER_UNAVAILABLE with the cause chained', async () => {
    const cause = new TypeError('fetch failed')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))
    const error = await rejection(evaluate())
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.cause).toBe(cause)
  })

  it('maps 401 to INVALID_CREDENTIALS and 422 to INVALID_REQUEST with the body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, 'nope'))
    vi.stubGlobal('fetch', fetchMock)
    const unauthorized = await rejection(evaluate())
    expect(unauthorized.code).toBe('INVALID_CREDENTIALS')
    expect(unauthorized.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse(422, '{"detail":"criteria too long"}'))
    )
    const invalid = await rejection(evaluate())
    expect(invalid.code).toBe('INVALID_REQUEST')
    expect(invalid.message).toContain('criteria too long')
  })

  it('throws PAYLOAD_TOO_LARGE before any fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const error = await rejection(evaluate(QUESTIONS, 'x'.repeat(4 * 32_000)))
    expect(error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the whole request against the 64k limit', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const questions: Record<string, DecisionQuestion> = {}
    for (let i = 0; i < 12; i++) {
      questions[`q${i}`] = { type: 'noul', instructions: 'y'.repeat(4 * 6_000) }
    }
    const error = await rejection(evaluate(questions, 'short'))
    expect(error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('TypeSafeClient', () => {
  const provider = new TypeSafeClient('org', 'user')

  it('has no specialised client for any model type', () => {
    for (const type of Object.values(ModelType)) {
      expect(() => provider.getClient(type, { apiKey: 'k' })).toThrow(/does not support/)
    }
    expect(() => provider.getClient(ModelType.LLM, { apiKey: 'k' })).toThrow(/does not support/)
  })

  it('returns the native decision client', () => {
    expect(provider.getDecisionClient({ apiKey: 'k' })).toBeInstanceOf(TypeSafeDecisionClient)
  })

  it('tests the connection with one noul question', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { model: 'jev-1.13.0', answers: { ping: { type: 'noul', noul: 0.99 } } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = await provider.testConnection({ apiKey: 'k' })
    expect(result.success).toBe(true)
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(Object.values(sent.questions)).toEqual([expect.objectContaining({ type: 'noul' })])
  })
})
