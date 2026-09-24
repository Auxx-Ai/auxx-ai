// packages/lib/src/ai/providers/typesafe/typesafe-decision-client.ts

import type { Logger } from '@auxx/logger'
import { UnprocessableEntityError } from '../../../errors'
import { DecisionClient, type DecisionEvaluateParams } from '../../clients/base/decision-client'
import { DEFAULT_CLIENT_CONFIG } from '../../clients/base/types'
import type { DecisionAnswer, DecisionQuestion, DecisionResult } from '../../decision/client'
import { ProviderError } from '../base/types'

const PROVIDER_ID = 'typesafe'
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** Vendor limits (docs.typesafe.ai/models.md): per request, and state + longest question. */
export const TYPESAFE_MAX_REQUEST_TOKENS = 64_000
export const TYPESAFE_MAX_STATE_QUESTION_TOKENS = 32_000

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_BASE_DELAY_MS = 200
const MAX_ATTEMPTS = 3
const RETRYABLE_STATUSES = new Set([429, 529])

/** Rough token estimate; the vendor tokenizer is not public. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** A ProviderError carrying the HTTP status the runner's fallback logic keys on. */
export class TypeSafeApiError extends ProviderError {
  constructor(
    message: string,
    code: string,
    public status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, PROVIDER_ID, code)
    this.name = 'TypeSafeApiError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

type VendorQuestion = {
  type: DecisionQuestion['type']
  instructions: string
  criteria?: Record<string, string | null> | string[] | { true?: string; false?: string }
}

type VendorAnswer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number>; confidence: number }
  | {
      type: 'score'
      score: number
      legend?: Record<string, string>
      probabilities?: Record<string, number>
      confidence: number
    }
  | { type: 'noul'; noul: number }

type VendorResponse = {
  model: string
  answers: Record<string, VendorAnswer>
  usage?: { input_tokens?: number | null; output_tokens?: number | null }
}

/** Map our question vocabulary onto the vendor's `criteria` field. */
export function toVendorQuestion(question: DecisionQuestion): VendorQuestion {
  switch (question.type) {
    case 'choice':
      return { type: 'choice', instructions: question.instructions, criteria: question.options }
    case 'score':
      return { type: 'score', instructions: question.instructions, criteria: question.levels }
    case 'noul':
      return question.criteria
        ? { type: 'noul', instructions: question.instructions, criteria: question.criteria }
        : { type: 'noul', instructions: question.instructions }
  }
}

/**
 * Re-key a score distribution to our 1-based level index. The vendor keys by 0-based level
 * number with a `legend`; a text-keyed map is accepted too.
 */
function normaliseScoreProbabilities(
  questionId: string,
  levels: string[],
  probabilities: Record<string, number>,
  legend: Record<string, string> | undefined
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, p] of Object.entries(probabilities)) {
    let index = -1
    const legendText = legend?.[key]
    if (legendText !== undefined) index = levels.indexOf(legendText)
    if (index === -1 && /^\d+$/.test(key) && Number(key) < levels.length) index = Number(key)
    if (index === -1) index = levels.indexOf(key)
    if (index === -1) {
      throw new UnprocessableEntityError(
        `TypeSafe returned an unknown level '${key}' for score question '${questionId}'`
      )
    }
    out[String(index + 1)] = p
  }
  return out
}

/** Map one vendor answer back to our shape, rejecting anything outside the question's domain. */
export function fromVendorAnswer(
  questionId: string,
  question: DecisionQuestion,
  answer: VendorAnswer | undefined
): DecisionAnswer {
  if (!answer || answer.type !== question.type) {
    throw new UnprocessableEntityError(
      `TypeSafe returned no ${question.type} answer for question '${questionId}'`
    )
  }

  if (answer.type === 'choice' && question.type === 'choice') {
    if (!Object.hasOwn(question.options, answer.choice)) {
      throw new UnprocessableEntityError(
        `TypeSafe chose '${answer.choice}', not an option of question '${questionId}'`
      )
    }
    return {
      type: 'choice',
      choice: answer.choice,
      probabilities: answer.probabilities ?? null,
      confidence: answer.confidence,
    }
  }

  if (answer.type === 'score' && question.type === 'score') {
    const probabilities = answer.probabilities
      ? normaliseScoreProbabilities(
          questionId,
          question.levels,
          answer.probabilities,
          answer.legend
        )
      : null
    let level = 0
    let best = -1
    for (const [key, p] of Object.entries(probabilities ?? {})) {
      const candidate = Number(key)
      if (p > best || (p === best && candidate < level)) {
        best = p
        level = candidate
      }
    }
    // Vendor `score` is the weighted mean of 0-based level numbers; shift onto `level`'s scale.
    const expected = answer.score + 1
    if (level === 0) level = Math.min(question.levels.length, Math.max(1, Math.round(expected)))
    return { type: 'score', level, expected, probabilities, confidence: answer.confidence }
  }

  if (answer.type === 'noul') return { type: 'noul', probability: answer.noul }

  throw new UnprocessableEntityError(`TypeSafe answer for '${questionId}' has an unknown type`)
}

