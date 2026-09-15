// packages/lib/src/data-migrations/migrations/163-financial-source-fields.ts
import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { CUSTOMER_TRANSACTION_FIELDS } from '../../resources/registry/resources/customer-transaction-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { PAYOUT_SOURCE_FIELDS } from '../../resources/registry/resources/payout-source-fields'
import { PROCESSOR_BALANCE_ENTRY_FIELDS } from '../../resources/registry/resources/processor-balance-entry-fields'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration } from '../per-org'

/** Provision normal financial source fields and their standard child relationships. */
export const migration163FinancialSourceFields: PerOrgMigration = {
  id: '163-financial-source-fields',
  description: 'Adds individually mapped payout, processor, and customer transaction fields.',
  async up(db, organizationId) {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    const definitions = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((definition) =>
        ['customer_transaction', 'processor_balance_entry'].includes(definition.entityType)
      ),
      existing,
      state
    )
    for (const [kind, definition] of existing.entityDefs) definitions.set(kind, definition.id)
    const fieldMaps = new Map()
    const resources = {
      payout: PAYOUT_SOURCE_FIELDS,
      processor_balance_entry: PROCESSOR_BALANCE_ENTRY_FIELDS,
      customer_transaction: CUSTOMER_TRANSACTION_FIELDS,
      order: Object.fromEntries(
        Object.entries(ORDER_FIELDS).filter(
          ([, field]) =>
            field.systemAttribute === 'order_payment_transactions' ||
            field.systemAttribute?.startsWith('order_payment_source_')
        )
      ),
    }
    for (const [kind, fields] of Object.entries(resources)) {
      const definitionId = definitions.get(kind)
      if (!definitionId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        kind,
        definitionId,
        fields,
        existing,
        state
      )
      for (const [key, field] of created) fieldMaps.set(key, field)
      // Existing processor aliases become ordinary writable fields with the same stable IDs.
      for (const field of Object.values(fields)) {
        if (!field.systemAttribute) continue
        await db
          .update(schema.CustomField)
          .set({
            type: field.fieldType,
            isCreatable: true,
            isUpdatable: true,
            required: false,
            active: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.CustomField.organizationId, organizationId),
              eq(schema.CustomField.entityDefinitionId, definitionId),
              eq(schema.CustomField.systemAttribute, field.systemAttribute)
            )
          )
      }
    }
    await linkNewRelationships(db, fieldMaps, definitions, state)
    await db
      .update(schema.CustomField)
      .set({
        active: false,
        isCreatable: false,
        isUpdatable: false,
        required: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          inArray(schema.CustomField.systemAttribute, [
            'payout_evidence',
            'processor_balance_evidence',
            'order_payment_evidence',
            'payout_source_amount_minor',
            'payout_destination_amount_minor',
            'payout_destination_currency',
            'payout_destination_currency_exponent',
          ])
        )
      )
    await getOrgCache().invalidateAndRecompute(organizationId, [
      'entityDefs',
      'entityDefSlugs',
      'customFields',
      'resources',
    ])
    return { ...state, alreadyUpToDate: false }
  },
}
