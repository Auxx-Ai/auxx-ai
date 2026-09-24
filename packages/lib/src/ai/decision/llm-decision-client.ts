// packages/lib/src/ai/decision/llm-decision-client.ts

import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { DecisionClient, type DecisionEvaluateParams } from '../clients/base/decision-client'
import { DEFAULT_CLIENT_CONFIG } from '../clients/base/types'
import type { LLMOrchestrator } from '../orchestrator/llm-orchestrator'
import type { UsageSource } from '../orchestrator/types'
import type { DecisionAnswer, DecisionQuestion, DecisionResult, DecisionState } from './client'

/** Call context the adapter forwards to the orchestrator; `userId` is null for background work. */
export interface LlmDecisionContext {
  organizationId: string
  userId: string | null
  source: UsageSource
  sourceId?: string
}

const PREAMBLE = [
  'You answer fixed questions about the material below.',
  'Answer every question.',
  'Report confidence honestly; low confidence is a correct answer for ambiguous material.',
].join(' ')

const confidenceKey = (id: string) => `${id}_confidence`

/** One strict schema answering every question; see plans/ai/decision/01-llm-adapter.md §2. */
export function buildDecisionSchema(questions: Record<string, DecisionQuestion>) {
  const properties: Record<string, Record<string, unknown>> = {}
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'noul') {
      properties[id] = { type: 'number', description: 'Probability the answer is true, 0 to 1.' }
      continue
    }
    const values =
      question.type === 'choice'
        ? Object.keys(question.options)
        : question.levels.map((_, i) => String(i + 1))
    // Answer before confidence: property order is generation order under strict outputs.
    properties[id] = { type: 'string', enum: values }
    properties[confidenceKey(id)] = {
      type: 'number',
      description: `Confidence in the answer to "${id}", from 0 to 1.`,
    }
  }
  return {
    name: 'decision_result',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
  }
}

/** The system turn: the preamble, then each question with its options, levels or criteria. */
export function buildDecisionPrompt(questions: Record<string, DecisionQuestion>): string {
  const sections = Object.entries(questions).map(([id, question]) => {
    const lines = [`Question "${id}" (${question.type}): ${question.instructions}`]
    if (question.type === 'choice') {
      lines.push('Options:')
      for (const [key, description] of Object.entries(question.options)) {
        lines.push(description ? `- ${key}: ${description}` : `- ${key}`)
      }
    } else if (question.type === 'score') {
      lines.push('Levels, lowest first (answer with the number):')
      question.levels.forEach((level, i) => lines.push(`${i + 1}. ${level}`))
    } else {
      lines.push('Answer with the probability, from 0 to 1, that this is true.')
      if (question.criteria?.true) lines.push(`True when: ${question.criteria.true}`)
      if (question.criteria?.false) lines.push(`False when: ${question.criteria.false}`)
    }
    return lines.join('\n')
  })
  return [PREAMBLE, ...sections].join('\n\n')
}

function renderState(state: DecisionState): string {
  return typeof state === 'string' ? state : JSON.stringify(state, null, 2)
}

function clamp01(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
}

function mapAnswer(
  id: string,
  question: DecisionQuestion,
  output: Record<string, unknown>
): DecisionAnswer {
  const raw = output[id]
  if (question.type === 'noul') return { type: 'noul', probability: clamp01(raw) }

  const confidence = clamp01(output[confidenceKey(id)])
  // Enum membership is re-verified: a provider that ignores `strict` must not smuggle in a value.
  if (question.type === 'choice') {
    if (typeof raw !== 'string' || !Object.hasOwn(question.options, raw)) {
      throw new UnprocessableEntityError(`Decision "${id}" returned an option outside the enum`)
    }
    return { type: 'choice', choice: raw, probabilities: null, confidence }
  }

  const level = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!(level >= 1 && level <= question.levels.length)) {
    throw new UnprocessableEntityError(`Decision "${id}" returned a level outside the scale`)
  }
  return { type: 'score', level, expected: null, probabilities: null, confidence }
}

/** Answers decision questions through any structured-output chat model; confidence is self-reported. */
export class LlmDecisionClient extends DecisionClient {
  constructor(
    private readonly orchestrator: LLMOrchestrator,
    private readonly ctx: LlmDecisionContext
  ) {
    super(DEFAULT_CLIENT_CONFIG, 'LLM-Decision')
  }

  async evaluate({
    provider,
    model,
    state,
    questions,
  }: DecisionEvaluateParams): Promise<DecisionResult> {
    const ids = Object.keys(questions)
    if (ids.length === 0) throw new BadRequestError('A decision needs at least one question')
    const collision = ids.find((id) => ids.includes(confidenceKey(id)))
    if (collision) {
      throw new BadRequestError(
        `Question id "${confidenceKey(collision)}" collides with "${collision}"`
      )
    }

    const response = await this.orchestrator.invoke({
      provider,
      model,
      organizationId: this.ctx.organizationId,
      userId: this.ctx.userId,
      messages: [
        { role: 'system', content: buildDecisionPrompt(questions) },
        { role: 'user', content: renderState(state) },
      ],
      // Generous base because reasoning models count their thinking against this cap.
      parameters: { temperature: 0, max_tokens: 2048 + 64 * ids.length },
      structuredOutput: { enabled: true, schema: buildDecisionSchema(questions) },
      context: {
        source: this.ctx.source,
        ...(this.ctx.sourceId ? { sourceId: this.ctx.sourceId } : {}),
      },
    })

    const output = response.structured_output
    if (!output) throw new UnprocessableEntityError('Decision model returned no structured output')

    const answers: Record<string, DecisionAnswer> = {}
    for (const [id, question] of Object.entries(questions)) {
      answers[id] = mapAnswer(id, question, output)
    }

    return {
      answers,
      confidenceKind: 'self-reported',
      provider,
      model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    }
  }
}
