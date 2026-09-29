// packages/lib/src/inventory/movements/restamp-accounts.ts

import type { Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { restampMovementGlRoles } from './update-movements'

const logger = createScopedLogger('inventory-movements:restamp-accounts')

/** The prose recorded on every account restamp. Greppable, and the audit trail. */
export const RESTAMP_MOVEMENT_ACCOUNT_REASON =
  "the part's kind changed after these movements were written and none of them is in the books yet, so their frozen inventory account is restamped to the one the current kind maps to"

/** One old-role → new-role rewrite over movements the caller has proven unposted. */
export interface MovementAccountRestamp {
  fromRole: string
  toRole: string
  movementIds: readonly string[]
}

/**
 * Rewrite `glRole` on unposted movements, the one sanctioned edit of it. Only a row still reading
 * `fromRole` changes, so a re-run is a no-op. The caller holds the accounting commit lock and has
 * re-checked that no row is posted.
 */
export async function restampMovementAccounts(
  tx: Transaction,
  organizationId: string,
  restamps: readonly MovementAccountRestamp[]
): Promise<number> {
  let changed = 0
  for (const { fromRole, toRole, movementIds } of restamps) {
    changed += await restampMovementGlRoles(tx, organizationId, {
      fromRole,
      toRole,
      ids: movementIds,
    })
  }
  if (changed > 0) {
    logger.info('Restamped movement inventory accounts', {
      organizationId,
      changed,
      reason: RESTAMP_MOVEMENT_ACCOUNT_REASON,
      restamps: restamps.map((r) => ({
        from: r.fromRole,
        to: r.toRole,
        rows: r.movementIds.length,
      })),
    })
  }
  return changed
}
