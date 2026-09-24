// packages/lib/src/mail-classification/classify.ts
// The ONE model call (§3.2), on the decision runner: the category plus four triage
// questions in one `evaluate()` (plans/ai/decision/03-mail-classification.md).
//
// ⚠️ NEVER THROWS (invariant 6). Untagged is the safe state, so every failure
// mode logs and returns a null category.

import type { Database } from '@auxx/database'
import type { ThreadSentiment, TicketPriority } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { DecisionAnswer, DecisionQuestion, DecisionState } from '../ai/decision/client'
import { evaluate } from '../ai/decision/evaluate'
import { QuotaExceededError } from '../ai/errors/quota-errors'
import { ModelType } from '../ai/providers/types'
import { getCachedDefaultModel } from '../cache'
import { UnprocessableEntityError, UsageLimitError } from '../errors'
import {
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_CLASSIFY_CONFIDENCE_THRESHOLD,
  MAIL_CLASSIFY_DESCRIPTION_CHARS,
  MAIL_CLASSIFY_NEEDS_REPLY_THRESHOLD,
  MAIL_CLASSIFY_NO_CATEGORY,
  type MailClassificationLabel,
  type MailClassificationTriageAnswers,
} from './client'
import type {
  MailClassificationContext,
  MailClassificationResult,
  MailClassificationTriage,
} from './types'

const logger = createScopedLogger('mail-classification')

const CATEGORY_INSTRUCTIONS = [
  'Categorise this inbound customer email for a help desk.',
  'Choose exactly ONE category, or the sentinel option when none of them fits.',
  'Each category is defined by its description, so classify against the',
  'description, not against the label wording.',
  'Low confidence means the mail is not applied to any category at all, which is',
  'the correct outcome for ambiguous mail.',
].join(' ')

const PRIORITY_LEVELS: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const SENTIMENT_LEVELS: ThreadSentiment[] = ['NEGATIVE', 'NEGATIVE', 'NEUTRAL', 'POSITIVE']

function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

/** One option per eligible tag, keyed by tag id so the model cannot invent a label (invariant 12). */
function categoryOptions(labels: MailClassificationLabel[]): Record<string, string> {
  const options: Record<string, string> = {}
  for (const label of labels) {
    const definition = label.description?.trim()
    options[label.tagId] = definition
      ? `${label.title}: ${clampText(definition, MAIL_CLASSIFY_DESCRIPTION_CHARS)}`
      : label.title
  }
  options[MAIL_CLASSIFY_NO_CATEGORY] = 'None of the listed categories fits this mail.'
  return options
}

/** The category and the four triage questions (03 §1, §5). */
export function buildClassificationQuestions(
  labels: MailClassificationLabel[]
): Record<string, DecisionQuestion> {
  return {
    category: {
      type: 'choice',
      instructions: CATEGORY_INSTRUCTIONS,
      options: categoryOptions(labels),
    },
    priority: {
      type: 'score',
      instructions: 'How urgent is this mail for the business?',
      levels: ['Informational', 'Normal', 'Needs a reply today', 'Blocking the customer'],
    },
    needsReply: {
      type: 'noul',
      instructions: 'Does the sender expect an answer from us, rather than sending an FYI?',
    },
    sentiment: {
      type: 'score',
      instructions: "The sender's emotional state.",
      levels: ['Angry or threatening', 'Frustrated', 'Neutral', 'Positive'],
    },
    spam: {
      type: 'noul',
      instructions:
        'Is this unsolicited bulk, a scam or phishing rather than a genuine message to this business?',
      criteria: {
        true: 'Unsolicited, deceptive, or not addressed to this business.',
        false: 'A genuine customer, partner or vendor message.',
      },
    },
  }
}

