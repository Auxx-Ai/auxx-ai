// packages/lib/src/mail-classification/guard.ts
// READ: the §3.1 exit ladder. Six exits, cheapest first.
//
// ⚠️ THE ORDERING IS THE DESIGN — do not rearrange it. Every payload-only and
// cache-only check runs before anything that touches the DB, so an org that has
// never opted an inbox in pays ZERO queries for this feature on every inbound
// message in the system (C8). Mirrors `applyMailFilters`' own exit ordering for
// the same reason.

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { getThreadTagIds } from '../field-values/relationship-queries'
import {
  MAIL_CLASSIFICATION_INBOX_IDS_SETTING,
  MAIL_CLASSIFICATION_METADATA_KEY,
  type MailClassificationSkipReason,
} from './client'
import { getEligibleClassificationTags } from './labels'
import type { MailClassificationGate } from './types'

/** What the guard needs, all of it already in hand at the call site. */
export interface MailClassificationGateInput {
  db: Database
  organizationId: string
  messageId: string
  /** From the `message:received` payload — absent means nothing to tag. */
  threadId?: string
  /** From the `message:received` payload (`machineMail.tier`). */
  machineMailTier?: 'hard' | 'soft'
  /** From the `message:received` payload — the prompt's sender line. */
  from?: string
}

const skip = (reason: MailClassificationSkipReason): MailClassificationGate => ({
  proceed: false,
  reason,
})

/**
 * The opted-in inbox ids for this org (plan §5), read from the `orgSettings`
 * cache. Never a DB query — this is THE exit that fires for almost every org and
 * it must stay ahead of anything that touches the database.
 */
async function getOptedInInboxIds(organizationId: string): Promise<string[]> {
  const settings = await getOrgCache().get(organizationId, 'orgSettings')
  const raw = settings?.[MAIL_CLASSIFICATION_INBOX_IDS_SETTING]
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * Decide whether one inbound message should be classified, and resolve
 * everything the model call needs if so.
 *
 * Never throws — a guard failure must leave the thread untagged, not fail a job.
 */
export async function guardClassification(
  input: MailClassificationGateInput
): Promise<MailClassificationGate> {
  const { db, organizationId, messageId, threadId, machineMailTier } = input

  // 1. Hard-tier machine mail (bounces/NDRs) is loop-forming and never worth an
  //    inference. Payload field — no I/O.
  if (machineMailTier === 'hard') return skip('machine-mail')

  // 2. No thread, nothing to tag. Payload field — no I/O.
  if (!threadId) return skip('no-thread')

  // 3a. The org has not opted ANY inbox in. Pure org-cache read, and the exit
  //     that makes C8 true: no opt-in, no queries, no inference, ever.
  const optedInInboxIds = await getOptedInInboxIds(organizationId)
  if (optedInInboxIds.length === 0) return skip('inbox-not-opted-in')

  // 3b. Which inbox is this thread in? The payload does not carry it, so this is
  //     the first (and cheapest possible) query, and only opted-in orgs pay it.
  const [thread] = await db
    .select({ inboxId: schema.Thread.inboxId })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .limit(1)
  const inboxId = thread?.inboxId ?? null
  if (!inboxId || !optedInInboxIds.includes(inboxId)) return skip('inbox-not-opted-in')

  // 4. The org has no eligible tags. The second half of the double guard (C8) —
  //    an opted-in inbox with an empty label set must not reach a model call,
  //    because there is nothing the model could legally answer.
  const labels = await getEligibleClassificationTags(db, organizationId)
  if (labels.length === 0) return skip('no-eligible-tags')

  // 5. Already classified (C9). Classify once per message, EVER — a retry that
  //    re-infers is a bug the customer sees on an invoice. The marker lives in
  //    `Message.metadata`, written by `apply.ts` right after the call returns.
  const [message] = await db
    .select({
      subject: schema.Message.subject,
      textPlain: schema.Message.textPlain,
      metadata: schema.Message.metadata,
    })
    .from(schema.Message)
    .where(and(eq(schema.Message.id, messageId), eq(schema.Message.organizationId, organizationId)))
    .limit(1)
  if (!message) return skip('no-thread')
  const metadata = (message.metadata ?? {}) as Record<string, unknown>
  if (metadata[MAIL_CLASSIFICATION_METADATA_KEY]) return skip('already-classified')

  // 6. §3.1.1 — a RULE ALREADY ANSWERED, so the model is not asked.
  //
  //    This is the exit a reader will not predict and it encodes the feature's
  //    whole justification. Manual tagging, the deterministic `add-tag` filter
  //    action and the mined `auto-tag` suggestion are all free, exact and
  //    instant; the classifier exists only for what a condition cannot reach
  //    ("tag it Billing when it is *about* billing"). `applyMailFilters` runs in
  //    the gate and this job is enqueued from `then`, so every deterministic tag
  //    is already on the thread by the time we get here.
  //
  //    ⚠️ Scoped to ELIGIBLE tags only. A thread carrying `VIP` or `P1` has not
  //    been categorised and must still be classified.
  const eligibleIds = new Set(labels.map((label) => label.tagId))
  const threadTagIds = await getThreadTagIds(db, threadId, organizationId)
  if (threadTagIds.some((tagId) => eligibleIds.has(tagId))) {
    return skip('thread-already-categorised')
  }

  return {
    proceed: true,
    context: {
      organizationId,
      messageId,
      threadId,
      inboxId,
      labels,
      message: {
        subject: message.subject ?? null,
        from: input.from ?? null,
        textPlain: message.textPlain ?? null,
      },
    },
  }
}
