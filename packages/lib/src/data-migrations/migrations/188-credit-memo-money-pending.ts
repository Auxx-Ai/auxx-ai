// packages/lib/src/data-migrations/migrations/188-credit-memo-money-pending.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:188')

const CREDIT_MEMO = 'credit_memo'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 188: `credit_memo.moneyPending`, the channel's "a refund transaction is still
 * pending" flag a channel memo waits on before it issues (101 E9). No backfill: the next
 * sync transcribes it. Idempotent — `ensureCustomFields` is INSERT-only.
 */
export const migration188CreditMemoMoneyPending: PerOrgMigration = {
  id: '188-credit-memo-money-pending',
  description:
    'Adds credit_memo.moneyPending — whether a channel refund transaction is still pending, ' +
    'which holds the memo back from issuing (101 E9). No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const memoDef = existing.entityDefs.get(CREDIT_MEMO)
    if (!memoDef) return { ...state, alreadyUpToDate: true }

    const field = CREDIT_MEMO_FIELDS.moneyPending as ResourceField | undefined
    if (!field) {
      throw new Error('The credit-memo registry is missing moneyPending (migration 188)')
    }

    await ensureCustomFields(
      db,
      organizationId,
      CREDIT_MEMO,
      memoDef.id,
      { moneyPending: field },
      existing,
      state
    )

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 188 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