/** The mail as the model sees it: sender, subject, a truncated body, no quoted history (§3.2). */
export function buildClassificationState(context: MailClassificationContext): DecisionState {
  const { subject, from, textPlain, senderAuthenticated } = context.message
  return {
    from: from ?? '(unknown)',
    subject: subject ?? '(no subject)',
    body: (textPlain ?? '').slice(0, MAIL_CLASSIFY_BODY_CHARS) || '(empty)',
    senderAuthenticated,
  }
}

/**
 * Every `Error` in a wrapping chain, outermost first. The orchestrator and the
 * clients re-wrap causes, so the reason is never the outermost error.
 */
function errorChain(error: unknown): Error[] {
  const chain: Error[] = []
  let current: unknown = error
  while (current instanceof Error && chain.length < 8 && !chain.includes(current)) {
    chain.push(current)
    const next = (current as { originalError?: unknown }).originalError
    current = next instanceof Error ? next : current.cause
  }
  return chain
}

/** Transient-failure signatures, checked against every link of the chain. */
const TRANSIENT_PATTERNS =
  /\b429\b|rate.?limit|too many requests|overloaded|timed? ?out|timeout|socket hang up|fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|502|503|504|bad gateway|service unavailable/i

/**
 * Why the call failed. All three leave the message classifiable; `'quota-exceeded'`
 * is surfaced rather than retried, `'unavailable'` is time-resolved, `'error'` is a bug.
 */
function classifyFailure(error: unknown): 'quota-exceeded' | 'unavailable' | 'error' {
  const chain = errorChain(error)

  if (chain.some((e) => e instanceof QuotaExceededError || e instanceof UsageLimitError)) {
    return 'quota-exceeded'
  }

  for (const link of chain) {
    const status = (link as { status?: unknown }).status
    if (typeof status === 'number' && (status === 429 || status >= 500)) return 'unavailable'
    // The Anthropic client throws a bare Error for a 429, so the message is the only evidence.
    const code = (link as { code?: unknown }).code
    if (typeof code === 'string' && TRANSIENT_PATTERNS.test(code)) return 'unavailable'
    if (TRANSIENT_PATTERNS.test(link.message)) return 'unavailable'
  }

  return 'error'
}

function answerOf<T extends DecisionAnswer['type']>(
  answers: Record<string, DecisionAnswer>,
  id: string,
  type: T
): Extract<DecisionAnswer, { type: T }> {
  const answer = answers[id]
  if (answer?.type !== type) {
    throw new UnprocessableEntityError(`Decision answer "${id}" is missing or not a ${type}`)
  }
  return answer as Extract<DecisionAnswer, { type: T }>
}

/** Column values from the raw triage answers; an unsure score falls back to the middle (03 §5.2). */
export function toTriage(
  answers: MailClassificationTriageAnswers,
  threshold: number
): MailClassificationTriage {
  const { priority, needsReply, sentiment, spam } = answers
  return {
    priority:
      priority.confidence >= threshold
        ? (PRIORITY_LEVELS[priority.level - 1] ?? 'MEDIUM')
        : 'MEDIUM',
    needsReply: needsReply.probability >= MAIL_CLASSIFY_NEEDS_REPLY_THRESHOLD,
    sentiment:
      sentiment.confidence >= threshold
        ? (SENTIMENT_LEVELS[sentiment.level - 1] ?? 'NEUTRAL')
        : 'NEUTRAL',
    spamScore: spam.probability,
    answers,
  }
}

/**
 * Classify one message against the org's eligible tags, and triage it. One tag or none (Q1).
 *
 * Returns `tagId: null` for every "apply nothing" outcome, with `reason` set. Below
 * the threshold for the result's `confidenceKind` the pick is discarded (C10), but
 * its confidence and the triage are still returned: the call completed.
 */
