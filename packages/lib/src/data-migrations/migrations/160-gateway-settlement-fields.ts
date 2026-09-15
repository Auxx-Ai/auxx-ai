// packages/lib/src/data-migrations/migrations/160-gateway-settlement-fields.ts
import { getOrgCache } from '../../cache'
import { BANK_ACCOUNT_FIELDS } from '../../resources/registry/resources/bank-account-fields'
import { PAYMENT_GATEWAY_FIELDS } from '../../resources/registry/resources/payment-gateway-fields'
import {
  ensureCustomFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import type { PerOrgMigration } from '../per-org'

/** Provision settlement selections on existing gateways without guessing account mappings. */
export const migration160GatewaySettlementFields: PerOrgMigration = {
  id: '160-gateway-settlement-fields',
  description: 'Adds settlement account, currency and receiving bank fields to payment gateways.',
  async up(db, organizationId) {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    const definition = existing.entityDefs.get('payment_gateway')
    const bankDefinition = existing.entityDefs.get('bank_account')
    if (!definition || !bankDefinition) return { ...state, alreadyUpToDate: true }
    const keys = ['settlementAccount', 'settlementCurrency', 'settlementBankAccount'] as const
    const fields = Object.fromEntries(
      keys.map((key) => {
        const field = PAYMENT_GATEWAY_FIELDS[key]
        if (!field) throw new Error(`Missing payment gateway field: ${key}`)
        return [key, field]
      })
    )
    const gatewayFields = await ensureCustomFields(
      db,
      organizationId,
      'payment_gateway',
      definition.id,
      fields,
      existing,
      state
    )
    const inverse = BANK_ACCOUNT_FIELDS.settlementGateways
    if (!inverse) throw new Error('Missing bank account settlement gateways field')
    const bankFields = await ensureCustomFields(
      db,
      organizationId,
      'bank_account',
      bankDefinition.id,
      { settlementGateways: inverse },
      existing,
      state
    )
    await linkNewRelationships(
      db,
      new Map([...gatewayFields, ...bankFields]),
      new Map([
        ['payment_gateway', definition.id],
        ['bank_account', bankDefinition.id],
      ]),
      state
    )
    if (state.fieldsCreated || state.relationshipsLinked) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    }
    return {
      ...state,
      alreadyUpToDate: state.fieldsCreated === 0 && state.relationshipsLinked === 0,
    }
  },
}
