// packages/lib/src/ai/decision/__tests__/llm-decision-integration.test.ts
//
// The LLM adapter against real structured-output providers. Opt-in: LIVE_API_TESTS=1 plus
// the provider's key. Catches a provider rejecting or mangling the decision schema, which
// the mocked suite cannot (Anthropic's forced-tool path especially).

import { describe, expect, it } from 'vitest'
import { canRunLiveApi } from '../../../test/live-api'
import { LIVE_DECISION_LLMS, liveOrchestrator } from '../../../test/live-llm-orchestrator'
import type { DecisionQuestion } from '../client'
import { LlmDecisionClient } from '../llm-decision-client'

const QUESTIONS: Record<string, DecisionQuestion> = {
  intent: {
    type: 'choice',
    instructions: 'What does the customer want?',
    options: { refund: 'Money back for an order', tracking: 'Where their parcel is', other: null },
  },
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

for (const llm of LIVE_DECISION_LLMS) {
  describe.skipIf(!canRunLiveApi(llm.apiKey))(`LLM decision adapter — ${llm.provider}`, () => {
    async function client() {
      return new LlmDecisionClient(await liveOrchestrator(llm.provider, llm.apiKey!), {
        organizationId: 'org_live',
        userId: null,
        source: 'mail_classification',
      })
    }

    it(`answers every question type through ${llm.model}'s strict schema`, async () => {
      const result = await (await client()).evaluate({
        provider: llm.provider,
        model: llm.model,
        state: STATE,
        questions: QUESTIONS,
      })

      expect(result.confidenceKind).toBe('self-reported')
      expect(result.answers.intent).toMatchObject({
        type: 'choice',
        choice: 'refund',
        probabilities: null,
      })
      const { frustration, urgent } = result.answers
      expect(frustration).toMatchObject({ type: 'score', expected: null, probabilities: null })
      if (frustration?.type === 'score') {
        expect(frustration.level).toBeGreaterThanOrEqual(1)
        expect(frustration.level).toBeLessThanOrEqual(3)
        expect(frustration.confidence).toBeGreaterThanOrEqual(0)
        expect(frustration.confidence).toBeLessThanOrEqual(1)
      }
      expect(urgent?.type).toBe('noul')
      if (urgent?.type === 'noul') {
        expect(urgent.probability).toBeGreaterThanOrEqual(0)
        expect(urgent.probability).toBeLessThanOrEqual(1)
      }
    }, 60_000)
  })
}
