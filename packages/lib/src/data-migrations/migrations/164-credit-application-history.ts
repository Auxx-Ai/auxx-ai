// packages/lib/src/data-migrations/migrations/164-credit-application-history.ts
import { getOrgCache } from '../../cache'
import { CREDIT_MEMO_APPLICATION_FIELDS } from '../../resources/registry/resources/credit-memo-application-fields'
import {
  ensureCustomFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import type { PerOrgMigration } from '../per-org'

/** Add reversal history to existing credit applications without replacing their identities. */
export const migration164CreditApplicationHistory: PerOrgMigration = {
  id: '164-credit-application-history',
  description: 'Adds operation and original-application links to credit application history.',
  async up(db, organizationId) {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    const definition = existing.entityDefs.get('credit_memo_application')
    if (!definition) return { ...state, alreadyUpToDate: true }
    const fields = await ensureCustomFields(
      db,
      organizationId,
      'credit_memo_application',
      definition.id,
      Object.fromEntries(
        ['operation', 'reversesApplication', 'reversals'].map((key) => [
          key,
          CREDIT_MEMO_APPLICATION_FIELDS[key]!,
        ])
      ),
      existing,
      state
    )
    await linkNewRelationships(
      db,
      fields,
      new Map([['credit_memo_application', definition.id]]),
      state
    )
    if (state.fieldsCreated || state.relationshipsLinked)
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    return {
      ...state,
      alreadyUpToDate: state.fieldsCreated === 0 && state.relationshipsLinked === 0,
    }
  },
}
