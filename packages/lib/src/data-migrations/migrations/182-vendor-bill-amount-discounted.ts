// packages/lib/src/data-migrations/migrations/182-vendor-bill-amount-discounted.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:182')

const VENDOR_BILL = 'vendor_bill'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 182: `vendor_bill.amountDiscounted`, the early-payment discount's
 * mirror on the bill (`plans/accounting/tasks/75-what-the-74-retest-found.md`
 * §1.4, 75-D3). 74 declared the field and shipped no migration for it, so it
 * existed in the registry and in no org — and every reader tolerates its
 * absence, which is why the discount dropped out of the balance in silence.
 *
 * No backfill: the only `MoneyApplication.discountMinor` in existence is the
 * retest's. Idempotent — `ensureCustomFields` is INSERT-only.
 */
export const migration182VendorBillAmountDiscounted: PerOrgMigration = {
  id: '182-vendor-bill-amount-discounted',
  description:
    'Adds vendor_bill.amountDiscounted — how much of a bill an early-payment discount settled ' +
    '(74 D3), declared in the registry but provisioned into no org. No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const billDef = existing.entityDefs.get(VENDOR_BILL)
    if (!billDef) return { ...state, alreadyUpToDate: true }

    const field = VENDOR_BILL_FIELDS.amountDiscounted as ResourceField | undefined
    if (!field) {
      throw new Error('The vendor-bill registry is missing amountDiscounted (migration 182)')
    }

    await ensureCustomFields(
      db,
      organizationId,
      VENDOR_BILL,
      billDef.id,
      { amountDiscounted: field },
      existing,
      state
    )

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 182 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
