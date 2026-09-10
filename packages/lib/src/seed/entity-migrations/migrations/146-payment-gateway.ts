// packages/lib/src/seed/entity-migrations/migrations/146-payment-gateway.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import { PAYMENT_GATEWAY_FIELDS } from '../../../resources/registry/resources/payment-gateway-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:146')

/** The def this migration creates. */
const PAYMENT_GATEWAY_ENTITY_TYPE = 'payment_gateway'

/**
 * A new def is invisible to every read path that serves it until the org's
 * `resources` cache is dropped.
 */
const CACHE_KEYS = ['resources'] as const

/**
 * Migration 146: the `payment_gateway` def and its fields
 * (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §5.3, HANDOFF
 * step 5).
 *
 * ## Why
 *
 * §5.1's gateway census found eleven distinct handles across five card rails on
 * one store's history, and the pattern already applied once for a second
 * gateway (`clearing_affirm`, entity migration 137) does not survive a third:
 * role-per-gateway costs a role, an account and a chart migration per rail.
 * This migration creates the record instead - a gateway carries its own
 * clearing account, fee account and settlement source, and is a row a merchant
 * can add without an engineer.
 *
 * Independent of the chart (`gl_account`): the two default rows the census
 * names (`Shopify Payments`, `Affirm`) are seeded by `seedDefaultPaymentGateways`
 * in `seed/gl-account-chart.ts`, once the org has PROVISIONED a chart and the
 * clearing accounts those defaults point at actually exist - this migration
 * only creates the def and its fields, so it has no ordering constraint
 * against 108, 133, 142, 143 or 144.
 *
 * Idempotent: `ensureEntityDefinitions` / `ensureCustomFields` skip whatever the
 * org already holds.
 */
export const migration146PaymentGateway: EntityMigration = {
  id: '146-payment-gateway',
  description:
    'Adds the payment_gateway def and its fields - a record carrying its own clearing account, ' +
    'never a role (task 13 §5.3)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === PAYMENT_GATEWAY_ENTITY_TYPE),
      existing,
      state
    )

    const defId = entityDefIds.get(PAYMENT_GATEWAY_ENTITY_TYPE)
    if (defId) {
      const fieldMap = await ensureCustomFields(
        db,
        organizationId,
        PAYMENT_GATEWAY_ENTITY_TYPE,
        defId,
        PAYMENT_GATEWAY_FIELDS,
        existing,
        state
      )
      await linkDisplayFields(db, [PAYMENT_GATEWAY_ENTITY_TYPE], entityDefIds, fieldMap)
    }

    const changed = state.entityDefsCreated > 0 || state.fieldsCreated > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 146 applied', {
        organizationId,
        entityDefsCreated: state.entityDefsCreated,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