export async function classifyMessage(
  db: Database,
  context: MailClassificationContext
): Promise<MailClassificationResult> {
  const { organizationId, messageId, threadId } = context

  // `evaluate` falls back from the decision default to the LLM default; only neither is a skip.
  const configured = await Promise.all([
    getCachedDefaultModel(organizationId, ModelType.DECISION),
    getCachedDefaultModel(organizationId, ModelType.LLM),
  ])
    .then(([decision, llm]) => decision ?? llm)
    .catch((error) => {
      logger.warn('Mail classification could not resolve the org default models', {
        organizationId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })
  if (!configured) {
    logger.info('Mail classification skipped — no decision or language model configured', {
      organizationId,
      messageId,
    })
    return { tagId: null, confidence: 0, reason: 'no-default-model', inferred: false }
  }

  const outcome = await evaluate(db, {
    organizationId,
    // NULL, never `''`: `AiUsage.userId` is a FK and nobody asked for this call.
    userId: null,
    source: 'mail_classification',
    sourceId: messageId,
    state: buildClassificationState(context),
    questions: buildClassificationQuestions(context.labels),
  })

  let parsed:
    | {
        category: Extract<DecisionAnswer, { type: 'choice' }>
        triageAnswers: MailClassificationTriageAnswers
      }
    | undefined
  let failure: unknown = outcome.isErr() ? outcome.error : undefined
  if (outcome.isOk()) {
    try {
      const { answers } = outcome.value
      const priority = answerOf(answers, 'priority', 'score')
      const sentiment = answerOf(answers, 'sentiment', 'score')
      parsed = {
        category: answerOf(answers, 'category', 'choice'),
        triageAnswers: {
          priority: { level: priority.level, confidence: priority.confidence },
          needsReply: { probability: answerOf(answers, 'needsReply', 'noul').probability },
          sentiment: { level: sentiment.level, confidence: sentiment.confidence },
          spam: { probability: answerOf(answers, 'spam', 'noul').probability },
        },
      }
    } catch (error) {
      failure = error
    }
  }

  // ⚠️ `inferred: false` on every failure: nothing was decided, so the marker must
  // not go down or one 429 disqualifies the message forever.
  if (!parsed || outcome.isErr()) {
    const reason = classifyFailure(failure)
    const fields = {
      organizationId,
      messageId,
      threadId,
      model: configured.model,
      reason,
      error: failure instanceof Error ? failure.message : String(failure),
    }
    const message = 'Mail classification call failed, leaving the thread untagged and classifiable'
    if (reason === 'error') logger.error(message, fields)
    else logger.warn(message, fields)

    return { tagId: null, confidence: 0, reason, model: configured.model, inferred: false }
  }

  const { model, confidenceKind } = outcome.value
  const threshold = MAIL_CLASSIFY_CONFIDENCE_THRESHOLD[confidenceKind]
  const rawCategory = parsed.category.choice
  const confidence = parsed.category.confidence

  // Re-verified here: a native provider is not bound by the adapter's enum check.
  const eligible = new Set(context.labels.map((label) => label.tagId))
  const category = eligible.has(rawCategory) ? rawCategory : null
  const applied = category !== null && confidence >= threshold
  const triage = toTriage(parsed.triageAnswers, threshold)

  // Q4 — logged on every call, including the ones that apply nothing: this is the tuning data.
  logger.info('Mail classification result', {
    organizationId,
    messageId,
    threadId,
    model,
    confidenceKind,
    labelCount: context.labels.length,
    rawCategory,
    chosenTagId: category,
    tagId: applied ? category : null,
    confidence,
    threshold,
    applied,
    priority: triage.priority,
    needsReply: triage.needsReply,
    sentiment: triage.sentiment,
    spamScore: triage.spamScore,
  })

  // A completed call is `inferred` even when nothing is applied: re-asking would pay twice (C9).
  const inferred = { confidence, model, confidenceKind, triage, inferred: true } as const
  if (applied) return { tagId: category, ...inferred }
  return {
    tagId: null,
    reason: category === null ? 'no-category' : 'below-threshold',
    ...inferred,
  }
}
