// packages/lib/src/mail-classification/__tests__/classify.test.ts
// The properties the model call must never lose:
//   • the category options are TAG IDS (invariant 12) and a non-eligible id is refused;
//   • below the threshold for the result's confidence kind NOTHING is applied (C10),
//     but the confidence is still logged (Q4);
//   • the triage is mapped onto the four Thread column values (03 §5.2);
//   • it never throws (invariant 6).

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  evaluate: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: h.info, warn: h.warn, error: h.error, debug: h.debug }),
}))
vi.mock('../../ai/decision/evaluate', () => ({ evaluate: h.evaluate }))

import type { DecisionAnswer, DecisionResult } from '../../ai/decision/client'
import { QuotaExceededError } from '../../ai/errors/quota-errors'
import {
  buildClassificationQuestions,
  buildClassificationState,
  classifyMessage,
  MAIL_CLASSIFICATION_FALLBACK_MODEL,
  MAIL_CLASSIFICATION_MODEL,
  toTriage,
} from '../classify'
import {
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_CLASSIFY_DESCRIPTION_CHARS,
  MAIL_CLASSIFY_NO_CATEGORY,
} from '../client'
import type { MailClassificationContext } from '../types'

const context: MailClassificationContext = {
  organizationId: 'org_1',
  messageId: 'msg_1',
  threadId: 'thr_1',
  inboxId: 'ibx_1',
  labels: [
    { tagId: 'tag_billing', title: 'Billing', description: 'Invoices, refunds, card charges' },
    { tagId: 'tag_sales', title: 'Sales', description: null },
  ],
  message: {
    subject: 'Refund',
    from: 'a@b.com',
    textPlain: 'please refund me',
    senderAuthenticated: true,
  },
}

const db = {} as never

const TRIAGE: Record<string, DecisionAnswer> = {
  priority: { type: 'score', level: 3, expected: null, probabilities: null, confidence: 0.9 },
  needsReply: { type: 'noul', probability: 0.8 },
  sentiment: { type: 'score', level: 2, expected: null, probabilities: null, confidence: 0.9 },
  spam: { type: 'noul', probability: 0.05 },
}

