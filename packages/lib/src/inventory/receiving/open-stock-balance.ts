// packages/lib/src/inventory/receiving/open-stock-balance.ts

/**
 * `openStockBalance` — the create form's opening balance, which is `setCount` dated
 * `day` (103 O1, 111 D21). One door, so the dialog and the bulk page cannot disagree
 * about what an opening is.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { setCount } from './set-count'
import type { OpenStockBalanceInput, SetCountResult } from './types'

export type { OpenStockBalanceInput } from './types'

export async function openStockBalance(
  db: Database,
  organizationId: string,
  userId: string,
  input: OpenStockBalanceInput
): Promise<Result<SetCountResult, Error>> {
  return setCount(db, organizationId, {
    partId: input.partId,
    quantity: input.quantity,
    day: input.day,
    unitCost: input.unitCost,
    actorUserId: userId,
    notes: input.notes,
  })
}
