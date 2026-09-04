// packages/lib/src/banking/import/header-signature.ts

import { createHash } from 'node:crypto'

/**
 * A stable fingerprint of a file's header row.
 *
 * 🛑 **Detect the bank by header signature, never by filename**
 * (plans/bank-connection/05-file-import.md §4). A customer renames a download,
 * a browser appends ` (3)`, and two different banks both call it
 * `statement.csv` - the columns are the only thing that actually identifies the
 * export.
 *
 * This is what replaces the plan's per-bank `BankCsvProfile`
 * (plans/accounting/implementation-review.md finding 10, ui-plan §2.9): a
 * complete generic importer already exists, so a "profile" is just the column
 * mapping the user already made, remembered against the signature of the header
 * row it was made for. Shipping profiles for two banks would serve two banks; a
 * saved mapping per signature serves the long tail from the first upload.
 *
 * ## What is normalised away, and why
 *
 * The signature must survive the cosmetic differences between two downloads of
 * the SAME export and nothing else:
 *
 * - **case and surrounding whitespace** - `Amount` vs `AMOUNT ` vs ` amount`
 * - **repeated internal whitespace** - `Running  Balance`
 * - **a UTF-8 BOM** on the first cell, which Excel writes and nothing shows
 * - **quotes and punctuation noise** - `"Date"` vs `Date`
 *
 * ⚠️ **Order is NOT normalised.** Two files with the same column names in a
 * different order need different mappings, because the mapping is stored per
 * column INDEX. Sorting the names here would prefill the wrong targets and, on a
 * money column, silently import a running balance as an amount.
 *
 * ⚠️ **Empty and duplicate names are kept.** A trailing empty header is a real
 * column in the file, and dropping it here would shift every index after it.
 */
export function headerSignature(headers: readonly string[]): string {
  // A newline between cells: `normaliseHeader` can only emit [a-z0-9 ], so a bare
  // join would make ['ab','c'] and ['a','bc'] the same signature.
  const normalised = headers.map(normaliseHeader).join('\n')
  return createHash('sha256').update(normalised).digest('hex').slice(0, 32)
}

/** The normalised form of one header cell. Exported for the signature's tests. */
export function normaliseHeader(header: string | null | undefined): string {
  return String(header ?? '')
    .replace(/^\ufeff/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
