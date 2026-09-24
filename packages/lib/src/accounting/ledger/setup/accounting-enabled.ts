// packages/lib/src/accounting/ledger/setup/accounting-enabled.ts

import type { Database, Transaction } from '@auxx/database'
import { FeaturePermissionService } from '../../../permissions/feature-permission-service'
import { FeatureKey } from '../../../permissions/types'
import { readOrganizationSettings } from '../../../settings/read'
import { FINALIZED_SETUP_STATE } from './setup-readiness'

/**
 * Whether the org's plan has the accounting feature (always true self-hosted). Nav, routers and the
 * payout record import read this; writers of accounting rows read {@link isAccountingActive}.
 */
export async function isAccountingEnabled(
  db: Database | Transaction,
  organizationId: string
): Promise<boolean> {
  return new FeaturePermissionService(db).hasAccess(organizationId, FeatureKey.accounting)
}

/** Accounting feature on and the setup wizard finalized; both read from the org cache. */
export async function isAccountingActive(organizationId: string): Promise<boolean> {
  const enabled = await new FeaturePermissionService().hasAccess(
    organizationId,
    FeatureKey.accounting
  )
  if (!enabled) return false
  const settings = await readOrganizationSettings(organizationId, ['accounting.setupState'])
  return settings['accounting.setupState'] === FINALIZED_SETUP_STATE
}
