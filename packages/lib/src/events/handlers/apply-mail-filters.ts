// packages/lib/src/events/handlers/apply-mail-filters.ts
// The mail-filter GATE handler (plan §4.1).
//
// Runs INLINE inside `publishEventJob` — it is deliberately NOT registered in
// the worker's `eventHandlersJobMappings`, because a filter that marks a message
// spam has to settle before `triggerMessageWorkflows` is enqueued and
// `eventHandlersQueue` has no ordering.
//
// Two behaviours worth stating up front, because both look like bugs otherwise:
//
//  • **Filters fire per MESSAGE, not per thread.** A reply arriving on a thread
//    a filter already archived re-fires that filter and re-archives it — Gmail's
//    behaviour. The `(filterId, messageId, source)` run index is keyed per
//    message precisely so this reads as a fresh firing rather than a suppressed
//    duplicate.
//  • **Initial sync does not fire filters.** `message:received` is published
//    only when `messageData.isInbound && !ctx.isInitialSync`
//    (`ingest/store-message.ts`), so a freshly connected mailbox backfills
//    silently (D18). The retroactive apply covers the backlog on request.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { getEnabledMailFiltersForInbox, orgHasEnabledMailFilters } from '../../mail-filters/cache'
import { fireMailFilters } from '../../mail-filters/engine'
import { getProviderCapabilities } from '../../providers/provider-capabilities'
import type { AuxxEvent, GateResult } from '../types'
import { triggerMessageWorkflows } from './trigger-message-workflows'

const logger = createScopedLogger('apply-mail-filters')

/**
 * The `message:received` handlers a `suppress-automations` action switches off.
 *
 * Held as FUNCTION REFERENCES, never as string literals: the suppress list keys
 * on `Function.prototype.name`, which is the only coupling between
 * `EventHandlers` and the worker's `eventHandlersJobMappings`. Reading `.name`
 * off the same function object the `then` list holds means a rename can never
 * silently stop suppressing.
 *
 * Only the AUTOMATION door is suppressed. `createTimelineEvent`,
 * `deriveMessageReplySignal` and `ingestBounceMessage` are bookkeeping — a
 * filter must not be able to make mail disappear from the timeline or break
 * bounce handling.
 */
const SUPPRESSIBLE_AUTOMATION_HANDLERS = [triggerMessageWorkflows]

/**
 * Decide, per inbound message, which filters fire and what the fan-out should
 * skip.
 *
 * ⚠️ **The early-exit ordering below IS the performance design — do not
 * rearrange it.** Every payload-only and cache-only check runs BEFORE the one
 * thread load, so an org that has never written a filter pays ZERO queries for
 * the feature on every inbound message in the system.
 *
 * In particular the provider check is LAST, not third: the provider is only
 * knowable from the thread's `integrationId`, so checking it earlier would force
 * the thread load onto every inbound message in every org.
 *
 * Never throws in practice — `fireMailFilters` owns the never-throws contract —
 * and `publishEventJob`'s gate phase fails open regardless (invariant 3).
 */
export const applyMailFilters = async ({
  data: event,
}: {
  data: AuxxEvent
  // biome-ignore lint/suspicious/noConfusingVoidType: matches the GateHandler contract — `void` means nothing to suppress.
}): Promise<GateResult | void> => {
  // 1. Not our event.
  if (event.type !== 'message:received') return
  const { organizationId, messageId, threadId, machineMail } = event.data

  // 2. Hard-tier machine mail (bounces/NDRs) is loop-forming — bounces never
  //    trigger filters, mirroring `triggerMessageWorkflows`.
  if (machineMail?.tier === 'hard') return

  // 3. No thread, nothing to evaluate against.
  if (!threadId) return

  // 4. The org has no enabled filters. Pure org-cache read, and THE exit that
  //    fires for almost every org — it must stay ahead of anything that touches
  //    the DB.
  if (!(await orgHasEnabledMailFilters(organizationId))) return

  // 5. Load the thread. One query, and the only unconditional one.
  const [thread] = await database
    .select({
      inboxId: schema.Thread.inboxId,
      integrationId: schema.Thread.integrationId,
      status: schema.Thread.status,
      assigneeId: schema.Thread.assigneeId,
    })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .limit(1)
  if (!thread?.inboxId) return

  // 6. This inbox has no enabled filters (cache read against the per-inbox index).
  const filters = await getEnabledMailFiltersForInbox(organizationId, thread.inboxId)
  if (filters.length === 0) return

  // 7. The channel's provider is not filter-capable (D17 / invariant 17).
  //    `PROVIDER_CAPABILITIES`, never `PLATFORM_CAPABILITIES`: the first gates
  //    runtime behaviour, the second only describes a channel to the LLM.
  if (!thread.integrationId) return
  const channels = await getOrgCache().get(organizationId, 'channels')
  const channel = channels.find((c) => c.id === thread.integrationId)
  // Unknown channel → `getProviderCapabilities`' fully-false default would apply
  // anyway; bailing here keeps that explicit.
  if (!channel) return
  if (!getProviderCapabilities(channel.provider).supportsMailFilters) return

  // The thread's inbox, for the personal-inbox-only `set-read` branch and the
  // `move-inbox` destination check.
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const inboxRow = inboxes.find((inbox) => inbox.id === thread.inboxId)

  const result = await fireMailFilters({
    db: database,
    organizationId,
    threadId,
    messageId,
    thread: {
      inboxId: thread.inboxId,
      status: thread.status ?? null,
      assigneeId: thread.assigneeId ?? null,
    },
    inbox: inboxRow
      ? {
          id: inboxRow.id,
          // The DERIVED marker, not `entityDefinitionKey === 'personal_inbox'`:
          // the two disagree for the whole 059 → 060 migration window by design,
          // and a def-only read would treat an unmigrated personal mailbox as
          // shared (silently skipping `set-read` on exactly the inboxes it is
          // for).
          isPersonal: inboxRow.isPersonal,
          ownerUserId: inboxRow.ownerUserId,
        }
      : null,
    filters,
    source: 'live',
  })

  if (!result.suppressAutomations) return

  const suppress = SUPPRESSIBLE_AUTOMATION_HANDLERS.map((handler) => handler.name)
  logger.info('Mail filter suppressed automation handlers for message', {
    organizationId,
    messageId,
    threadId,
    filters: result.firedFilterIds,
    suppress,
  })
  return { suppress }
}
