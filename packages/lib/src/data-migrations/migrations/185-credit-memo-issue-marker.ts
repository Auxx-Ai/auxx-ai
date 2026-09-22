// packages/lib/src/data-migrations/migrations/185-credit-memo-issue-marker.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:185')

const CREDIT_MEMO = 'credit_memo'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 185: `credit_memo.issueBlockedReason` / `.issueBlockedAt`, the
 * channel memo pass's marker (`plans/accounting/tasks/88-refunds-do-not-block-their-receipts.md`
 * §7.4) - migration 184's twin on the memo. No backfill; idempotent.
 */
export const migration185CreditMemoIssueMarker: PerOrgMigration = {
  id: '185-credit-memo-issue-marker',
  description:
    'Adds credit_memo.issueBlockedReason and .issueBlockedAt - why the channel memo pass last ' +
    'refused to issue a memo and when, the marker it backs off on (88 §7.4). No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const memoDef = existing.entityDefs.get(CREDIT_MEMO)
    if (!memoDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of ['issueBlockedReason', 'issueBlockedAt'] as const) {
      const field = CREDIT_MEMO_FIELDS[key] as ResourceField | undefined
      if (!field) throw new Error(`The credit memo registry is missing ${key} (migration 185)`)
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, CREDIT_MEMO, memoDef.id, fields, existing, state)

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 185 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
