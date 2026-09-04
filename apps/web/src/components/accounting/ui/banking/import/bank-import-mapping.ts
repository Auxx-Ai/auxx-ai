// apps/web/src/components/accounting/ui/banking/import/bank-import-mapping.ts

/**
 * The column mapping a statement import needs, and the two ways it is arrived
 * at (HANDOFF slot 3D, plans/accounting/ui-plan.md §2.9).
 *
 * 🛑 **Applying a mapping is N calls to `dataImport.saveColumnMapping`** - the
 * same procedure the wizard's own mapping step calls, not a second write path.
 * There is one authority for what a job's mapping is; everything here is a
 * prefill of it.
 */

import { OFX_COLUMNS } from '@auxx/lib/import/client'

/** One column's target, as both the OFX preset and a saved mapping express it. */
export interface BankColumnMapping {
  columnIndex: number
  /** A `bank_transaction` field key, or null to skip the column. */
  targetFieldKey: string | null
  resolutionType: string
  /** True when the column is (part of) the job's match key. */
  isIdentifier: boolean
}

/**
 * The four `bank_transaction` targets a statement row has, as the importer
 * names them.
 *
 * 🛑 **A mapping's `targetFieldKey` is the field's SYSTEM ATTRIBUTE, not the key
 * the registry file declares it under.** `getFieldOutputKey` answers
 * `field.systemAttribute ?? field.key`, so the wizard's own picker stores
 * `bank_transaction_amount`, and that is what the writer resolves a column
 * through. Saving `amountMinor` instead persists happily, plans happily, renders
 * a correct-looking preview - and then imports six records carrying nothing but
 * their defaults, with no error anywhere. That is exactly what the first browser
 * pass of this slot produced.
 */
export const BANK_TRANSACTION_TARGETS = {
  externalId: 'bank_transaction_external_id',
  postedAt: 'bank_transaction_posted_at',
  amountMinor: 'bank_transaction_amount',
  description: 'bank_transaction_description',
} as const

/**
 * The mapping for an OFX file, which is fixed because the format is.
 *
 * ⚠️ **The id column is `text:value`, NOT `text:cuid`.** Auto-map's
 * `suggestResolutionType` sends any field whose key contains `externalid` to
 * `text:cuid`, whose resolver refuses anything that is not a 24-32 character
 * lowercase cuid2 - which is every `FITID` any bank has ever emitted
 * (`202601150001`, `WF-0001`). Left to auto-map, every row of every statement
 * would fail on its identifier column.
 *
 * ⚠️ **`amountMinor` is `number:integer`, not `currency:major`.** The OFX parser
 * has already turned the decimal string into signed minor units without going
 * through a float, and re-parsing it as major units would both double the
 * conversion and multiply by a hundred.
 *
 * The three columns the record has no home for - `NAME`, `MEMO` and `TRNTYPE` -
 * are explicitly SKIPPED rather than left to auto-map. `NAME` would otherwise be
 * mapped to the description field and then collide with the joined `DESCRIPTION` column,
 * which `assertNoDuplicateTargetMapping` refuses by name.
 */
export const OFX_COLUMN_MAPPING: BankColumnMapping[] = OFX_COLUMNS.map((name, columnIndex) => {
  switch (name) {
    case 'FITID':
      return {
        columnIndex,
        targetFieldKey: BANK_TRANSACTION_TARGETS.externalId,
        resolutionType: 'text:value',
        isIdentifier: true,
      }
    case 'DTPOSTED':
      return {
        columnIndex,
        targetFieldKey: BANK_TRANSACTION_TARGETS.postedAt,
        resolutionType: 'date:iso',
        isIdentifier: false,
      }
    case 'TRNAMT':
      return {
        columnIndex,
        targetFieldKey: BANK_TRANSACTION_TARGETS.amountMinor,
        resolutionType: 'number:integer',
        isIdentifier: false,
      }
    case 'DESCRIPTION':
      return {
        columnIndex,
        targetFieldKey: BANK_TRANSACTION_TARGETS.description,
        resolutionType: 'text:value',
        isIdentifier: false,
      }
    default:
      return {
        columnIndex,
        targetFieldKey: null,
        resolutionType: 'text:value',
        isIdentifier: false,
      }
  }
})

/**
 * Order the calls so the skips land first.
 *
 * 🛑 Load-bearing. `finalizeUpload` runs a fallback auto-map, so by the time
 * this replays a mapping some columns already have targets - and
 * `assertNoDuplicateTargetMapping` refuses a second column pointed at a field
 * another column still holds. Unmapping first is what makes the replay
 * order-independent from whatever auto-map guessed.
 */
export function orderedForApply(columns: readonly BankColumnMapping[]): BankColumnMapping[] {
  return [...columns].sort((a, b) => {
    const left = a.targetFieldKey ? 1 : 0
    const right = b.targetFieldKey ? 1 : 0
    return left - right
  })
}
