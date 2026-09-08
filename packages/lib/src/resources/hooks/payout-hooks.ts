// packages/lib/src/resources/hooks/payout-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Issue `PAY-0001` on create. Mirrors `autoGenerateBankDepositNumber`.
 *
 * `payout_number` is `creatable: false` / `updatable: false` and `payout`
 * declares `primaryDisplayField: 'number'`, so this hook is the ONLY writer and
 * without it every payout renders nameless.
 *
 * 🛑 **The number is load-bearing beyond display.** It becomes the posting's
 * `periodKey`, because `buildPayoutEntry` refuses a bare gateway id: a Stripe
 * `po_…` is 27 characters against a 21-character document-number cap, and the
 * payout cannot key on a date instead because two payouts can settle in one day
 * - the second would collide with the first on
 * `(organizationId, postingType, periodKey, revision)` and come back
 * `already_posted` having written nothing. So a payout with no number cannot be
 * posted at all.
 *
 * Issued exactly once, resting on the same three things every other number hook
 * does: `operation !== 'create'` returns early, the sync performs exactly one
 * `UnifiedCrudHandler.create` per payout, and `recordNumbering.create`
 * increments and reads back in a single `UPDATE ... RETURNING`.
 */
const autoGeneratePayoutNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  return {
    ...values,
    [field.id]: (await recordNumbering.create(organizationId, 'payout')).recordNumber,
  }
}

/**
 * `payout` system hooks: the RecordSequence number on create, and nothing else.
 *
 * 🛑 **`payout_status` is deliberately NOT guarded here**, for the reason
 * `journal-entry-hooks.ts` and `build-hooks.ts` both give:
 * `UnifiedCrudHandler.runPreHooks` consults no equivalent of
 * `bypassFieldGuards`, and the sync writes the status through
 * `UnifiedCrudHandler.update` when a payout goes `in_transit` to `paid` or
 * `failed`. A guard on this chain would refuse the transitions it was built to
 * protect. There is no person-facing edit door to a payout at all - it is
 * written by the sync and nothing else.
 */
export const PAYOUT_HOOKS: SystemHookRegistry = {
  payout_number: [autoGeneratePayoutNumber],
}
