// packages/lib/src/postings/export-gate/release.ts
//
// The gate, in front of the door.
//
// `releaseExportsForSync` is the sync queue's bulk action and it is complete as
// it stands - it de-dupes, it never throws, and it reports one outcome per
// posting. What it does not do is ASK whether the books are ready, because
// nothing could ask until this module existed. This file is the composition:
// evaluate, refuse the blocked ones with the reason on the row, hand the rest
// through unchanged.
//
// 🔑 Composed HERE rather than inside `releaseExportsForSync` or in the router.
// Inside the release it would make the one function that must never throw
// depend on three subledgers; in the router it would put a business rule in the
// layer whose job is to assert a permission and call lib, where a second caller
// - a worker, a scheduled sweep - would not inherit it.
//
// No permission checks. The router asserts `ledgerPost`
// (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ok, type Result } from 'neverthrow'
import {
  releaseExportsForSync,
  type SyncReleaseOutcome,
  type SyncReleaseResult,
} from '../retry-export'
import { evaluateExportGate } from './reads'

const logger = createScopedLogger('postings:export-gate')

/**
 * Release held journals to the delivery worker, but only the ones the books are
 * ready to stand behind (53 D12).
 *
 * A blocked posting comes back as `status: 'skipped'` carrying the gate's
 * sentence, which is the shape the sync queue already renders: the panel keys
 * its `refusals` map by `glPostingId` and prints `message` as the amber line
 * under the row. So a refusal here reads exactly like a refusal from the release
 * itself, and - deliberately - does NOT stamp `exportStatus: 'failed'`. Nothing
 * was attempted, nothing failed, and the row keeps its "Ready to sync" badge so
 * that clearing the cause and pressing Sync again is the whole remedy.
 *
 * 🛑 **Fails OPEN.** If the gate itself cannot be evaluated, every posting is
 * released. A gate that grounded the entire queue because one subledger read
 * threw would be a worse outage than the divergence it prevents, and the
 * unevaluated case is logged rather than hidden.
 *
 * ⚠️ There is no override flag, on purpose. Every blocking finding is
 * self-clearing - post the missing shipments, issue or void the draft memos,
 * reverse the entry that does not tie - so an escape hatch would only ever be
 * used to send something we already know is wrong. The warnings, which are the
 * findings a person might legitimately want to ignore, never block in the first
 * place.
 *
 * **Never throws.** Same contract as the function it wraps.
 */
export async function releaseExportsThroughGate(
  db: Database,
  input: { organizationId: string; glPostingIds: string[] }
): Promise<Result<SyncReleaseResult, Error>> {
  const { organizationId } = input
  const glPostingIds = [...new Set(input.glPostingIds)]

  const gate = await evaluateExportGate(db, organizationId, { glPostingIds })

  const refusals = new Map<string, SyncReleaseOutcome>()
  if (gate.isErr()) {
    logger.warn('The pre-export gate could not be evaluated. Releasing without it', {
      organizationId,
      count: glPostingIds.length,
      error: gate.error.message,
    })
  } else {
    for (const verdict of gate.value.verdicts) {
      if (verdict.status !== 'block') continue
      refusals.set(verdict.glPostingId, {
        glPostingId: verdict.glPostingId,
        docNumber: verdict.docNumber,
        status: 'skipped',
        // Never undefined on a block - `exportGateMessage` returns a sentence
        // whenever there is a finding, and a block IS a finding. The fallback is
        // here so a future finding that forgot its prose degrades to something
        // an operator can still act on rather than to the panel's generic
        // "It was not released."
        message: verdict.message ?? 'The books are not ready to send this entry.',
      })
    }
    if (gate.value.unavailable.length > 0) {
      // Not an error, and not silent. A partial gate that released everything it
      // could not check is exactly the thing somebody will need to see in the
      // logs the day a figure lands wrong.
      logger.info('The pre-export gate ran partially', {
        organizationId,
        unavailable: gate.value.unavailable.join(','),
        blocked: refusals.size,
      })
    }
  }

  const passed = glPostingIds.filter((id) => !refusals.has(id))
  const byId = new Map<string, SyncReleaseOutcome>()
  if (passed.length > 0) {
    // 🛑 Not called at all when everything was blocked. `releaseExportsForSync`
    // logs a tally per invocation, and an empty one would put "released 0" in
    // the stream for a call that never touched a posting.
    const released = await releaseExportsForSync(db, { organizationId, glPostingIds: passed })
    if (released.isErr()) return released
    for (const outcome of released.value.outcomes) byId.set(outcome.glPostingId, outcome)
  }

  const outcomes: SyncReleaseOutcome[] = []
  for (const id of glPostingIds) {
    const outcome = refusals.get(id) ?? byId.get(id)
    if (outcome) outcomes.push(outcome)
  }

  // Re-tallied from the merged list rather than added to the release's own
  // counts, so the three numbers always describe the array beside them.
  return ok({
    released: outcomes.filter((outcome) => outcome.status === 'released').length,
    skipped: outcomes.filter(
      (outcome) => outcome.status === 'skipped' || outcome.status === 'exported'
    ).length,
    failed: outcomes.filter((outcome) => outcome.status === 'error').length,
    outcomes,
  })
}
