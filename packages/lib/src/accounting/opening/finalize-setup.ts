// packages/lib/src/accounting/opening/finalize-setup.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { batchUpdateOrganizationSettings } from '../../settings/settings-service'
import {
  readOpeningFromNothing,
  resolveSetupReadiness,
  SETUP_READINESS_SETTING_KEYS,
} from '../ledger/setup/setup-readiness'
import type { PostResult } from '../ledger/types'
import { guard } from './guard'
import { readOpeningPresence } from './reads'
import { postOpeningTrialBalance } from './writes'

const logger = createScopedLogger('postings:opening-trial-balance')

/** What finalize did. */
export interface FinalizeSetupOutcome {
  /** False when setup was already finalized and only the opening post was retried. */
  finalizedNow: boolean
  /** The opening entry's post, or null when there was nothing to post. */
  opening: PostResult | null
}

/**
 * Finalize accounting setup, then post the opening entry.
 *
 * Settings first, then the post, so nothing posts into books still in setup. Re-running
 * on a finalized org retries only the opening post, which is how a refused post (a closed
 * period, an unmapped account) is retried once fixed. No permission checks: the router
 * asserts `ledgerControl`.
 *
 * @throws {UnprocessableEntityError} listing the unmet requirements, when setup is not ready.
 */
export async function finalizeAccountingSetup(
  db: Database,
  input: { organizationId: string; actorUserId: string }
): Promise<Result<FinalizeSetupOutcome, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const [settings, presence] = await Promise.all([
        // `db` for a committed read: this is the gate, not a hint.
        readOrganizationSettings(organizationId, SETUP_READINESS_SETTING_KEYS, db),
        readOpeningPresence(db, organizationId),
      ])
      const record = settings as Record<string, unknown>
      const readiness = resolveSetupReadiness(record, { opening: presence })
      const unmet = readiness.requirements.filter((requirement) => !requirement.met)
      if (unmet.length > 0) {
        throw new UnprocessableEntityError(
          `Accounting setup is not ready to finalize: ${unmet.map((r) => r.reason).join(' ')}`,
          { organizationId, unmet: unmet.map((r) => r.key) }
        )
      }

      const finalizedNow = !readiness.finalized
      if (finalizedNow) {
        await batchUpdateOrganizationSettings({
          organizationId,
          settings: [
            { key: 'accounting.setupState', value: 'finalized' },
            { key: 'accounting.setupFinalizedAt', value: new Date().toISOString() },
            { key: 'accounting.setupFinalizedByUserId', value: actorUserId },
          ],
          db,
        })
      }

      let opening: PostResult | null = null
      if (!readOpeningFromNothing(record) && !presence.posted) {
        const posted = await postOpeningTrialBalance(db, organizationId, actorUserId)
        if (posted.isErr()) throw posted.error
        opening = posted.value
      }

      logger.info('Finalized accounting setup', {
        organizationId,
        finalizedNow,
        openingStatus: opening?.status ?? 'none',
      })
      return { finalizedNow, opening }
    },
    'Failed to finalize accounting setup',
    { organizationId }
  )
}
