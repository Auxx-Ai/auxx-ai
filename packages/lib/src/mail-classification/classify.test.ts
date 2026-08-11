// packages/lib/src/mail-classification/classify.test.ts
// The three properties the model call must never lose:
//   • the enum is TAG IDS (invariant 12) and a non-eligible id is refused;
//   • below the threshold NOTHING is applied (C10) — but the confidence is still
//     logged, because that log line IS the tuning data (Q4);
//   • it never throws (invariant 6).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCachedDefaultModel: vi.fn(),
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
vi.mock('../cache', () => ({ getCachedDefaultModel: h.getCachedDefaultModel }))
// ⚠️ PARTIAL. A full replacement returning only `ModelType` worked until
// `classify.ts` imported `../cache`, whose graph reaches `provider-registry` →
// `anthropic-defaults`, which reads `FetchFrom` from this same module at import
// time. The whole file then died at COLLECTION with "No FetchFrom export is
// defined on the mock" — a failure that looks nothing like its cause. Keep the
// real module and override only what needs overriding.
vi.mock('../ai/providers/types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/providers/types')>()),
  ModelType: { LLM: 'LLM' },
}))
vi.mock('../ai/usage/usage-tracking-service', () => ({
  UsageTrackingService: class {},
}))

import { QuotaExceededError } from '../ai/errors/quota-errors'
import { buildClassificationPrompt, buildClassificationSchema, classifyMessage } from './classify'
import {
  MAIL_CLASSIFY_ALT_TAG_CHARS,
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_CLASSIFY_NO_CATEGORY,
  MAIL_CLASSIFY_SUMMARY_CHARS,
} from './client'
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
  h.getCachedDefaultModel.mockResolvedValue({ provider: 'openai', model: 'gpt-x' })
})

