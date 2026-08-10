// packages/lib/src/mail-classification/rerun-filters.ts
// §4.1 — THE SECOND PASS. Read this file before changing anything in it.
//
// ⚠️ APPLYING A TAG DOES NOT RE-RUN FILTERS. `applyMailFilters` is invoked from
// exactly ONE place — the `gate` on `message:received`
// (`events/handlers/publish-event-job.ts`) — and `'message:tag:added'` has an
// EMPTY handler array. Mail filters have one trigger by design (filters-plan
// D2). So without this explicit second invocation,
// `tag is Billing → assign to Finance` never fires for a classifier-applied tag:
// the engine already ran, before the tag existed. That is the whole feature,
// silently dead, with no error anywhere.
//
// ⚠️ THE RE-RUN REUSES `source: 'live'`. The run claim is unique on
// `(filterId, messageId, source)`, so adding a `'classification'` arm to that
// discriminator would give every already-fired filter a fresh key and re-fire
// the lot — `run-agent` included, which is precisely the double customer reply
// the claim exists to prevent (filters-plan invariant 4). A refactor that
// "tidies" this into its own source arm is a production incident.
//
//   | On pass 2                                | What happens                        |
//   | ---------------------------------------- | ----------------------------------- |
//   | filter fired on pass 1                   | matches again, hits its claim, bails |
//   |                                          | BEFORE acting                        |
//   | category filter that missed on pass 1    | no claim row, so it claims and fires |
//
// ⚠️ THE FULL FILTER SET, not a category-referencing subset. The claim is what
// makes a full pass both correct and simpler than trying to work out which
// filters mention the tag.
//
// `stopProcessing`: THE HALT IS HONORED (plan §4.1, recommendation). A matched
// filter with `stopProcessing` halts pass 2 exactly as it halted pass 1, even
// though it bails on its own claim — `fireMailFilters` already implements this,
// and nothing here overrides it. A user who wrote "stop processing" meant it,
// and the alternative would make filter order mean something different on the
// second pass than on the first. The cost is a category filter below a stopping
// filter never getting its chance; that is the same cost pass 1 already pays.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { getEnabledMailFiltersForInbox } from '../mail-filters/cache'
import { fireMailFilters } from '../mail-filters/engine'
import { getProviderCapabilities } from '../providers/provider-capabilities'

const logger = createScopedLogger('mail-classification')

/**
 * Re-invoke the mail-filter engine for one message after the classifier applied
 * a tag.
 *
 * Resolves the same inputs `applyMailFilters` resolves (thread, per-inbox filter
 * set, provider capability, inbox row) and fires the FULL set with
 * `source: 'live'`. Never throws — `fireMailFilters` owns the never-throws
 * contract and this wrapper adds its own belt.
 *
 * @returns the ids of the filters that actually executed on this pass.
 */
export async function rerunMailFiltersAfterClassification(params: {
  db: Database
  organizationId: string
  threadId: string
  messageId: string
}): Promise<string[]> {
  const { db, organizationId, threadId, messageId } = params

  try {
    const [thread] = await db
      .select({
        inboxId: schema.Thread.inboxId,
        integrationId: schema.Thread.integrationId,
        status: schema.Thread.status,
        assigneeId: schema.Thread.assigneeId,
      })
      .from(schema.Thread)
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1)
    if (!thread?.inboxId) return []

    const filters = await getEnabledMailFiltersForInbox(organizationId, thread.inboxId)
    if (filters.length === 0) return []

    // Provider capability, same check the gate makes (filters-plan D17 /
    // invariant 17): a channel whose provider cannot support filters must not
    // gain them via the classifier's back door.
    if (!thread.integrationId) return []
    const channels = await getOrgCache().get(organizationId, 'channels')
    const channel = channels.find((c) => c.id === thread.integrationId)
    if (!channel) return []
    if (!getProviderCapabilities(channel.provider).supportsMailFilters) return []

    const inboxes = await getOrgCache().get(organizationId, 'inboxes')
    const inboxRow = inboxes.find((inbox) => inbox.id === thread.inboxId)

    const result = await fireMailFilters({
      db,
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
            isPersonal: inboxRow.isPersonal,
            ownerUserId: inboxRow.ownerUserId,
          }
        : null,
      filters,
      // ⚠️ NOT a new source arm. See the file header.
      source: 'live',
    })

    if (result.firedFilterIds.length > 0) {
      logger.info('Mail filters fired on the post-classification pass', {
        organizationId,
        threadId,
        messageId,
        filters: result.firedFilterIds,
      })
    }
    // `suppressAutomations` is deliberately ignored: the `then` fan-out for this
    // message was decided and enqueued before the classifier ran, so there is
    // nothing left to suppress. Re-deciding it here would be a no-op at best.
    return result.firedFilterIds
  } catch (error) {
    logger.error('Post-classification filter re-run failed', {
      organizationId,
      threadId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
