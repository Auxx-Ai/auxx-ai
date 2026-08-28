// packages/lib/src/records/record-numbering.ts

import { database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { NotFoundError } from '../errors'

/** Which record kind a `RecordSequence` row counts. */
export type SequenceScope =
  | 'ticket'
  | 'work_order'
  | 'service_request'
  | 'quote'
  | 'invoice'
  | 'order'
  | 'purchase_order'
  | 'vendor_bill'
  | 'build'

const SCOPE_DEFAULTS: Record<SequenceScope, { prefix: string }> = {
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
    scope: SequenceScope
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