describe('the structured-output schema (invariant 12)', () => {
  it('is an OBJECT with a `category` field, not a bare id', () => {
    const schema = buildClassificationSchema(context.labels)
    expect(schema.schema.type).toBe('object')
    expect(Object.keys(schema.schema.properties)).toEqual([
      'category',
      'confidence',
      'messageSummary',
      'altTagName',
    ])
  })

  it('⚠️ requires EVERY property — "optional" does not survive the provider layer (08 T2)', () => {
    const schema = buildClassificationSchema(context.labels)
    // `openai-llm-client.ts` overwrites `required` with `Object.keys(properties)`
    // while `anthropic-llm-client.ts` passes ours through to the forced tool's
    // `input_schema` untouched. Declaring a property optional therefore means a
    // different contract per provider, decided by the org's default model. The
    // absent case is carried as a VALUE (`''`, and `__none__` for `category`).
    expect(schema.schema.required).toEqual(Object.keys(schema.schema.properties))
  })

  it('states lengths in prose, never as a `maxLength` keyword (not portable under strict)', () => {
    const schema = buildClassificationSchema(context.labels)
    expect(schema.schema.properties.messageSummary).not.toHaveProperty('maxLength')
    expect(schema.schema.properties.altTagName).not.toHaveProperty('maxLength')
    expect(schema.schema.properties.messageSummary.description).toContain(
      String(MAIL_CLASSIFY_SUMMARY_CHARS)
    )
  })

  it('keeps `category` first, so the decision is generated before the extras', () => {
    const schema = buildClassificationSchema(context.labels)
    expect(Object.keys(schema.schema.properties)[0]).toBe('category')
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
      inferred: true,
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
      // The call completed and was paid for — "not confident enough" is an
      // answer, so the message is done and the marker may go down.
      inferred: true,
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

describe('classifyMessage — the summary and the candidate label (08 phase 1)', () => {
  it('captures the summary on an applied classification', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: 'tag_billing',
        confidence: 0.9,
        messageSummary: 'The customer wants a refund for a duplicate charge.',
        altTagName: '',
      },
    })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: 'tag_billing',
      messageSummary: 'The customer wants a refund for a duplicate charge.',
    })
  })

  it('captures the candidate label when the model abstained', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: MAIL_CLASSIFY_NO_CATEGORY,
        confidence: 0.95,
        messageSummary: 'The sender is asking about a wholesale account.',
        altTagName: 'wholesale enquiry',
      },
    })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'no-category',
      altTagName: 'wholesale enquiry',
    })
  })

  it('captures it on a BELOW-THRESHOLD pick too — the boundary is the signal (08 T3)', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: 'tag_billing',
        confidence: 0.55,
        messageSummary: 'A chargeback notice from the payment processor.',
        altTagName: 'chargeback',
      },
    })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'below-threshold',
      altTagName: 'chargeback',
    })
  })

  it('⚠️ DROPS the candidate label when a tag was actually applied', async () => {
    // The prompt says to leave it empty when a category fitted; a model that
    // fills it in anyway must not seed the miner with candidates arguing for
    // tags the org demonstrably already has.
    h.invoke.mockResolvedValue({
      structured_output: {
        category: 'tag_billing',
        confidence: 0.95,
        messageSummary: 'A refund request.',
        altTagName: 'refunds',
      },
    })

    const result = await classifyMessage(db, context)
    expect(result.tagId).toBe('tag_billing')
    expect(result).not.toHaveProperty('altTagName')
  })

  it('⚠️ DROPS it on an INELIGIBLE pick — that is not an abstention', async () => {
    // `reason: 'no-category'` covers two different events: the model returned
    // `__none__` (your taxonomy has no tag for this — real evidence for a new
    // tag), and the model returned an id outside the eligible set (it believed
    // it HAD classified the mail; the id just does not exist). Only the first is
    // mineable, and the candidate corpus is stored verbatim and clustered months
    // later (08 T5), so noise written here is noise the miner reads then.
    h.invoke.mockResolvedValue({
      structured_output: {
        category: 'tag_does_not_exist',
        confidence: 0.95,
        messageSummary: 'A question about a wholesale account.',
        altTagName: 'wholesale enquiry',
      },
    })

    const result = await classifyMessage(db, context)
    expect(result).toMatchObject({ tagId: null, reason: 'no-category' })
    expect(result).not.toHaveProperty('altTagName')
    // The summary is unaffected — it describes the message, not the decision.
    expect(result.messageSummary).toBe('A question about a wholesale account.')
  })

  it('treats the empty-string sentinel as "nothing to record", not as a value', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: MAIL_CLASSIFY_NO_CATEGORY,
        confidence: 0.9,
        messageSummary: '   ',
        altTagName: '',
      },
    })

    const result = await classifyMessage(db, context)
    expect(result).not.toHaveProperty('altTagName')
    expect(result).not.toHaveProperty('messageSummary')
  })

  it('clamps both in TypeScript — the schema states the limit, the clamp holds it', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: MAIL_CLASSIFY_NO_CATEGORY,
        confidence: 0.9,
        messageSummary: 'y'.repeat(MAIL_CLASSIFY_SUMMARY_CHARS + 400),
        altTagName: 'z'.repeat(MAIL_CLASSIFY_ALT_TAG_CHARS + 40),
      },
    })

    const result = await classifyMessage(db, context)
    expect(result.messageSummary).toHaveLength(MAIL_CLASSIFY_SUMMARY_CHARS)
    expect(result.altTagName).toHaveLength(MAIL_CLASSIFY_ALT_TAG_CHARS)
  })

  it('survives wrong types without becoming a failure arm (invariant 6)', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: 'tag_billing',
        confidence: 0.9,
        messageSummary: { not: 'a string' },
        altTagName: 42,
      },
    })

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: 'tag_billing',
      inferred: true,
    })
  })

  it('captures NOTHING when the call failed — same gate as the tag', async () => {
    h.invoke.mockRejectedValue(new Error('429'))

    const result = await classifyMessage(db, context)
    expect(result.inferred).toBe(false)
    expect(result).not.toHaveProperty('messageSummary')
    expect(result).not.toHaveProperty('altTagName')
  })

  it('logs the candidate label but NOT the summary (customer prose stays out of logs)', async () => {
    h.invoke.mockResolvedValue({
      structured_output: {
        category: MAIL_CLASSIFY_NO_CATEGORY,
        confidence: 0.9,
        messageSummary: 'A wholesale enquiry from a boutique.',
        altTagName: 'wholesale enquiry',
      },
    })

    await classifyMessage(db, context)

    const logged = h.info.mock.calls.find(([msg]) => msg === 'Mail classification result')?.[1]
    expect(logged).toMatchObject({ altTagName: 'wholesale enquiry', hasSummary: true })
    expect(JSON.stringify(logged)).not.toContain('boutique')
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
      reason: 'unavailable',
    })
    expect(h.warn).toHaveBeenCalled()
  })

  it('no default LLM is a skip, not an error — and costs no call', async () => {
    h.getCachedDefaultModel.mockResolvedValue(null)

    await expect(classifyMessage(db, context)).resolves.toEqual({
      tagId: null,
      confidence: 0,
      reason: 'no-default-model',
      inferred: false,
    })
    expect(h.invoke).not.toHaveBeenCalled()
  })
})