function decided(
  choice: string,
  confidence: number,
  overrides: Partial<DecisionResult> & { triage?: Record<string, DecisionAnswer> } = {}
) {
  const { triage = TRIAGE, ...rest } = overrides
  return ok<DecisionResult, Error>({
    answers: {
      category: { type: 'choice', choice, probabilities: null, confidence },
      ...triage,
    },
    confidenceKind: 'self-reported',
    provider: 'openai',
    model: 'gpt-x',
    usage: { inputTokens: 10, outputTokens: 5 },
    ...rest,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the questions (invariant 12)', () => {
  it('offers the eligible TAG IDS plus the abstention sentinel as the category options', () => {
    const { category } = buildClassificationQuestions(context.labels)
    expect(category?.type).toBe('choice')
    if (category?.type !== 'choice') return
    expect(Object.keys(category.options)).toEqual([
      'tag_billing',
      'tag_sales',
      MAIL_CLASSIFY_NO_CATEGORY,
    ])
    // C3: the description is the definition; Q5: a bare title is still offered.
    expect(category.options.tag_billing).toBe('Billing: Invoices, refunds, card charges')
    expect(category.options.tag_sales).toBe('Sales')
  })

  it('clamps each tag description', () => {
    const { category } = buildClassificationQuestions([
      { tagId: 't', title: 'Long', description: 'd'.repeat(MAIL_CLASSIFY_DESCRIPTION_CHARS * 2) },
    ])
    if (category?.type !== 'choice') throw new Error('expected a choice')
    expect(category.options.t!.length).toBeLessThan(MAIL_CLASSIFY_DESCRIPTION_CHARS + 20)
  })

  it('asks the four triage questions in the same call', () => {
    const questions = buildClassificationQuestions(context.labels)
    expect(Object.keys(questions)).toEqual([
      'category',
      'priority',
      'needsReply',
      'sentiment',
      'spam',
    ])
    expect(questions.priority).toMatchObject({ type: 'score' })
    expect(questions.sentiment).toMatchObject({ type: 'score' })
    expect(questions.needsReply).toMatchObject({ type: 'noul' })
    expect(questions.spam).toMatchObject({ type: 'noul' })
  })
})

describe('the state', () => {
  it('truncates the body and carries the sender-authentication verdict', () => {
    const state = buildClassificationState({
      ...context,
      message: { ...context.message, textPlain: 'x'.repeat(MAIL_CLASSIFY_BODY_CHARS + 500) },
    }) as Record<string, unknown>
    expect(state.body).toBe('x'.repeat(MAIL_CLASSIFY_BODY_CHARS))
    expect(state.senderAuthenticated).toBe(true)
    expect(state.from).toBe('a@b.com')
  })
})

describe('toTriage (03 §5.2)', () => {
  const answers = {
    priority: { level: 4, confidence: 0.9 },
    needsReply: { probability: 0.6 },
    sentiment: { level: 1, confidence: 0.9 },
    spam: { probability: 0.97 },
  }

  it('maps confident levels onto the column enums', () => {
    expect(toTriage(answers, 0.7)).toMatchObject({
      priority: 'URGENT',
      needsReply: true,
      sentiment: 'NEGATIVE',
      spamScore: 0.97,
    })
  })

  it('maps Frustrated to NEGATIVE and Positive to POSITIVE', () => {
    expect(toTriage({ ...answers, sentiment: { level: 2, confidence: 1 } }, 0.7).sentiment).toBe(
      'NEGATIVE'
    )
    expect(toTriage({ ...answers, sentiment: { level: 4, confidence: 1 } }, 0.7).sentiment).toBe(
      'POSITIVE'
    )
  })

  it('an unsure score falls back to MEDIUM / NEUTRAL; probabilities are stored as-is', () => {
    const unsure = {
      ...answers,
      priority: { level: 4, confidence: 0.3 },
      sentiment: { level: 1, confidence: 0.3 },
      needsReply: { probability: 0.2 },
    }
    expect(toTriage(unsure, 0.7)).toMatchObject({
      priority: 'MEDIUM',
      sentiment: 'NEUTRAL',
      needsReply: false,
      spamScore: 0.97,
      answers: unsure,
    })
  })
})

describe('classifyMessage — the confidence threshold (C10 / Q4)', () => {
  it('applies the tag at or above the self-reported threshold', async () => {
    h.evaluate.mockResolvedValue(decided('tag_billing', 0.7))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: 'tag_billing',
      confidence: 0.7,
      confidenceKind: 'self-reported',
      model: 'gpt-x',
      inferred: true,
      triage: { priority: 'HIGH', needsReply: true, sentiment: 'NEGATIVE', spamScore: 0.05 },
    })
  })

  it('⚠️ BELOW the threshold applies nothing — but STILL logs and triages', async () => {
    h.evaluate.mockResolvedValue(decided('tag_billing', 0.55))

    const result = await classifyMessage(db, context)

    expect(result).toMatchObject({
      tagId: null,
      confidence: 0.55,
      reason: 'below-threshold',
      inferred: true,
    })
    expect(result.triage?.priority).toBe('HIGH')
    const logged = h.info.mock.calls.find(([msg]) => msg === 'Mail classification result')
    expect(logged?.[1]).toMatchObject({
      messageId: 'msg_1',
      confidence: 0.55,
      confidenceKind: 'self-reported',
      applied: false,
      chosenTagId: 'tag_billing',
      tagId: null,
    })
  })

  it('never applies a self-reported threshold to a calibrated confidence (D4)', async () => {
    h.evaluate.mockResolvedValue(decided('tag_billing', 0.8, { confidenceKind: 'calibrated' }))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'below-threshold',
      confidenceKind: 'calibrated',
    })
  })
})

