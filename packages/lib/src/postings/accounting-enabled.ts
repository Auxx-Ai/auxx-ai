// packages/lib/src/postings/accounting-enabled.ts

import type { Database } from '@auxx/database'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'

/**
 * Has this organization enabled the accounting module at all?
 *
 * The gate every document-driven posting trigger checks FIRST
 * (plans/accounting/tasks/17-accounting-is-opt-in.md section 3). An org that
 * never turned accounting on is a first-class silent case, like `not_connected`
 * under decision P1: nothing is built, nothing is claimed, nothing is logged,
 * and the trigger answers `not_enabled`. It is deliberately distinct from
 * `accounting.setupState`, which means the module is ON and the wizard was not
 * finished; that one keeps its `setup_incomplete` refusal and its warning.
 *
 * Reads `FeatureKey.accounting` through `FeaturePermissionService`, which is the
 * same door the ledger router and the nav use, so a trigger and a screen cannot
 * disagree about whether accounting exists for an org. That service reads the
 * org cache's `features` key (30-day TTL, invalidated on plan events) and
 * answers `true` on a self-hosted install, where every feature is on.
 */
export async function isAccountingEnabled(db: Database, organizationId: string): Promise<boolean> {
  return new FeaturePermissionService(db).hasAccess(organizationId, FeatureKey.accounting)
}
