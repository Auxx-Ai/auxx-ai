// packages/lib/src/inventory/movements/restamp-accounts.ts

import { schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'

const logger = createScopedLogger('inventory-movements:restamp-accounts')

const CHUNK = 1000

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
 * Rewrite `stock_movement_gl_account` on unposted movements, the one sanctioned edit of that
 * `updatable: false` field. Only a row still reading `fromRole` changes, so a re-run is a no-op.
 * The caller holds the accounting commit lock and has re-checked that no row is posted.
 */
export async function restampMovementAccounts(
  tx: Transaction,
  organizationId: string,
  accountFieldId: string,
  restamps: readonly MovementAccountRestamp[]
): Promise<number> {
  const t = schema.FieldValue
  let changed = 0
  // A direct UPDATE: tens of thousands of rows through the record handler one by one is minutes.
  for (const { fromRole, toRole, movementIds } of restamps) {
    const ids = [...new Set(movementIds)].sort()
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await tx
        .update(t)
        .set({ valueText: toRole, updatedAt: new Date() })
        .where(
          and(
            eq(t.organizationId, organizationId),
            eq(t.fieldId, accountFieldId),
            inArray(t.entityId, ids.slice(i, i + CHUNK)),
            eq(t.valueText, fromRole)
          )
        )
        .returning({ entityId: t.entityId })
      changed += rows.length
    }
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
