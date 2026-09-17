// packages/lib/src/postings/unsync/index.ts
//
// Un-sync: remove the provider's copy of an entry we already delivered and put
// the row back to *Ready to sync*, so a corrected mapping can send it again.
// plans/accounting/tasks/60-un-syncing-from-the-provider.md.
//
// 🔑 An EXPORT operation, not a ledger operation. `GlPosting.status` stays
// `posted`, its lines stay frozen, its effects stay claimed, no period reopens
// and no reversal is written (E1, E3). Backing an entry out of OUR books remains
// `reverseEntry` and is a different button with a different meaning.
//
// No permission checks. The router asserts `ledgerControl` (E5).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { resolveAccountingProvider } from '../provider'
import { providerDisplayName } from '../provider-sync/client'
import type { UnsyncOutcome, UnsyncResult } from '../types'
import { readRemoteJournal, readUnsyncTarget } from './reads'
import {
  claimUnsyncOperation,
  markUnsyncFailed,
  markUnsyncSending,
  saveWithdrawal,
  unsyncOperationKey,
} from './writes'

const logger = createScopedLogger('postings-unsync')

/** The same lease window the delivery path uses; a withdrawal is one round trip shorter. */
const LEASE_MS = 5 * 60_000

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Whether a refusal can only ever produce the same answer again.
 *
 * A permanent one is R6 - the provider's own refusal, and nothing was removed.
 * Anything else that arrives after the delete was sent is §2.4's uncertainty.
 */
function isPermanentRefusal(error: unknown): boolean {
  if (!(error instanceof AuxxError)) return false
  return (
    error.statusCode >= 400 && error.statusCode < 500 && ![401, 408, 429].includes(error.statusCode)
  )
}

/**
 * Remove the provider's copy of each of these postings and hold them for re-sync.
 *
 * **Never throws.** One posting refusing does not stop the rest - a mapping that
 * was wrong for three months is hundreds of rows, and a bulk door that aborts on
 * the first exception is not a door (E6). Every answer is one
 * {@link UnsyncOutcome} per posting and the tallies are re-counted off them.
 *
 * ⚠️ One posting at a time, and it WAITS on the provider. A delete is a provider
 * round trip and a batch transaction spanning forty of them is the thing
 * `delivery.ts` was written to stop; waiting is E8 - "we have asked to delete 40
 * things, check back later" is not an answer anybody can act on, and R5 and R6
 * are exactly what the operator pressed the button to find out.
 *
 * `force` bypasses R5 alone. It is the *Un-sync anyway* on a row whose copy the
 * accountant has edited since we sent it, and it discards that edit.
 */
export async function unsyncExports(
  db: Database,
  input: { organizationId: string; glPostingIds: string[]; force?: boolean }
): Promise<Result<UnsyncResult, Error>> {
  const { organizationId, force } = input
  // De-duped for `releaseExportsForSync`'s reason: a selection built from
  // checkboxes over a list that re-fetched underneath somebody can carry the
  // same id twice, and withdrawing twice is two provider round trips.
  const glPostingIds = [...new Set(input.glPostingIds)]

  try {
    const provider = await resolveAccountingProvider(organizationId)
    const providerLabel = providerDisplayName(provider.id)
    const outcomes: UnsyncOutcome[] = []

    for (const glPostingId of glPostingIds) {
      outcomes.push(
        await unsyncOne(db, { organizationId, glPostingId, providerLabel, provider, force })
      )
    }

    const result: UnsyncResult = {
      withdrawn: outcomes.filter((o) => o.status === 'withdrawn').length,
      refused: outcomes.filter((o) => o.status === 'refused').length,
      failed: outcomes.filter((o) => o.status === 'uncertain' || o.status === 'error').length,
      outcomes,
    }
    logger.info('Un-synced postings', { organizationId, ...result, outcomes: undefined })
    return ok(result)
  } catch (error) {
    const reason = message(error)
    logger.error('Un-syncing postings failed', { organizationId, error: reason })
    return err(error instanceof Error ? error : new Error(reason))
  }
}

