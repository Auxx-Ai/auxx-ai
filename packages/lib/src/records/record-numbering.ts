// packages/lib/src/records/record-numbering.ts

import { database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { NotFoundError } from '../errors'

/**
 * Which record kinds a `RecordSequence` row can count.
 *
 * A VALUE and not a bare type union, so the tRPC scope enum in
 * `routers/ticketSequence.ts` can be derived from it. It used to be a type
 * only, and the router re-typed the same nine strings by hand - which meant
 * every scope added here (`bank_deposit`, `journal_entry`) broke the router's
 * typecheck until somebody edited the second copy too. One list.
 */
export const SEQUENCE_SCOPES = [
  'ticket',
  'work_order',
  'service_request',
  'quote',
  'invoice',
  'order',
  'purchase_order',
  'vendor_bill',
  'build',
  'bank_deposit',
  'journal_entry',
  'payout',
  'credit_memo',
  'return',
] as const

/**
 * Counters that are NOT record kinds, and must never reach the settings UI.
 *
 * 🛑 **Deliberately kept out of {@link SEQUENCE_SCOPES}**, because that list is
 * what `routers/ticketSequence.ts` derives its scope enum from, and that router
 * exposes `resetCounter` on a bare `protectedProcedure` with no permission
 * assert. For `ticket` or `invoice` a reset means a duplicate document number,
 * which is cosmetic. For `build_batch` it means two batch runs SHARE A NUMBER,
 * and `undoBatchRun(N)` then reverses completed production from a run nobody
 * asked to undo, writing to the ledger (plans/money/tasks/45 §10.3).
 *
 * `recordNumbering.create` accepts these; nothing else does. There is no
 * configure, no reset and no UI.
 */
export const INTERNAL_SEQUENCE_SCOPES = ['build_batch'] as const

/** Which record kind a `RecordSequence` row counts. Configurable by a user. */
export type SequenceScope = (typeof SEQUENCE_SCOPES)[number]

/** A counter that is not a record kind. Backend-allocated only. */
export type InternalSequenceScope = (typeof INTERNAL_SEQUENCE_SCOPES)[number]

/** Anything `recordNumbering.create` will count. */
export type AnySequenceScope = SequenceScope | InternalSequenceScope

const SCOPE_DEFAULTS: Record<AnySequenceScope, { prefix: string }> = {
  // `RMA-0001`. The industry term, and the one the warehouse already says out
  // loud on the phone, so it is what a customer sees on a return label.
  return: { prefix: 'RMA' },
  ticket: { prefix: 'TKT' },
  work_order: { prefix: 'WO' },
  service_request: { prefix: 'REQ' },
  quote: { prefix: 'QUO' },
  invoice: { prefix: 'INV' },
  order: { prefix: 'ORD' },
  purchase_order: { prefix: 'PO' },
  // Ours, beside the vendor's own invoice number - two different documents.
  vendor_bill: { prefix: 'BILL' },
  // One letter, unlike every other scope here: the build plan fixes the format at
  // `B-0001` (plans/products/build/01-build-plan.md section 1.1). Anything longer
  // starting with a B would read as the vendor bill's `BILL-0001` at a glance, and
  // these two numbers sit side by side on the same cost trail.
  build: { prefix: 'B' },
  // `DEP-0001`. The posting's document number keys on this string
  // (`postings/doc-number.ts`), so it must stay short: `AUXX-DEP-DEP0001` is 16
  // of the 21 characters the cap allows.
  bank_deposit: { prefix: 'DEP' },
  // `JNL-0001`, matching `DOC_NUMBER_PREFIX.manual_journal`. The number IS the
  // posting's `periodKey`, so it must stay short for the same reason:
  // `AUXX-JNL-JNL0001` is 16 of the 21 characters the cap allows.
  journal_entry: { prefix: 'JNL' },
  // `PAY-0001`, matching `DOC_NUMBER_PREFIX.payout`. Same constraint again: the
  // number IS the posting's `periodKey`, and a Stripe `po_…` id is 27 characters
  // against a 21-character cap. `AUXX-PAY-PAY0001` is 16.
  payout: { prefix: 'PAY' },
  // `CM-0001`. The issue entry keys its document number on this string too
  // (`postings/build-credit-memo-entry.ts`), so it stays short for the same
  // reason the three above do (plans/accounting/tasks/10 section 2.1).
  credit_memo: { prefix: 'CM' },
  // The batch run counter (plans/money/tasks/45 §3.2). The prefix is COSMETIC
  // here and nothing renders it: the run number is consumed as the raw
  // `sequenceNumber` integer, because `build_batch_run` is an integer field.
  // `BR` all the same, so a row somebody stumbles over in the table is legible
  // and collides with neither `B` (build) nor `BILL` (vendor bill).
  build_batch: { prefix: 'BR' },
}

/** Format a record number from a sequence record */
function formatRecordNumber(seq: typeof schema.RecordSequence.$inferSelect): string {
  const numericPart = String(seq.currentNumber).padStart(seq.paddingLength ?? 4, '0')
  const parts: string[] = []

  if (seq.usePrefix) {
    let prefixPart = seq.prefix || ''
    if (seq.useDateInPrefix) {
      const now = new Date()
      const dateFormat = seq.dateFormat || 'YYMM'
      let datePart = ''
      switch (dateFormat) {
        case 'YYMM':
          datePart = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}`
          break
        case 'YYYYMM':
          datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`
          break
        case 'MMYY':
          datePart = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear().toString().slice(2)}`
          break
        case 'YY':
          datePart = now.getFullYear().toString().slice(2)
          break
        case 'MM':
          datePart = (now.getMonth() + 1).toString().padStart(2, '0')
          break
        default:
          datePart = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1).toString().padStart(2, '0')}`
      }
      prefixPart = prefixPart ? `${prefixPart}${datePart}` : datePart
    }
    if (prefixPart) parts.push(prefixPart)
  }

  parts.push(numericPart)

  if (seq.useSuffix && seq.suffix) parts.push(seq.suffix)

  const separator = seq.separator || ''
  return parts.join(separator)
}

