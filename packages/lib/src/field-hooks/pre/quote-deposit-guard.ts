// packages/lib/src/field-hooks/pre/quote-deposit-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { hasQuoteDeposit } from '../../money/checkout/reads'
import { unwrapStatusValue } from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookHandler } from '../types'

/**
 * The return-to-draft wall for `quote_status` (money MP2 build spec §B.10). The system-hook
 * chain's lifecycle guard (`resources/hooks/quote-hooks.ts`) is dead for real client writes to
 * this field — the generic records path (form edits, Kopilot record tools) runs
 * `fireFieldPreHooks` (this **field**-pre-hook chain), never
 * `UnifiedCrudHandler.runPreHooks` (the **system**-hook chain). So this guard, not that one, is
 * the actual enforcement point.
 *
 * Rejects a manual `quote_status → 'draft'` write when a succeeded deposit charge is already
 * held against the quote — editing a paid quote back to draft would orphan the deposit with no
 * document to reconcile it against.
 *
 * 🛑 **This guard shipped inert and had never once fired**
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §2). It unwrapped the array
 * case and compared the result to `'draft'` — but on THIS chain `validateAndConvertValue` has
 * already run, so a SINGLE_SELECT arrives as `{ type: 'option', optionId: 'draft' }` and never
 * as a bare string. The comparison could not be true, so every write returned early. The
 * array-unwrap idiom it copied is correct for the SYSTEM chain, which passes raw caller input;
 * carrying it across is what broke it. `unwrapStatusValue` handles both shapes and is what the
 * two sibling status guards use.
 */
export const guardQuoteDraftReturnWithPaidDeposit: FieldPreHookHandler = async (event) => {
  // The coerced envelope, the array wrapper and the bare string all reduce here — see the
  // note above on why unwrapping only the array was a guard that could never fire.
  if (unwrapStatusValue(event.newValue) !== 'draft') return event.newValue

  const { entityInstanceId } = parseRecordId(event.recordId)
  if (await hasQuoteDeposit(event.organizationId, entityInstanceId)) {
    throw new BadRequestError(
      'This quote cannot go back to draft because a deposit has been paid against it.'
    )
  }
  return event.newValue
}
