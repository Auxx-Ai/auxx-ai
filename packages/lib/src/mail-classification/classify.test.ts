// packages/lib/src/mail-classification/classify.test.ts
// The three properties the model call must never lose:
//   • the enum is TAG IDS (invariant 12) and a non-eligible id is refused;
//   • below the threshold NOTHING is applied (C10) — but the confidence is still
//     logged, because that log line IS the tuning data (Q4);
//   • it never throws (invariant 6).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getDefault: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: h.info, warn: h.warn, error: h.error, debug: h.debug }),
}))
vi.mock('../ai/orchestrator/llm-orchestrator', () => ({
  LLMOrchestrator: class {
    invoke = h.invoke
  },
}))
vi.mock('../ai/providers/system-model-service', () => ({
  SystemModelService: class {
    getDefault = h.getDefault
  },
}))
vi.mock('../ai/providers/types', () => ({ ModelType: { LLM: 'LLM' } }))
vi.mock('../ai/usage/usage-tracking-service', () => ({
  UsageTrackingService: class {},
}))

import { buildClassificationPrompt, buildClassificationSchema, classifyMessage } from './classify'
import { MAIL_CLASSIFY_BODY_CHARS, MAIL_CLASSIFY_NO_CATEGORY } from './client'
import type { MailClassificationContext } from './types'

const context: MailClassificationContext = {
  organizationId: 'org_1',
  messageId: 'msg_1',
  threadId: 'thr_1',
  inboxId: 'ibx_1',
  labels: [
    { tagId: 'tag_billing', title: 'Billing', description: 'Invoices, refunds, card charges' },
    { tagId: 'tag_sales', title: 'Sales', description: null },
  ],
  message: { subject: 'Refund', from: 'a@b.com', textPlain: 'please refund me' },
}

const db = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.getDefault.mockResolvedValue({ provider: 'openai', model: 'gpt-x' })
})

describe('the structured-output schema (invariant 12)', () => {
  it('is an OBJECT with a `category` field, not a bare id', () => {
    const schema = buildClassificationSchema(context.labels)
    expect(schema.schema.type).toBe('object')
    expect(Object.keys(schema.schema.properties)).toEqual(['category', 'confidence'])
    expect(schema.schema.required).toEqual(['category', 'confidence'])
  })

  it('enumerates the eligible TAG IDS plus the abstention sentinel — never free text', () => {
    const schema = buildClassificationSchema(context.labels)
    expect(schema.schema.properties.category.enum).toEqual([
      'tag_billing',
      'tag_sales',
      MAIL_CLASSIFY_NO_CATEGORY,
    ])
    expect(schema.schema.properties.category).not.toHaveProperty('pattern')
  })
})

describe('the prompt', () => {
  it('carries each label as title + description — the description IS the definition (C3)', () => {
    const prompt = buildClassificationPrompt(context)
    expect(prompt).toContain('id: tag_billing')
    expect(prompt).toContain('definition: Invoices, refunds, card charges')
    // Q5: a description-less tag is still offered, just as a bare title.
    expect(prompt).toContain('name: Sales')
  })

  it('truncates the body and never includes more than the cap', () => {
    const prompt = buildClassificationPrompt({
      ...context,
      message: { ...context.message, textPlain: 'x'.repeat(MAIL_CLASSIFY_BODY_CHARS + 500) },
    })
    expect(prompt).not.toContain('x'.repeat(MAIL_CLASSIFY_BODY_CHARS + 1))
    expect(prompt).toContain('x'.repeat(MAIL_CLASSIFY_BODY_CHARS))
  })
})

describe('classifyMessage — the confidence threshold (C10 / Q4)', () => {
  it('applies the tag at or above the threshold', async () => {
    h.invoke.mockResolvedValue({ structured_output: { category: 'tag_billing', confidence: 0.7 } })

    await expect(classifyMessage(db, context)).resolves.toEqual({
      tagId: 'tag_billing',
      confidence: 0.7,
      model: 'gpt-x',
    })
  })

  it('⚠️ BELOW the threshold applies nothing — but STILL logs the confidence', async () => {
    h.invoke.mockResolvedValue({ structured_output: { category: 'tag_billing', confidence: 0.55 } })

    const result = await classifyMessage(db, context)

    expect(result).toEqual({
      tagId: null,
      confidence: 0.55,
      reason: 'below-threshold',
      model: 'gpt-x',
    })
    // The below-threshold rows are the most informative for tuning and the
    // easiest to forget: there is no column, the log IS the data.
    const logged = h.info.mock.calls.find(([msg]) => msg === 'Mail classification result')
    expect(logged?.[1]).toMatchObject({
      messageId: 'msg_1',
      confidence: 0.55,
      applied: false,
      // The model's pick is kept for tuning; `tagId` (what was written) is null.
      chosenTagId: 'tag_billing',
      tagId: null,
    })
  })

  it('logs the confidence on an APPLIED call too', async () => {
    h.invoke.mockResolvedValue({ structured_output: { category: 'tag_sales', confidence: 0.93 } })

    await classifyMessage(db, context)

    const logged = h.info.mock.calls.find(([msg]) => msg === 'Mail classification result')
    expect(logged?.[1]).toMatchObject({ confidence: 0.93, applied: true, tagId: 'tag_sales' })
  })
})

describe('classifyMessage — the model cannot return a non-eligible id', () => {
  it('refuses an id outside the eligible set, even at full confidence', async () => {
    h.invoke.mockResolvedValue({ structured_output: { category: 'tag_invented', confidence: 1 } })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'no-category',
    })
  })

  it('treats the abstention sentinel as "apply nothing"', async () => {
    h.invoke.mockResolvedValue({
      structured_output: { category: MAIL_CLASSIFY_NO_CATEGORY, confidence: 0.99 },
    })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'no-category',
    })
  })

  it('treats a malformed payload as "apply nothing"', async () => {
    h.invoke.mockResolvedValue({ structured_output: undefined })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      confidence: 0,
      reason: 'no-category',
    })
  })
})

describe('classifyMessage — usage attribution + never throws', () => {
  it('tags the spend with the `mail_classification` source arm', async () => {
    h.invoke.mockResolvedValue({ structured_output: { category: 'tag_billing', confidence: 0.9 } })

    await classifyMessage(db, context)

    expect(h.invoke.mock.calls[0]?.[0]?.context).toMatchObject({
      source: 'mail_classification',
      messageId: 'msg_1',
    })
  })

  it('a provider failure logs and leaves the thread untagged', async () => {
    h.invoke.mockRejectedValue(new Error('429'))

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'error',
    })
    expect(h.warn).toHaveBeenCalled()
  })

  it('no default LLM is a skip, not an error — and costs no call', async () => {
    h.getDefault.mockResolvedValue(null)

    await expect(classifyMessage(db, context)).resolves.toEqual({
      tagId: null,
      confidence: 0,
      reason: 'no-default-model',
    })
    expect(h.invoke).not.toHaveBeenCalled()
  })
})
