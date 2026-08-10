// packages/lib/src/mail-classification/classify.ts
// The ONE model call (§3.2). Copied in shape from
// `field-values/ai-autofill/generation-service.ts:107-124`:
//   SystemModelService.getDefault(ModelType.LLM)
//     → new LLMOrchestrator(new UsageTrackingService(db), db).invoke({ … })
//
// That path already enforces quota, writes `AiUsage` and meters credits from
// real USD COGS (BYO = 0). None of it is rebuilt here.
//
// ⚠️ NEVER THROWS (invariant 6). Untagged is the safe state, so every failure
// mode — no default model, provider error, malformed output — logs and returns a
// null category.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { LLMOrchestrator } from '../ai/orchestrator/llm-orchestrator'
import { SystemModelService } from '../ai/providers/system-model-service'
import { ModelType } from '../ai/providers/types'
import { UsageTrackingService } from '../ai/usage/usage-tracking-service'
import {
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_CLASSIFY_CONFIDENCE_THRESHOLD,
  MAIL_CLASSIFY_NO_CATEGORY,
  type MailClassificationLabel,
} from './client'
import type { MailClassificationContext, MailClassificationResult } from './types'

const logger = createScopedLogger('mail-classification')

const SYSTEM_PROMPT = [
  'You categorise inbound customer email for a help desk.',
  'Choose exactly ONE category from the list, or the sentinel value when none of',
  'them fits. Each category is defined by its description — classify against the',
  'description, not against the label wording.',
  'Report your confidence as a number between 0 and 1. Be honest: a low',
  'confidence means the mail is not applied to any category at all, which is the',
  'correct outcome for ambiguous mail.',
].join(' ')

/**
 * The `response_format.json_schema` the model must answer in.
 *
 * ⚠️ Invariant 12, two halves:
 *  • the category is an ENUM OF TAG IDS, never free text, so the model cannot
 *    invent a label; and
 *  • the answer is an OBJECT with a `category` field, not a bare id, so a second
 *    output (priority, sentiment, language) later costs no extra call and does
 *    not change this shape.
 *
 * {@link MAIL_CLASSIFY_NO_CATEGORY} is a member of the same enum: under `strict`
 * a nullable enum is not portable across providers, so abstention has to be a
 * legal value rather than an absent one.
 */
export function buildClassificationSchema(labels: MailClassificationLabel[]) {
  return {
    name: 'mail_classification_result',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['category', 'confidence'],
      properties: {
        category: {
          type: 'string',
          enum: [...labels.map((label) => label.tagId), MAIL_CLASSIFY_NO_CATEGORY],
          description: `The id of the single best-fitting category, or "${MAIL_CLASSIFY_NO_CATEGORY}" when none fits.`,
        },
        confidence: {
          type: 'number',
          description: 'Confidence in the chosen category, from 0 to 1.',
        },
      },
    },
  }
}

/** The label list as the prompt sees it — `title` + `tag_description` (C3). */
export function renderLabels(labels: MailClassificationLabel[]): string {
  return labels
    .map((label) => {
      const definition = label.description?.trim()
      return definition
        ? `- id: ${label.tagId}\n  name: ${label.title}\n  definition: ${definition}`
        : `- id: ${label.tagId}\n  name: ${label.title}`
    })
    .join('\n')
}

/**
 * The user turn: subject + sender + a truncated body (§3.2). No quoted history —
 * the classifier does not need it, and truncation is most of the cost control.
 */
export function buildClassificationPrompt(context: MailClassificationContext): string {
  const { subject, from, textPlain } = context.message
  const body = (textPlain ?? '').slice(0, MAIL_CLASSIFY_BODY_CHARS)
  return [
    'Categories:',
    renderLabels(context.labels),
    '',
    `From: ${from ?? '(unknown)'}`,
    `Subject: ${subject ?? '(no subject)'}`,
    '',
    'Body:',
    body || '(empty)',
  ].join('\n')
}

/**
 * Classify one message against the org's eligible tags. One tag or none (Q1).
 *
 * Returns `tagId: null` for every "apply nothing" outcome, with `reason` set so
 * the caller's log line explains itself. Below
 * {@link MAIL_CLASSIFY_CONFIDENCE_THRESHOLD} the model's pick is discarded (C10)
 * — but its confidence is still reported and still logged, because those are the
 * rows the threshold is tuned against (Q4).
 */
export async function classifyMessage(
  db: Database,
  context: MailClassificationContext
): Promise<MailClassificationResult> {
  const { organizationId, messageId } = context

  const systemModels = new SystemModelService(db, organizationId)
  const def = await systemModels.getDefault(ModelType.LLM).catch((error) => {
    logger.warn('Mail classification could not resolve the org default LLM', {
      organizationId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  })
  if (!def) {
    logger.info('Mail classification skipped — no default LLM configured', {
      organizationId,
      messageId,
    })
    return { tagId: null, confidence: 0, reason: 'no-default-model' }
  }

  let structured: Record<string, unknown> | undefined
  try {
    const orchestrator = new LLMOrchestrator(new UsageTrackingService(db), db)
    const response = await orchestrator.invoke({
      model: def.model,
      provider: def.provider,
      organizationId,
      userId: '',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildClassificationPrompt(context) },
      ],
      structuredOutput: { enabled: true, schema: buildClassificationSchema(context.labels) },
      // A NEW `UsageSource` arm (`ai/orchestrator/types.ts`), so classification
      // spend is separable from `agent` / `autofill` / `workflow` in reporting.
      context: { source: 'mail_classification', messageId, threadId: context.threadId },
    })
    structured = response.structured_output
  } catch (error) {
    logger.warn('Mail classification model call failed — leaving the thread untagged', {
      organizationId,
      messageId,
      model: def.model,
      error: error instanceof Error ? error.message : String(error),
    })
    return { tagId: null, confidence: 0, reason: 'error', model: def.model }
  }

  const rawCategory = typeof structured?.category === 'string' ? structured.category : null
  const rawConfidence = typeof structured?.confidence === 'number' ? structured.confidence : 0
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0

  // Enum membership is re-checked HERE rather than trusted from the schema: a
  // provider that ignores `strict` (or a future one that does not support enums)
  // must not be able to make us write a tag the org never marked eligible.
  const eligible = new Set(context.labels.map((label) => label.tagId))
  const category = rawCategory && eligible.has(rawCategory) ? rawCategory : null

  const applied = category !== null && confidence >= MAIL_CLASSIFY_CONFIDENCE_THRESHOLD

  // ⚠️ Q4 — LOG ON EVERY CALL, including the below-threshold ones that apply
  // nothing. There is no column and no audit row: this line IS the tuning data.
  logger.info('Mail classification result', {
    organizationId,
    messageId,
    threadId: context.threadId,
    model: def.model,
    labelCount: context.labels.length,
    // What the model literally said, what survived the eligibility check, and
    // what was actually written — three different things when tuning.
    rawCategory,
    chosenTagId: category,
    tagId: applied ? category : null,
    confidence,
    threshold: MAIL_CLASSIFY_CONFIDENCE_THRESHOLD,
    applied,
  })

  if (applied) return { tagId: category, confidence, model: def.model }
  return {
    tagId: null,
    confidence,
    reason: category === null ? 'no-category' : 'below-threshold',
    model: def.model,
  }
}