/** Throws PAYLOAD_TOO_LARGE before sending; callers clamp their state, this is not a fallback. */
export function assertWithinLimits(
  state: DecisionEvaluateParams['state'],
  vendorQuestions: Record<string, VendorQuestion>,
  body: string
): void {
  const stateChars = typeof state === 'string' ? state.length : JSON.stringify(state).length
  const longestQuestion = Math.max(
    0,
    ...Object.values(vendorQuestions).map((q) => JSON.stringify(q).length)
  )
  const combined = estimateTokens(stateChars + longestQuestion)
  const total = estimateTokens(body.length)
  if (combined > TYPESAFE_MAX_STATE_QUESTION_TOKENS || total > TYPESAFE_MAX_REQUEST_TOKENS) {
    throw new TypeSafeApiError(
      `TypeSafe request too large: ~${combined} tokens of state + longest question (max ${TYPESAFE_MAX_STATE_QUESTION_TOKENS}), ~${total} in total (max ${TYPESAFE_MAX_REQUEST_TOKENS})`,
      'PAYLOAD_TOO_LARGE'
    )
  }
}

export interface TypeSafeDecisionClientOptions {
  timeoutMs?: number
  retryBaseDelayMs?: number
}

/** Native decision client for TypeSafe's Jev; quota and usage tracking belong to the runner. */
export class TypeSafeDecisionClient extends DecisionClient {
  private readonly timeoutMs: number
  private readonly retryBaseDelayMs: number

  constructor(
    private readonly apiKey: string,
    logger?: Logger,
    options: TypeSafeDecisionClientOptions = {}
  ) {
    super(DEFAULT_CLIENT_CONFIG, 'TypeSafeDecisionClient', logger)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  }

  async evaluate({ model, state, questions }: DecisionEvaluateParams): Promise<DecisionResult> {
    const vendorQuestions: Record<string, VendorQuestion> = {}
    for (const [id, question] of Object.entries(questions)) {
      vendorQuestions[id] = toVendorQuestion(question)
    }
    const body = JSON.stringify({ model, state, questions: vendorQuestions })
    assertWithinLimits(state, vendorQuestions, body)

    const response = await this.postWithRetry(body)

    const answers: Record<string, DecisionAnswer> = {}
    for (const [id, question] of Object.entries(questions)) {
      answers[id] = fromVendorAnswer(id, question, response.answers?.[id])
    }

    return {
      answers,
      confidenceKind: 'calibrated',
      provider: PROVIDER_ID,
      model: response.model ?? model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    }
  }

  private async postWithRetry(body: string): Promise<VendorResponse> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.post(body)
      if (res.ok) return (await res.json()) as VendorResponse

      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        await sleep(this.retryBaseDelayMs * 2 ** (attempt - 1))
        continue
      }
      throw await toHttpError(res, attempt)
    }
  }

  private async post(body: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(TYPESAFE_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TypeSafeApiError(
          `TypeSafe request timed out after ${this.timeoutMs}ms`,
          'REQUEST_TIMEOUT',
          undefined,
          { cause: error }
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new TypeSafeApiError(
        `TypeSafe request failed: ${message}`,
        'PROVIDER_UNAVAILABLE',
        undefined,
        {
          cause: error,
        }
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

async function toHttpError(res: Response, attempts: number): Promise<TypeSafeApiError> {
  const text = await res.text().catch(() => '')
  const detail = text ? `: ${text.slice(0, 500)}` : ''
  if (res.status === 401) {
    return new TypeSafeApiError('TypeSafe rejected the API key', 'INVALID_CREDENTIALS', 401)
  }
  if (res.status === 422) {
    return new TypeSafeApiError(`TypeSafe rejected the request${detail}`, 'INVALID_REQUEST', 422)
  }
  if (RETRYABLE_STATUSES.has(res.status) || res.status >= 500) {
    return new TypeSafeApiError(
      `TypeSafe unavailable (HTTP ${res.status}) after ${attempts} attempt(s)${detail}`,
      'PROVIDER_UNAVAILABLE',
      res.status
    )
  }
  return new TypeSafeApiError(`TypeSafe HTTP ${res.status}${detail}`, 'PROVIDER_ERROR', res.status)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
