// packages/lib/src/data-migrations/migrations/160-gateway-settlement-fields.ts
import type { PerOrgMigration } from '../per-org'

/**
 * Retired: 166 deletes every field this created and the registry no longer declares them,
 * so a database that skipped past 160 has nothing to provision here.
 */
export const migration160GatewaySettlementFields: PerOrgMigration = {
  id: '160-gateway-settlement-fields',
  description: 'Adds settlement account, currency and receiving bank fields to payment gateways.',
  async up() {
    return { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0, alreadyUpToDate: true }
  },
}
