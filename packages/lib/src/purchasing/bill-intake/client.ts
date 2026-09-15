// packages/lib/src/purchasing/bill-intake/client.ts

// The bill-intake contract: every type that crosses between the transcriber,
// the matcher, the run store, the job, the router, the dialog and the bill page
// lives here (plans/money/tasks/58-vendor-bill-from-the-invoice.md).
//
// No `'use client'` directive: server code imports this file too, and the
// directive would turn every export into a client-reference proxy there
// (docs/lib-module-guide.md §7). Nothing in here touches the database, Redis,
// the orchestrator or the storage layer, and nothing may be added that does.

import type { RecordId } from '@auxx/types/resource'
import type { IntakeCandidate, IntakeTier } from '../intake/client'
import type { MatchTolerance } from '../types'

// ── What the model transcribes (§2.2) ────────────────────────────────────────

/**
 * One line of the vendor's invoice, as printed.
 *
 * Every money field is the vendor's own STRING. The conversion to minor units
 * happens once, deterministically, through `parseIntakeMoney` and friends in
 * `intake/client.ts`; nothing here is ever computed.
 */
export interface TranscribedInvoiceLine {
  lineNumber: number | null
  /** The vendor's own code for this line, as printed. The matcher's strongest input. */
  vendorCode: string | null
  /** The BUYER's part number when the invoice prints one ("Cust P/N", "Your ref"). */
  customerCode: string | null
  description: string | null
  quantity: number | null
  unit: string | null
  unitPriceText: string | null
  lineTotalText: string | null
}

/** The vendor's invoice as printed, and nothing else. */
export interface TranscribedInvoice {
  vendorName: string | null
  vendorEmail: string | null
  vendorAddress: string | null
  /** The vendor's own invoice number. Required for a bill to be created (§4.4). */
  invoiceNumber: string | null
  /** ISO date as printed, or the raw string when it will not parse. */
  invoiceDate: string | null
  dueDate: string | null
  paymentTerms: string | null
  /** The buyer's purchase order number as printed on the invoice (§4.1 step 3, §4.2). */
  purchaseOrderReference: string | null
  /** ISO 4217, uppercased. `null` when the document names no currency. */
  currency: string | null
  subtotalText: string | null
  shippingText: string | null
  taxText: string | null
  /** The vendor's printed total, never a sum of the lines (HANDOFF rule 4). */
  totalText: string | null
  lines: TranscribedInvoiceLine[]
}

// ── What the matcher is fed and what it decides (§3) ─────────────────────────

/**
 * One bill line as the matcher sees it. Built from the transcription at read
 * time and from the STORED line on demand (§3.5), so both doors run the same
 * assignment.
 */
export interface BillLineFacts {
  /** Stable key for the proposal: the transcription index at read time, the line record id on demand. */
  lineId: string
  vendorCode: string | null
  customerCode: string | null
  description: string | null
  quantity: number | null
  /** Integer minor units at rate precision, or `null` when the line prints no usable price. */
  unitPriceCents: number | null
}

/** One purchase order line as the matcher sees it (§3.5's loader). */
export interface OrderLineFacts {
  orderLineRecordId: RecordId
  partRecordId: RecordId | null
  partSku: string | null
  partTitle: string | null
  /** The `vendor_part.vendorSku` for this line's part and vendor, when one exists. */
  vendorSku: string | null
  description: string | null
  ordered: number
  received: number
  billed: number
  /** Integer minor units at rate precision. */
  expectedUnitPriceCents: number | null
  sortOrder: number | null
}

/**
 * What an unlinked line looks like, for the page's wording only. `charge` is a
 * keyword hit on the description (freight, surcharge, tax, tooling...); it
 * decides nothing (§3.3 rule 4).
 */
export type LineProposalHint = 'goods' | 'charge'