/**
 * Service for generating sequential record numbers (tickets, work orders, service requests —
 * one `RecordSequence` counter per org+scope).
 */
export const recordNumbering = {
  /** Generate the next number for an org+scope. Atomic — safe under concurrent creates. */
  async create(
    organizationId: string,
    scope: AnySequenceScope
  ): Promise<{ recordNumber: string; sequenceNumber: number }> {
    // First use: seed the row. onConflictDoNothing keys on the (organizationId, scope) unique.
    await database
      .insert(schema.RecordSequence)
      .values({
        organizationId,
        scope,
        currentNumber: 0,
        prefix: SCOPE_DEFAULTS[scope].prefix,
        paddingLength: 4,
        usePrefix: true,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [schema.RecordSequence.organizationId, schema.RecordSequence.scope],
      })

    // THE RACE FIX: atomic increment + read-back in one statement. The old code
    // SELECTed, computed currentNumber+1 in JS, then UPDATEd — concurrent creates collided.
    const [updated] = await database
      .update(schema.RecordSequence)
      .set({
        currentNumber: sql`${schema.RecordSequence.currentNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.RecordSequence.organizationId, organizationId),
          eq(schema.RecordSequence.scope, scope)
        )
      )
      .returning()

    // The upsert above guarantees the row exists, so an empty RETURNING means the counter was
    // deleted between the two statements — surface it rather than crashing on `undefined`.
    if (!updated) {
      throw new NotFoundError(`Record sequence for scope "${scope}" is missing`)
    }

    return { recordNumber: formatRecordNumber(updated), sequenceNumber: updated.currentNumber }
  },
}
