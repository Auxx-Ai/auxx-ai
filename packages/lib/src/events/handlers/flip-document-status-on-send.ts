// packages/lib/src/events/handlers/flip-document-status-on-send.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { resolveThreadLinkedEntityIds } from '../../entity-instances/activity'
import { BadRequestError } from '../../errors'
// Leaf import, not the `money` barrel: this module is registered in the worker's handler map
// and should not drag every money surface in behind it.
import {
  documentEmailProfile,
  documentTypeOf,
  recordDocumentSendSignal,
} from '../../money/send-email'
import type { AuxxEvent, MessageSentEvent } from '../types'

/**
 * §6.5 — the flip's failure surface moved from the request into a worker job, where nobody
 * is watching. Its own scope so "the status did not move" is greppable
 * (`scope='events:document-send-flip'`) and distinguishable from "the branch was never
 * reached", which is the bug this handler exists to retire.
 */
const logger = createScopedLogger('events:document-send-flip')

/**
 * Flip a sent document out of `draft` — the confirmed-send status write, for every send door.
 *
 * Registered on `message:sent`, which `MessageSenderService` publishes from the one point
 * every door passes through. Before this handler the flip lived as three hand-written
 * `if (linkedInstance.entityDefinitionId === <type>DefId)` blocks inside `thread.ts`'s
 * `sendMessage` procedure, so it ran on exactly one of the four doors: a quote scheduled to
 * go out tomorrow morning emailed the customer and stayed `draft` forever, and adding a
 * fourth document type meant remembering to edit an unrelated router in `apps/web`
 * (dispatch/money plan 22 §1.1/§1.2).
 *
 * What it does:
 * 1. Ignores every origin but `'compose'` (§6.1). A sequence step is marketing follow-up,
 *    not the act of issuing a document — a nurture mail on a thread that happens to carry a
 *    draft quote must not mark that quote sent. Same for receipts and agent sends. Absent
 *    origin reads as `'system'`, so the default is "do nothing".
 * 2. Resolves the thread's linked entities, and asks the document-type registry which of
 *    them (if any) is a document. A ticket, deal or lead simply is not one.
 * 3. Calls the registry row's `markSent`, treating `BadRequestError` as the idempotent no-op
 *    it is — a resend, or a document already marked sent by hand.
 * 4. Writes the Communications-view send signal, once per message.
 *
 * Never rethrows past a single document: one unregistered def or one already-sent quote must
 * not stop the others.
 */
export const flipDocumentStatusOnSend = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'message:sent') return
  const data = event.data as MessageSentEvent['data']

  // Fail-closed default: only a person hitting Send in the composer issues a document.
  if ((data.origin ?? 'system') !== 'compose') return

  const { organizationId, threadId, userId, messageId } = data
  if (!threadId || !userId) {
    logger.debug('message:sent carried no thread or actor — nothing to flip', {
      organizationId,
      messageId,
    })
    return
  }

  const linkedIds = await resolveThreadLinkedEntityIds(threadId, organizationId)
  if (linkedIds.length === 0) return

  const instances = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        inArray(schema.EntityInstance.id, linkedIds),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )

  for (const instance of instances) {
    // `documentTypeOf` THROWS on a def that is not a registered document type, which is the
    // common case here — most linked entities are tickets or deals. That throw is the "not a
    // document" answer, not a failure.
    let documentType: Awaited<ReturnType<typeof documentTypeOf>>
    try {
      documentType = await documentTypeOf(
        organizationId,
        toRecordId(instance.entityDefinitionId, instance.id)
      )
    } catch {
      continue
    }

    try {
      // The idempotency rule, owned in ONE place instead of copy-pasted per document type
      // and free to drift: `mark*Sent` asserts `status === 'draft'`, so a resend gets a
      // `BadRequestError` that means "already sent", not "failed".
      try {
        await documentEmailProfile(documentType).markSent({
          organizationId,
          userId,
          instanceId: instance.id,
        })
      } catch (flipError) {
        if (!(flipError instanceof BadRequestError)) throw flipError
      }

      // Communications-view signal — written for a CONFIRMED send including a resend,
      // regardless of whether the flip above was a no-op. Never throws.
      await recordDocumentSendSignal({
        organizationId,
        userId,
        documentType,
        documentInstanceId: instance.id,
        messageId,
        threadId,
        subject: data.subject ?? documentEmailProfile(documentType).sentSubjectFallback,
      })
    } catch (error) {
      logger.error('Failed to flip document status after send', {
        organizationId,
        messageId,
        threadId,
        documentType,
        documentInstanceId: instance.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
