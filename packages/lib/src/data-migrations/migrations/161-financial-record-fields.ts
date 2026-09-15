// packages/lib/src/data-migrations/migrations/161-financial-record-fields.ts
import { getOrgCache } from '../../cache'
import { PAYOUT_FIELDS } from '../../resources/registry/resources/payout-fields'
import { PROCESSOR_BALANCE_ENTRY_FIELDS } from '../../resources/registry/resources/processor-balance-entry-fields'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  loadExistingState,
} from '../../seed/entity-helpers'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration } from '../per-org'

/** Provision canonical financial record fields without converting legacy payout money. */
export const migration161FinancialRecordFields: PerOrgMigration = {
  id: '161-financial-record-fields',
  description: 'Adds payout source evidence and processor transaction records.',
  async up(db, organizationId) {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    const payout = existing.entityDefs.get('payout')
    if (!payout) return { ...state, alreadyUpToDate: true }
    const definitions = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((d) => d.entityType === 'processor_balance_entry'),
      existing,
      state
    )
    const activity = definitions.get('processor_balance_entry')
    if (!activity) throw new Error('Processor transaction definition was not provisioned')
    await ensureCustomFields(
      db,
      organizationId,
      'processor_balance_entry',
      activity,
      PROCESSOR_BALANCE_ENTRY_FIELDS,
      existing,
      state
    )
    const evidence = PAYOUT_FIELDS.evidence
    if (!evidence) throw new Error('Payout source evidence field is missing')
    await ensureCustomFields(db, organizationId, 'payout', payout.id, { evidence }, existing, state)
    const changed = state.entityDefsCreated > 0 || state.fieldsCreated > 0
    if (changed)
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
    return { ...state, alreadyUpToDate: !changed }
  },
}
