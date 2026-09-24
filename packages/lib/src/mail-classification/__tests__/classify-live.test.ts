// packages/lib/src/mail-classification/__tests__/classify-live.test.ts
//
// The real classification prompt (category + four triage questions) against both pinned
// models. Opt-in: LIVE_API_TESTS=1 plus TYPESAFE_API_KEY and/or OPENAI_API_KEY. Semantic
// checks are limited to unambiguous mails so model drift does not make this flaky.

import { describe, expect, it } from 'vitest'
import type { DecisionClient } from '../../ai/clients/base/decision-client'
import { LlmDecisionClient } from '../../ai/decision/llm-decision-client'
import { TypeSafeDecisionClient } from '../../ai/providers/typesafe/typesafe-decision-client'
import { canRunLiveApi } from '../../test/live-api'
import { liveOrchestrator } from '../../test/live-llm-orchestrator'
import {
  buildClassificationQuestions,
  buildClassificationState,
  MAIL_CLASSIFICATION_FALLBACK_MODEL,
  MAIL_CLASSIFICATION_MODEL,
  toTriage,
} from '../classify'
import { MAIL_CLASSIFY_CONFIDENCE_THRESHOLD, type MailClassificationLabel } from '../client'
import type { MailClassificationContext } from '../types'

const LABELS: MailClassificationLabel[] = [
  { tagId: 'tag_billing', title: 'Billing', description: 'Invoices, refunds, double charges' },
  { tagId: 'tag_shipping', title: 'Shipping', description: 'Where is my order, delivery problems' },
  { tagId: 'tag_sales', title: 'Sales', description: 'Pre-sale questions, wholesale, quotes' },
]

function context(
  message: Partial<MailClassificationContext['message']>,
  labels = LABELS
): MailClassificationContext {
  return {
    organizationId: 'org_live',
    messageId: 'msg_live',
    threadId: 'thr_live',
    inboxId: 'ibx_live',
    labels,
    message: {
      subject: null,
      from: 'customer@example.com',
      textPlain: null,
      senderAuthenticated: true,
      ...message,
    },
  }
}

const REFUND = context({
  subject: 'Charged twice for order #4521',
  textPlain: 'Hi, my card was charged twice for order #4521. Please refund the duplicate charge.',
})
const PHISHING = context({
  subject: 'URGENT: your account will be suspended',
  from: 'security@paypa1-verify.xyz',
  senderAuthenticated: false,
  textPlain:
    'Your account has been limited. Verify your identity within 24 hours at http://paypa1-verify.xyz/login or it will be permanently closed.',
})
const ANGRY = context({
  subject: 'THIRD time asking — where is my order??',
  textPlain:
    'This is ridiculous. I have emailed three times and nobody answers. My order is two weeks late and I need it for an event on Saturday. Fix this NOW or I am disputing the charge.',
})

const RUNS: Array<{
  name: string
  apiKey: string | undefined
  model: { provider: string; model: string }
  client: (apiKey: string) => Promise<DecisionClient>
}> = [
  {
    name: 'primary',
    apiKey: process.env.TYPESAFE_API_KEY,
    model: MAIL_CLASSIFICATION_MODEL,
    client: async (key) => new TypeSafeDecisionClient(key, undefined, { timeoutMs: 30_000 }),
  },
  {
    name: 'fallback',
    apiKey: process.env.OPENAI_API_KEY,
    model: MAIL_CLASSIFICATION_FALLBACK_MODEL,
    client: async (key) =>
      new LlmDecisionClient(
        await liveOrchestrator(MAIL_CLASSIFICATION_FALLBACK_MODEL.provider, key),
        {
          organizationId: 'org_live',
          userId: null,
          source: 'mail_classification',
        }
      ),
  },
]

for (const run of RUNS) {
  const label = `${run.name} ${run.model.provider}/${run.model.model}`

  describe.skipIf(!canRunLiveApi(run.apiKey))(`mail classification live — ${label}`, () => {
    async function classify(ctx: MailClassificationContext) {
      return (await run.client(run.apiKey!)).evaluate({
        ...run.model,
        state: buildClassificationState(ctx),
        questions: buildClassificationQuestions(ctx.labels),
      })
    }

    it('answers all five questions and maps the triage onto the column values', async () => {
      const result = await classify(REFUND)

      expect(Object.keys(result.answers).sort()).toEqual(
        ['category', 'needsReply', 'priority', 'sentiment', 'spam'].sort()
      )
      expect(result.answers.category).toMatchObject({ type: 'choice', choice: 'tag_billing' })

      const threshold = MAIL_CLASSIFY_CONFIDENCE_THRESHOLD[result.confidenceKind]
      const { priority, needsReply, sentiment, spam } = result.answers
      if (
        priority?.type !== 'score' ||
        sentiment?.type !== 'score' ||
        needsReply?.type !== 'noul' ||
        spam?.type !== 'noul'
      ) {
        throw new Error('triage answers have the wrong types')
      }
      const triage = toTriage(
        {
          priority: { level: priority.level, confidence: priority.confidence },
          needsReply: { probability: needsReply.probability },
          sentiment: { level: sentiment.level, confidence: sentiment.confidence },
          spam: { probability: spam.probability },
        },
        threshold
      )
      expect(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).toContain(triage.priority)
      expect(['NEGATIVE', 'NEUTRAL', 'POSITIVE']).toContain(triage.sentiment)
      expect(triage.spamScore).toBeLessThan(0.5)
      expect(triage.needsReply).toBe(true)
    }, 60_000)

    it('scores an unauthenticated phishing mail as likely spam', async () => {
      const result = await classify(PHISHING)
      expect(result.answers.spam).toMatchObject({ type: 'noul' })
      if (result.answers.spam?.type === 'noul') {
        expect(result.answers.spam.probability).toBeGreaterThan(0.5)
      }
    }, 60_000)

    it('reads an angry customer as angry or frustrated', async () => {
      const result = await classify(ANGRY)
      expect(result.answers.sentiment).toMatchObject({ type: 'score' })
      if (result.answers.sentiment?.type === 'score') {
        expect(result.answers.sentiment.level).toBeLessThanOrEqual(2)
      }
    }, 60_000)

    it('fits 100 tags with long descriptions in one request', async () => {
      const many = Array.from({ length: 100 }, (_, i) => ({
        tagId: `tag_${i}`,
        title: `Topic ${i}`,
        description: `Mail about topic ${i}. `.repeat(40),
      }))
      const result = await classify(context(REFUND.message, [...LABELS, ...many]))
      expect(result.answers.category?.type).toBe('choice')
    }, 90_000)
  })
}
