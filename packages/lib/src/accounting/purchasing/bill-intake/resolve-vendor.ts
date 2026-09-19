// packages/lib/src/accounting/purchasing/bill-intake/resolve-vendor.ts

/**
 * Step 2 (plans/money/tasks/58 §4.1 step 2): the vendor block on the invoice,
 * resolved against the org's own `company` rows.
 *
 * 🛑 Reuses `resolveQuoteVendor` (`intake/resolve.ts`) as-is rather than
 * cloning it — it already reads `vendorName` and `vendorEmail` off whatever
 * transcription it is handed, and the invoice schema carries both under the
 * same names. This file adds only the auto-continue rule, which the quote
 * intake does not have: a quote hands its candidates to a person on the
 * review screen (38 §5.1), and there is no review screen here before the bill
 * is created (§4.1).
 *
 * ⚠️ The auto-continue rule is strict on purpose, and stricter than the
 * quote's own tier: the only vendor this job may proceed with unasked is one
 * whose printed name IS the company's stored name, folded. A `contains` hit
 * or an email-domain hit is a candidate to show on `needs_vendor`, never a
 * vendor to bill.
 *
 * No permission checks. The router asserts and calls in.
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import type { IntakeCandidate, TranscribedQuote } from '../intake/client'
import { resolveQuoteVendor } from '../intake/resolve'
import type { TranscribedInvoice } from './client'

/** What the vendor step decided (§4.1 step 2). */
export interface InvoiceVendorResolution {
  /** Set only on a single, exact (folded) name match. `null` otherwise. */
  vendorRecordId: IntakeCandidate['recordId'] | null
  /** Best-first, for the `needs_vendor` picker when `vendorRecordId` is `null`. */
  candidates: IntakeCandidate[]
}

/**
 * Common legal-entity suffixes, folded away before comparing, so "Acme Ltd"
 * and "ACME Limited" are the same company name. Checked against the LAST word
 * only, and only when at least one word would remain — a company actually
 * named "Co" is not reduced to nothing.
 */
const COMPANY_SUFFIXES = new Set(['ltd', 'llc', 'inc', 'gmbh', 'co', 'corp', 'limited', 'company'])

/**
 * Lowercase, trim, drop punctuation, drop one trailing legal-entity suffix
 * word, then collapse what remains. Two names fold to the same key only when
 * they are the same company name modulo case, punctuation and a suffix — an
 * `ilike`-contains hit ("Acme Industrial" against printed "Acme") folds to a
 * different key and correctly does not match.
 */
function foldCompanyKey(value: string | null | undefined): string | null {
  if (!value) return null
  const words = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return null

  const last = words[words.length - 1]
  const withoutSuffix =
    words.length > 1 && last && COMPANY_SUFFIXES.has(last) ? words.slice(0, -1) : words

  const key = withoutSuffix.join('')
  return key || null
}

/**
 * Resolve the invoice's printed vendor against the org's `company` rows.
 *
 * `vendorRecordId` is set only when EXACTLY ONE candidate's folded name equals
 * the folded printed name. Anything else — zero hits, several exact hits, or
 * only a contains/domain hit — leaves it `null` with the candidates attached,
 * for the run to park in `needs_vendor` (§4.1 step 2, §4.2).
 */
export async function resolveInvoiceVendor(
  db: Database,
  organizationId: string,
  transcription: Pick<TranscribedInvoice, 'vendorName' | 'vendorEmail'>
): Promise<Result<InvoiceVendorResolution, Error>> {
  const quoteShaped: TranscribedQuote = {
    vendorName: transcription.vendorName,
    vendorEmail: transcription.vendorEmail,
    vendorPhone: null,
    vendorAddress: null,
    quoteNumber: null,
    quoteDate: null,
    validUntil: null,
    currency: null,
    subtotalText: null,
    shippingText: null,
    taxText: null,
    totalText: null,
    lines: [],
  }

  const resolved = await resolveQuoteVendor(db, organizationId, quoteShaped)
  if (resolved.isErr()) return err(resolved.error)

  const candidates = resolved.value
  const printedKey = foldCompanyKey(transcription.vendorName)
  const exactHits = printedKey
    ? candidates.filter((candidate) => foldCompanyKey(candidate.displayName) === printedKey)
    : []

  return ok({
    vendorRecordId: exactHits.length === 1 && exactHits[0] ? exactHits[0].recordId : null,
    candidates,
  })
}
