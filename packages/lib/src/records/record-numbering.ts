// packages/lib/src/records/record-numbering.ts

import { type Database, database, type RecordSequenceEntity, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../errors'

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
  'vendor_credit',
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

/**
 * Scopes whose number a ledger posting copies verbatim as its document number
 * (plans/accounting/tasks/80 §4.1; the fulfillment and write-off key on the order
 * and invoice numbers). Two of these sharing a prefix in one org would collide on
 * `GlPosting_org_docNumber_key`, so {@link validateAccountingSequence} refuses it.
 */
export const ACCOUNTING_SEQUENCE_SCOPES = [
  'invoice',
  'order',
  'vendor_bill',
  'build',
  'bank_deposit',
  'journal_entry',
  'payout',
  'credit_memo',
  'vendor_credit',
] as const satisfies readonly SequenceScope[]

export type AccountingSequenceScope = (typeof ACCOUNTING_SEQUENCE_SCOPES)[number]

function isAccountingScope(scope: SequenceScope): scope is AccountingSequenceScope {
  return (ACCOUNTING_SEQUENCE_SCOPES as readonly string[]).includes(scope)
}

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
  // `DEP-0001`. The posting's document number IS this string
  // (`ledger/builders/doc-number.ts`), inside a 15-character budget.
  bank_deposit: { prefix: 'DEP' },
  // `JNL-0001`. The number IS the posting's `periodKey` and document number, so
  // it stays short for the same reason.
  journal_entry: { prefix: 'JNL' },
  // `PAY-0001`. Same constraint again: the number IS the posting's `periodKey`,
  // and a Stripe `po_…` id is 27 characters against a 15-character budget.
  payout: { prefix: 'PAY' },
  // `CM-0001`. The issue entry keys its document number on this string too
  // (`postings/build-credit-memo-entry.ts`), so it stays short for the same
  // reason the three above do (plans/accounting/tasks/10 section 2.1).
  credit_memo: { prefix: 'CM' },
  // `VC-0001`, the mirror of `CM`. The issue entry's `periodKey` IS this string
  // (never the supplier's own reference), so it stays short for the same reason.
  vendor_credit: { prefix: 'VC' },
  // The batch run counter (plans/money/tasks/45 §3.2). The prefix is COSMETIC
  // here and nothing renders it: the run number is consumed as the raw
  // `sequenceNumber` integer, because `build_batch_run` is an integer field.
  // `BR` all the same, so a row somebody stumbles over in the table is legible
  // and collides with neither `B` (build) nor `BILL` (vendor bill).
  build_batch: { prefix: 'BR' },
}

type SequenceFormat = Pick<
  RecordSequenceEntity,
  'prefix' | 'usePrefix' | 'separator' | 'suffix' | 'useSuffix'
>

/** The prefix as the generator renders it: empty when switched off or blank. */
function effectivePrefix(seq: Pick<SequenceFormat, 'prefix' | 'usePrefix'>): string {
  return seq.usePrefix ? seq.prefix || '' : ''
}

/** Format a record number from a sequence record */
function formatRecordNumber(seq: typeof schema.RecordSequence.$inferSelect): string {
  const numericPart = String(seq.currentNumber).padStart(seq.paddingLength ?? 4, '0')
  const parts: string[] = []

  if (seq.usePrefix) {
    let prefixPart = effectivePrefix(seq)
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
 * Refuses a sequence format that would make two ledger document numbers collide:
 * a prefix another accounting scope in the org already renders (a scope with no
 * row counts as its default), or a suffix ending in the `-R<n>`/`-G<n>` reversal
 * and repost markers. Non-accounting scopes pass; the caller asserts access.
 */
export async function validateAccountingSequence(
  db: Database,
  params: { organizationId: string; scope: SequenceScope; format: Partial<SequenceFormat> }
): Promise<Result<void, Error>> {
  const { organizationId, scope } = params
  if (!isAccountingScope(scope)) return ok(undefined)

  // Missing keys take the column defaults in schema/record-sequence.ts.
  const format: SequenceFormat = {
    prefix: null,
    usePrefix: true,
    separator: '-',
    suffix: null,
    useSuffix: false,
    ...params.format,
  }

  const tail = format.useSuffix && format.suffix ? `${format.separator}${format.suffix}` : ''
  if (/-[RG]\d+$/.test(tail)) {
    return err(
      new UnprocessableEntityError(
        `A number ending in "${tail}" would read as a ledger reversal or repost; choose another suffix`
      )
    )
  }

  const prefix = effectivePrefix(format)
  const rows = await db.query.RecordSequence.findMany({
    where: and(
      eq(schema.RecordSequence.organizationId, organizationId),
      inArray(schema.RecordSequence.scope, [...ACCOUNTING_SEQUENCE_SCOPES])
    ),
    columns: { scope: true, prefix: true, usePrefix: true },
  })
  const byScope = new Map(rows.map((row) => [row.scope, row]))

  for (const other of ACCOUNTING_SEQUENCE_SCOPES) {
    if (other === scope) continue
    const row = byScope.get(other)
    const otherPrefix = row ? effectivePrefix(row) : SCOPE_DEFAULTS[other].prefix
    if (otherPrefix === prefix) {
      return err(
        new UnprocessableEntityError(
          `Prefix "${prefix}" is already used by the ${other} sequence; ledger document numbers must not collide`
        )
      )
    }
  }

  return ok(undefined)
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
