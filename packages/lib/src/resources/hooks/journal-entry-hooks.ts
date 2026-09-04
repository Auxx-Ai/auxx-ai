// packages/lib/src/resources/hooks/journal-entry-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Issue `JNL-0001` on create. Mirrors `autoGenerateBuildNumber`.
 *
 * `journal_entry_number` is `creatable: false` / `updatable: false` and
 * `journal_entry` declares `primaryDisplayField: 'number'`, so this hook is the
 * ONLY writer and without it every entry renders nameless.
 *
 * 🛑 **The number is load-bearing beyond display.** It becomes the posting's
 * `periodKey`, because `doc-number.ts` keys `manual_journal` on the record's own
 * number rather than on a date: many entries can post in one day, and a date key
 * would make the second collide with the first on
 * `(organizationId, postingType, periodKey, revision)` - the claim's unique
 * index - so the second would silently come back `already_posted` having written
 * nothing. A cuid is 24 characters and blows the 21-character document-number
 * cap outright. So an entry with no number cannot be posted at all, and issuing
 * it here rather than at post time is what makes the draft addressable before it
 * is committed to.
 *
 * Issued exactly once, resting on the same three things the build hook does:
 * `operation !== 'create'` returns early so an update never re-enters the
 * counter; `createJournalEntry` performs exactly one `UnifiedCrudHandler.create`;
 * and `recordNumbering.create` increments and reads back in a single
 * `UPDATE ... RETURNING`, so two concurrent creates cannot be handed one number.
 */
const autoGenerateJournalEntryNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'journal_entry')
  return { ...values, [field.id]: recordNumber }
}

/**
 * `journal_entry` system hooks: the RecordSequence number on create, and
 * nothing else.
 *
 * 🛑 **`journal_entry_status` is deliberately NOT guarded here**, for the reason
 * `build-hooks.ts` gives at length: `UnifiedCrudHandler.runPreHooks` consults no
 * equivalent of `bypassFieldGuards`, and `postJournalEntry` / `reverseJournalEntry`
 * both write the status through `UnifiedCrudHandler.update`. A guard on this
 * chain would refuse the two actions it was built to protect. The rule that
 * matters - a draft is editable, a posted entry is not - lives in
 * `updateJournalEntry`, which is the only door a person's edit reaches.
 */
export const JOURNAL_ENTRY_HOOKS: SystemHookRegistry = {
  journal_entry_number: [autoGenerateJournalEntryNumber],
}
