// packages/lib/src/data-migrations/migrations/162-order-payment-evidence.ts
import { getOrgCache } from '../../cache'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration } from '../per-org'

/** Expose stored order transaction evidence to every ordinary record intake. */
export const migration162OrderPaymentEvidence: PerOrgMigration = {
  id: '162-order-payment-evidence',
  description: 'Adds source payment evidence to order records.',
  async up(db, organizationId) {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId),
      order = existing.entityDefs.get('order')
    if (!order) return { ...state, alreadyUpToDate: true }
    await ensureCustomFields(
      db,
      organizationId,
      'order',
      order.id,
      { paymentEvidence: ORDER_FIELDS.paymentEvidence! },
      existing,
      state
    )
    if (state.fieldsCreated)
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    return { ...state, alreadyUpToDate: state.fieldsCreated === 0 }
  },
}