/** One order line the matcher offers for a printed line, best first. */
export interface LineProposalCandidate {
  orderLineRecordId: RecordId
  partRecordId: RecordId | null
  /** Part title, else the order line's description, else "Untitled line". */
  label: string
  tier: IntakeTier
  /** Human reasons, e.g. "vendor code matches", "qty 500 = ordered", "price within tolerance". */
  reasons: string[]
  /** Higher is better; comparable only within one assignment run. */
  score: number
}

/** The matcher's answer for one bill line. */
export interface LineProposal {
  lineId: string
  /** The tier of the best candidate, or `none`. */
  tier: IntakeTier
  candidates: LineProposalCandidate[]
  /** Set only on an auto-link tier (`isAutoLinkTier`); `fuzzy` never links. */
  linkedOrderLineRecordId: RecordId | null
  hint: LineProposalHint
}

/** Knobs the drive can move without a code change to the ladder (§12 item 3). */
export interface AssignOptions {
  /** Dice similarity on folded description tokens at or above this earns `fuzzy`. Default 0.5. */
  descriptionThreshold?: number
  /** Price corroboration window. Default `DEFAULT_MATCH_TOLERANCE`. */
  tolerance?: MatchTolerance
}

/** "6 of 8 linked, 2 need a person" for the banner and the reading page. */
export function proposalSummary(proposals: readonly LineProposal[]): {
  total: number
  linked: number
  needsPerson: number
} {
  const linked = proposals.filter((proposal) => proposal.linkedOrderLineRecordId !== null).length
  return { total: proposals.length, linked, needsPerson: proposals.length - linked }
}

// ── The run (§4.3) ───────────────────────────────────────────────────────────

export const BILL_INTAKE_STATUSES = ['reading', 'needs_vendor', 'created', 'failed'] as const
export type BillIntakeStatus = (typeof BILL_INTAKE_STATUSES)[number]

export const BILL_INTAKE_PHASES = ['document', 'vendor', 'lines', 'bill'] as const
export type BillIntakePhase = (typeof BILL_INTAKE_PHASES)[number]

export const BILL_INTAKE_PHASE_LABELS: Record<BillIntakePhase, string> = {
  document: 'Reading the invoice',
  vendor: 'Finding the vendor',
  lines: 'Matching lines to the order',
  bill: 'Creating the bill',
}

export type BillIntakeWarningCode =
  | 'vendor_from_invoice'
  | 'order_from_invoice'
  | 'po_reference_mismatch'
  | 'currency_mismatch'
  | 'grni_unresolved'
  | 'quantity_unread'
  | 'no_lines'

/** Something the read decided or could not decide, named on the page's banner (§4.2). */
export interface BillIntakeWarning {
  code: BillIntakeWarningCode
  message: string
}

/** What the router hands the dialog and the page. Never the stored shape. */
export interface BillIntakeRunView {
  id: string
  status: BillIntakeStatus
  phase: BillIntakePhase | null
  assetRef: string
  fileName: string | null
  mimeType: string | null
  /** From the picker, or resolved in the `vendor` phase. */
  vendorRecordId: RecordId | null
  /** What the reading page offers on `needs_vendor`. */
  vendorCandidates: IntakeCandidate[]
  /** From the picker, or found from the printed reference in the `lines` phase. */
  purchaseOrderRecordId: RecordId | null
  transcription: TranscribedInvoice | null
  /** The converted text the model read, for spreadsheets. `null` for a PDF or an image. */
  extractedText: string | null
  /** Index-aligned with `transcription.lines`. */
  proposals: LineProposal[] | null
  warnings: BillIntakeWarning[]
  vendorBillInstanceId: string | null
  vendorBillRecordId: RecordId | null
  /** Index-aligned with `proposals`, once the bill exists. */
  vendorBillLineRecordIds: RecordId[]
  /** The duplicate refusal's pointer (§4.2). */
  existingBillRecordId: RecordId | null
  error: string | null
  createdAt: string
}

/** A `fold` of freight into the header is a person's move (§3.6, §6.5); these are its targets. */
export type BillIntakeFold = 'shipping' | 'tax'
