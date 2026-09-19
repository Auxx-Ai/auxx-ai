// packages/lib/src/data-migrations/migrations/180-customer-transaction-gateway-ids.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { CUSTOMER_TRANSACTION_FIELDS } from '../../resources/registry/resources/customer-transaction-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:180')

const CUSTOMER_TRANSACTION_ENTITY_TYPE = 'customer_transaction'

/** Resolved out of {@link CUSTOMER_TRANSACTION_FIELDS}, so a stored field cannot disagree with a fresh org's. */
const NEW_FIELD_KEYS = ['authorizationCode', 'gatewayTransactionId'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 180: `authorizationCode` and `gatewayTransactionId` on `customer_transaction`
 * (`plans/apps/authorize-net/authorize-net-build-plan.md` §6). INSERT-only, no backfill:
 * both values arrive on the next Shopify sync, and the resolver treats NULL as unreferenced.
 */
export const migration180CustomerTransactionGatewayIds: PerOrgMigration = {
  id: '180-customer-transaction-gateway-ids',
  description:
    "Adds customer_transaction.authorizationCode and .gatewayTransactionId - the gateway's own " +
    'authorisation code and transaction id behind a storefront payment, the join from an ' +
    'Authorize.net settled batch member back to its order (authorize-net plan §6)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const transactionDef = existing.entityDefs.get(CUSTOMER_TRANSACTION_ENTITY_TYPE)
    if (!transactionDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = CUSTOMER_TRANSACTION_FIELDS[key]
      if (!field) {
        throw new Error(
          `customer-transaction-fields registry is missing the key "${key}" (migration 180)`
        )
      }
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      CUSTOMER_TRANSACTION_ENTITY_TYPE,
      transactionDef.id,
      fields,
      existing,
      state
    )

    if (state.fieldsCreated > 0) {
      // The write bypasses the org cache and `UnifiedCrudHandler` resolves a
      // field's shape from it, so a stale entry would drop every connector write.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 180 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: state.fieldsCreated === 0 }
  },
}