describe('classifyMessage — a failed call NEVER counts as an inference', () => {
  // ⚠️ The whole point of this block. `inferred` is what `job.ts` gates the C9
  // marker on, so a `true` here would disqualify the message from ever being
  // classified — for a call that cost nothing and decided nothing. One 429 used
  // to be permanent.
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

  for (const [label, thrown, reason] of FAILURES) {
    it(`${label} → reason "${reason}", inferred false`, async () => {
      h.invoke.mockRejectedValue(thrown)

      await expect(classifyMessage(db, context)).resolves.toMatchObject({
        tagId: null,
        reason,
        inferred: false,
      })
    })
  }

  it('⚠️ unwraps the orchestrator’s re-wrap to find a quota error', async () => {
    // `LLMOrchestrator.invoke` runs its quota gate INSIDE the try that re-wraps
    // everything into an OrchestratorError, so `instanceof QuotaExceededError`
    // is false at this call site and only the chain walk recovers it.
    const quota = new QuotaExceededError("You're out of AI credits.", { provider: 'openai' })
    h.invoke.mockRejectedValue(
      Object.assign(new Error('LLM invocation failed: out of credits'), { originalError: quota })
    )

    await expect(classifyMessage(db, context)).resolves.toMatchObject({
      tagId: null,
      reason: 'quota-exceeded',
      inferred: false,
    })
  })

  it('finds a quota error nested two wrappers deep', async () => {
    const quota = new QuotaExceededError('out of credits')
    const inner = Object.assign(new Error('OpenAI-LLM invoke failed'), { originalError: quota })
    h.invoke.mockRejectedValue(
      Object.assign(new Error('LLM invocation failed'), { originalError: inner })
    )

    await expect(classifyMessage(db, context)).resolves.toMatchObject({ reason: 'quota-exceeded' })
  })

  it('survives a self-referential error chain instead of spinning', async () => {
    const loop = new Error('boom') as Error & { originalError?: Error }
    loop.originalError = loop
    h.invoke.mockRejectedValue(loop)

    await expect(classifyMessage(db, context)).resolves.toMatchObject({ reason: 'error' })
  })

  it('logs an unexpected failure at error level, a transient one at warn', async () => {
    h.invoke.mockRejectedValue(new Error('totally unexpected'))
    await classifyMessage(db, context)
    expect(h.error).toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()

    vi.clearAllMocks()
    h.getCachedDefaultModel.mockResolvedValue({ provider: 'openai', model: 'gpt-x' })
    h.invoke.mockRejectedValue(new Error('429 too many requests'))
    await classifyMessage(db, context)
    expect(h.warn).toHaveBeenCalled()
    expect(h.error).not.toHaveBeenCalled()
  })
})
