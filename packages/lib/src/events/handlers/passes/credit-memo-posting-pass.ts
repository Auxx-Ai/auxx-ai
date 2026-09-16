// packages/lib/src/events/handlers/passes/credit-memo-posting-pass.ts
//
// Pass 7 of `events/handlers/finalize-integrity-passes.ts`: decide whether a
// connector sync brought in credit memo records, and if so hand off to the
// automatic posting run.
//
// `plans/accounting/tasks/done/28-how-your-books-post.md` §3.1.
//
// This is `fulfillment-log-pass.ts`'s posting trigger for the other bulk
// source. Channel credit memos are not created by anything in this repo: the
// connector writes them as `credit_memo` records with `credit_memo_source:
// channel`, and they arrive here the way a `fulfillment` does - as membership
// in the sync manifest. So the question is the same one, "did a credit memo
// arrive in this sync", answered with ZERO database reads from manifest
// membership plus the cached def resolver the caller already built. The pass
// does not look at the memo's `source`: a memo a sync wrote IS a channel memo,
// and a native memo posts on issue through `money/credit-memos/writes.ts`
// without ever passing through a sync.
//
// BOTH manifest tiers are scanned, and `createdRecordIds` is the load-bearing
// one, for the reason `fulfillment-log-pass.ts`'s header gives in full: a
// connector-written record is a CREATE, and `createdRecordIds` is the tier
// documented as unconditional for every created record, where `touched` is
// only what a create NORMALLY also lands in. A trigger that missed would be
// silent - no enqueue, no error, nothing on any screen.
//
// Its own module rather than a branch in `fulfillment-log-pass.ts`, because
// that file's membership contract is pinned by its tests and its own §2.6 rule
// says a refactor that needs a test edited is wrong. A few duplicated lines
// cost less than putting that pin at risk.
//
// Keep top-level imports to types and the logger, and lazy-import the queue
// module - the same rule `finalize-integrity-passes.ts` states in its own
// header, for the same reason (the events to money/cache boundaries break
// `vi.mock` otherwise).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'
import type { DefEntityTypeResolver } from './fulfillment-log-pass'

const logger = createScopedLogger('finalize-integrity')

/**
 * Whether this sync's manifest shows at least one `credit_memo` record created
 * or touched.
 *
 * Membership only - no field values are read. WHICH keys changed does not
 * matter, because the question is only "did the connector write a credit memo
 * this run", never "did a specific attribute of it change".
 */
export async function creditMemosArrivedThisSync(
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<boolean> {
  const seenDefs = new Map<string, boolean>()
  const isCreditMemo = async (rid: RecordId): Promise<boolean> => {
    const { entityDefinitionId: rawDefId } = parseRecordId(rid)
    const cached = seenDefs.get(rawDefId)
    if (cached !== undefined) return cached
    const def = await resolveDef(rawDefId)
    const answer = def?.entityType === 'credit_memo'
    seenDefs.set(rawDefId, answer)
    return answer
  }

  for (const rid of manifest.createdRecordIds ?? []) {
    if (await isCreditMemo(rid)) return true
  }
  for (const rid of Object.keys(manifest.touched)) {
    if (await isCreditMemo(rid as RecordId)) return true
  }
  return false
}

/**
 * Pass 7: enqueue the automatic credit memo posting run when - and only when -
 * this sync's manifest shows a credit memo record arriving.
 *
 * Gated on arrival so an idle re-sync enqueues nothing; gated on the org's
 * `accounting.creditMemoPosting` inside `autoPostCreditMemosAfterSync`, which
 * is where `manual` (the default) turns this into a no-op.
 *
 * **Never throws**, matching every other pass in this module.
 */
export async function creditMemoPostingTriggerPass(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<void> {
  try {
    const arrived = await creditMemosArrivedThisSync(manifest, resolveDef)
    if (!arrived) return

    const { autoPostCreditMemosAfterSync } = await import('../../../money/credit-memo-posting/auto')
    await autoPostCreditMemosAfterSync(db, organizationId)

    logger.info('integrity credit memo posting trigger pass: credit memos arrived, enqueued', {
      organizationId,
    })
  } catch (error) {
    logger.error('integrity credit memo posting trigger pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