/** The five steps of §5.1 for one posting. Never throws. */
async function unsyncOne(
  db: Database,
  ctx: {
    organizationId: string
    glPostingId: string
    providerLabel: string
    provider: Awaited<ReturnType<typeof resolveAccountingProvider>>
    force?: boolean
  }
): Promise<UnsyncOutcome> {
  const { organizationId, glPostingId, providerLabel, provider } = ctx

  // Step 1.
  let eligibility: Awaited<ReturnType<typeof readUnsyncTarget>>
  try {
    eligibility = await readUnsyncTarget(db, { organizationId, glPostingId, providerLabel })
  } catch (error) {
    return { glPostingId, docNumber: null, status: 'error', message: message(error) }
  }
  if (!eligibility.eligible)
    return {
      glPostingId,
      docNumber: eligibility.docNumber,
      status: 'refused',
      message: eligibility.reason,
    }

  const { target } = eligibility
  const base = { glPostingId, docNumber: target.docNumber }

  // Step 2.
  let claim: Awaited<ReturnType<typeof claimUnsyncOperation>>
  try {
    claim = await claimUnsyncOperation(db, {
      organizationId,
      deliveryId: target.deliveryId,
      operationKey: unsyncOperationKey(target.attemptEpoch + 1),
      leaseMs: LEASE_MS,
      externalId: target.externalId,
      docNumber: target.docNumber,
    })
  } catch (error) {
    return { ...base, status: 'error', message: message(error) }
  }
  if (claim.kind !== 'claimed')
    return {
      ...base,
      status: 'error',
      message:
        claim.kind === 'busy'
          ? `${target.docNumber} is already being removed from ${providerLabel}.`
          : `${target.docNumber} has already been removed from ${providerLabel}.`,
    }

  const { operation, token } = claim
  let possibleSend = false

  try {
    // Step 3. An absent copy is also §2.4's recovery: a previous delete whose
    // outcome was unknown DID land, so the reset may proceed with no second
    // blind delete.
    const before = await readRemoteJournal({
      organizationId,
      providerLabel,
      docNumber: target.docNumber,
      externalId: target.externalId,
    })
    if (before.isErr()) throw before.error

    let outcome: Record<string, unknown> = {
      status: 'already_gone',
      externalId: target.externalId,
      providerId: provider.id,
    }

    if (before.value.present) {
      // R5. Refused by default; `force` is the row's *Un-sync anyway*.
      if (!ctx.force && before.value.remoteVersion !== target.remoteVersion) {
        const reason =
          `Somebody edited ${target.docNumber} in ${providerLabel} after we sent it. ` +
          'Removing it discards that edit.'
        await markUnsyncFailed(db, { operation, token, state: 'blocked', reason })
        return { ...base, status: 'refused', message: reason, forcible: true }
      }

      await markUnsyncSending(db, operation, token)
      possibleSend = true
      // Step 4. The version sent is the one just READ, not the one stored - on
      // `force` they differ, and the provider refuses a delete carrying a stale one.
      const withdrawn = await provider.withdrawObject({
        orgId: organizationId,
        objectType: 'journal',
        externalId: target.externalId,
        remoteVersion: before.value.remoteVersion ?? target.remoteVersion,
      })
      if (withdrawn.isErr()) throw withdrawn.error
      outcome = { ...withdrawn.value }

      // 🛑 Proved absent, never assumed. An accepted delete that left the copy
      // standing would otherwise reset a row whose journal is still in their books.
      const after = await readRemoteJournal({
        organizationId,
        providerLabel,
        docNumber: target.docNumber,
        externalId: target.externalId,
      })
      if (after.isErr()) throw after.error
      if (after.value.present)
        throw new Error(
          `${providerLabel} still holds ${target.docNumber} after accepting its removal.`
        )
    }

    // Step 5.
    await saveWithdrawal(db, {
      operation,
      token,
      deliveryId: target.deliveryId,
      glPostingId,
      externalObjectId: target.objectId,
      outcome,
    })
    logger.info('Withdrew a delivered journal', {
      organizationId,
      glPostingId,
      docNumber: target.docNumber,
      providerId: provider.id,
      forced: Boolean(ctx.force),
    })
    return { ...base, status: 'withdrawn' }
  } catch (error) {
    const reason = message(error)
    const permanent = isPermanentRefusal(error)
    const state = possibleSend && !permanent ? ('uncertain' as const) : ('blocked' as const)
    try {
      await markUnsyncFailed(db, { operation, token, state, reason })
    } catch (saveError) {
      logger.warn('Could not record a refused withdrawal', {
        organizationId,
        glPostingId,
        error: message(saveError),
      })
    }
    logger.warn('A journal withdrawal did not complete', {
      organizationId,
      glPostingId,
      docNumber: target.docNumber,
      state,
      error: reason,
    })
    // 🛑 Nothing on `GlPosting` changed, so the row keeps its *Synced* badge and
    // the provider's own refusal on it - the copy really is still in their books.
    return {
      ...base,
      status: state === 'uncertain' ? 'uncertain' : permanent ? 'refused' : 'error',
      message: reason,
    }
  }
}

export type { RemoteJournalSnapshot, UnsyncEligibility, UnsyncTarget } from './reads'
export { readRemoteJournal, readUnsyncTarget } from './reads'
export { unsyncOperationKey } from './writes'