describe('classifyMessage — the model cannot return a non-eligible id', () => {
  it('refuses an id outside the eligible set, even at full confidence', async () => {
    h.evaluate.mockResolvedValue(decided('tag_invented', 1))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'no-category',
      inferred: true,
    })
  })

  it('treats the abstention sentinel as "apply nothing" and still triages', async () => {
    h.evaluate.mockResolvedValue(decided(MAIL_CLASSIFY_NO_CATEGORY, 0.99))

    const result = await classifyMessage(db, context)
    expect(result).toMatchObject({ tagId: null, reason: 'no-category', inferred: true })
    expect(result.triage).toBeDefined()
  })

  it('a missing triage answer is a failed call, not an inference', async () => {
    const { spam: _spam, ...partial } = TRIAGE
    h.evaluate.mockResolvedValue(decided('tag_billing', 0.9, { triage: partial }))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'error',
      inferred: false,
    })
  })
})

describe('classifyMessage — usage attribution + never throws', () => {
  it('runs on the decision runner as background work, attributed to the message', async () => {
    h.evaluate.mockResolvedValue(decided('tag_billing', 0.9))

    await classifyMessage(db, context)

    expect(h.evaluate.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org_1',
      userId: null,
      source: 'mail_classification',
      sourceId: 'msg_1',
    })
  })

  it('always runs on the platform models with SYSTEM credentials, never the org defaults', async () => {
    h.evaluate.mockResolvedValue(decided('tag_billing', 0.95, { confidenceKind: 'calibrated' }))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({ tagId: 'tag_billing' })
    expect(h.evaluate.mock.calls[0]?.[1]).toMatchObject({
      model: { provider: 'typesafe', model: 'jev-1.13.0' },
      fallbackModel: { provider: 'openai', model: 'gpt-5.4-nano' },
      forceSystem: true,
    })
    expect(MAIL_CLASSIFICATION_MODEL).toEqual({ provider: 'typesafe', model: 'jev-1.13.0' })
    expect(MAIL_CLASSIFICATION_FALLBACK_MODEL).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-nano',
    })
  })
})

describe('classifyMessage — a failed call NEVER counts as an inference', () => {
  // `inferred` gates the C9 marker; a `true` here disqualifies the message forever.
  const FAILURES: Array<[string, unknown, string]> = [
    ['a bare 429', new Error('Request failed with status 429'), 'unavailable'],
    [
      'the Anthropic client’s status-less rate-limit Error',
      new Error('Anthropic API rate limit exceeded'),
      'unavailable',
    ],
    [
      'a 503 carried as a numeric status',
      Object.assign(new Error('nope'), { status: 503 }),
      'unavailable',
    ],
    [
      'a dropped socket',
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      'unavailable',
    ],
    ['an unexpected bug', new Error('cannot read properties of undefined'), 'error'],
  ]

  for (const [label, failure, reason] of FAILURES) {
    it(`${label} → reason "${reason}", inferred false`, async () => {
      h.evaluate.mockResolvedValue(err(failure))

      await expect(classifyMessage(db, context)).resolves.toMatchObject({
        tagId: null,
        reason,
        inferred: false,
      })
    })
  }

  it('⚠️ unwraps the orchestrator’s re-wrap to find a quota error', async () => {
    const quota = new QuotaExceededError("You're out of AI credits.", { provider: 'openai' })
    h.evaluate.mockResolvedValue(
      err(
        Object.assign(new Error('LLM invocation failed: out of credits'), { originalError: quota })
      )
    )

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'quota-exceeded',
      inferred: false,
    })
  })

  it('survives a self-referential error chain instead of spinning', async () => {
    const loop = new Error('boom') as Error & { originalError?: Error }
    loop.originalError = loop
    h.evaluate.mockResolvedValue(err(loop))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({ reason: 'error' })
  })

  it('logs an unexpected failure at error level, a transient one at warn', async () => {
    h.evaluate.mockResolvedValue(err(new Error('totally unexpected')))
    await classifyMessage(db, context)
    expect(h.error).toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()

    h.error.mockClear()
    h.evaluate.mockResolvedValue(err(new Error('429 too many requests')))
    await classifyMessage(db, context)
    expect(h.warn).toHaveBeenCalled()
    expect(h.error).not.toHaveBeenCalled()
  })
})
