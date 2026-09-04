// packages/lib/src/resources/hooks/bank-deposit-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the deposit number on create. Mirrors `autoGenerateBuildNumber`.
 *
 * `bank_deposit_number` is `creatable: false` / `updatable: false` and
 * `bank_deposit` declares `primaryDisplayField: 'number'`, so this hook is the
 * ONLY writer and without it every deposit renders nameless.
 *
 * 🛑 It is also what the POSTING is keyed on. `postings/doc-number.ts` keys a
 * `bank_deposit` entry's `periodKey` on this string rather than on a date,
 * because two deposits can be banked on one day and a date key would collide
 * them into one entry whose total ties to neither bank line. A cuid is 24
 * characters and `buildDocNumber` refuses it outright.
 *
 * Issued exactly once: `operation !== 'create'` returns early, and
 * `recordNumbering.create` increments and reads back in a single
 * `UPDATE ... RETURNING`, so two concurrent creates cannot be handed the same
 * number.
 */
const autoGenerateBankDepositNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'bank_deposit')
  return { ...values, [field.id]: recordNumber }
}

/**
 * `bank_deposit` system hooks: the RecordSequence number on create, nothing else.
 *
 * The immutability rule (a cleared or matched deposit refuses edits) is
 * deliberately NOT here. It is a business rule with a message that names the
 * bank line, and it lives in `money/bank-deposits/writes.ts` where the router
 * can surface it as an `EntryBlockers` card - a hook can only refuse, and it
 * would also refuse `clearBankDeposit`, which is the one write that must set
 * those fields.
 */
export const BANK_DEPOSIT_HOOKS: SystemHookRegistry = {
  bank_deposit_number: [autoGenerateBankDepositNumber],
}
