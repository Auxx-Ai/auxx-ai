// packages/lib/src/seed/entity-migrations/migrations/133-payout.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import { PAYOUT_FIELDS } from '../../../resources/registry/resources/payout-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { seedDefaultChartOfAccounts } from '../../gl-account-chart'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:133')

/** The def this migration creates. */
const PAYOUT_ENTITY_TYPE = 'payout'

/** The chart def the payout entry codes against. A real dependency, not a formality. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/** The account the payout entry's fourth leg credits. Seeded by the chart call below. */
export const UNIDENTIFIED_RECEIPTS_CODE = '2450'

/**
 * A new def and a new chart account are both invisible to every read path that
 * serves them until the org's `resources` cache is dropped.
 */
const CACHE_KEYS = ['resources'] as const

/**
 * Migration 133: the `payout` def, and `2450 Unidentified Receipts` with its
 * `unidentified_receipts` role.
 *
 * ## Why
 *
 * `postPayoutEntry` shipped in #2054 with no caller, so `1200` accumulated gross
 * at every card sale and never drained (HANDOFF §11.5 item 1). The sync that
 * fills it (`money/payouts/`) needs two things this migration puts in every org:
 *
 * 1. **A `payout` record to key on.** `buildPayoutEntry` refuses a bare `po_…` -
 *    a Stripe payout id is 27 characters against a 21-character
 *    document-number cap - and cannot key on a date instead, because two
 *    payouts can settle in one day and the second would collide with the first
 *    on `(organizationId, postingType, periodKey, revision)`, coming back
 *    `already_posted` having written nothing. So a payout needs a minted
 *    `PAY-0001`, and a minted number needs a row.
 * 2. **`2450 Unidentified Receipts`.** A gateway payout settles every charge the
 *    merchant took, including charges taken OUTSIDE auxx which were never
 *    debited to clearing. Crediting the payout's full gross to clearing would
 *    drive it permanently negative; relieving only the recognised part and
 *    debiting cash to match would break the bank reconciliation instead, because
 *    the bank shows one deposit for the whole payout. So cash takes the whole
 *    deposit, clearing is relieved of exactly what auxx put in it, and the
 *    remainder lands in `2450` where somebody has to work it.
 *
 * ## Self-sufficient, with nothing to backfill
 *
 * Payouts that settled BEFORE this ships deliberately get no entry. Their dates
 * sit in periods that are closed or about to be, the clearing balance they left
 * behind is already in the opening trial balance, and posting them now would
 * relieve clearing twice. The sync's watermark starts at the first run, not at
 * the beginning of time - see `money/payouts/sync-payouts.ts`.
 *
 * An org short of migration 108 has no chart at all and is a skip: 108 seeds the
 * whole current `DEFAULT_CHART_OF_ACCOUNTS`, `2450` included.
 */
export const migration133Payout: EntityMigration = {
  id: '133-payout',
  description:
    'Adds the payout def and 2450 Unidentified Receipts with its role - the record the Stripe ' +
    'payout sync keys on, and the account its fourth leg credits',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)
    // A payout entry codes against the chart, so an org with no chart def has
    // nothing to post about. The same dependency `addJournalEntryDef` declares.
    if (!existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)) {
      return { ...state, alreadyUpToDate: true }
    }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === PAYOUT_ENTITY_TYPE),
      existing,
      state
    )

    const defId = entityDefIds.get(PAYOUT_ENTITY_TYPE)
    if (defId) {
      const fieldMap = await ensureCustomFields(
        db,
        organizationId,
        PAYOUT_ENTITY_TYPE,
        defId,
        PAYOUT_FIELDS,
        existing,
        state
      )
      await linkDisplayFields(db, [PAYOUT_ENTITY_TYPE], entityDefIds, fieldMap)
    }

    // Idempotent on `code`, and its role insert is
    // `ON CONFLICT (organizationId, role) DO NOTHING`, so this one call creates
    // `2450` where it is missing, assigns `unidentified_receipts` where it is
    // unassigned, and touches nothing a bookkeeper has edited. Writing the
    // insert a second way here would be the second source of truth the chart
    // module exists to avoid.
    const chart = await seedDefaultChartOfAccounts(
      db,
      organizationId,
      existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)?.id
    )

    const changed =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      chart.created > 0 ||
      chart.rolesAssigned > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 133 applied', {
        organizationId,
        entityDefsCreated: state.entityDefsCreated,
        fieldsCreated: state.fieldsCreated,
        accountsCreated: chart.created,
        rolesAssigned: chart.rolesAssigned,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
