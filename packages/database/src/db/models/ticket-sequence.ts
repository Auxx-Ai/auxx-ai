// packages/database/src/db/models/ticket-sequence.ts
// TicketSequence model built on BaseModel (org-scoped)

import { TicketSequence } from '../schema/ticket-sequence'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected TicketSequence entity type */
export type TicketSequenceEntity = typeof TicketSequence.$inferSelect
/** Insertable TicketSequence input type */
export type CreateTicketSequenceInput = typeof TicketSequence.$inferInsert
/** Updatable TicketSequence input type */
export type UpdateTicketSequenceInput = Partial<CreateTicketSequenceInput>

/**
 * TicketSequenceModel encapsulates CRUD for the TicketSequence table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TicketSequenceModel extends BaseModel<
  typeof TicketSequence,
  CreateTicketSequenceInput,
  TicketSequenceEntity,
  UpdateTicketSequenceInput
> {
  /** Drizzle table */
  get table() {
    return TicketSequence
  }

  /** Ensure a sequence row exists for the current org; create with defaults if missing */
  private async ensureForOrg(): Promise<TypedResult<TicketSequenceEntity, Error>> {
    this.requireOrgIfScoped()
    const existing = await this.findFirst()
    if (!existing.ok) return Result.error(existing.error!)
    if (existing.value) return Result.ok(existing.value)
    return this.create({
      // organizationId auto-filled by BaseModel when scoped
      currentNumber: 0,
      paddingLength: 4,
      usePrefix: true,
    } as CreateTicketSequenceInput)
  }

  /** Increment and return formatted ticket number with current sequence number */
  async nextNumber(): Promise<
    TypedResult<
      { ticketNumber: string; sequenceNumber: number; sequence: TicketSequenceEntity },
      Error
    >
  > {
    const seqRes = await this.ensureForOrg()
    if (!seqRes.ok) return Result.error(seqRes.error!)
    const seq = seqRes.value!

    const updatedRes = await this.update(seq.id, { currentNumber: (seq.currentNumber ?? 0) + 1 })
    if (!updatedRes.ok) return Result.error(updatedRes.error!)
    const updated = updatedRes.value!

    const numericPart = String(updated.currentNumber).padStart(updated.paddingLength ?? 4, '0')
    const parts: string[] = []

    if (updated.usePrefix) {
      let prefixPart = updated.prefix || ''
      if (updated.useDateInPrefix) {
        const now = new Date()
        const dateFormat = updated.dateFormat || 'YYMM'
        let datePart = ''
        switch (dateFormat) {
          case 'YYMM':
            datePart = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1)
              .toString()
              .padStart(2, '0')}`
            break
          case 'YYYYMM':
            datePart = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`
            break
          case 'MMYY':
            datePart = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now
              .getFullYear()
              .toString()
              .slice(2)}`
            break
          case 'YY':
            datePart = now.getFullYear().toString().slice(2)
            break
          case 'MM':
            datePart = (now.getMonth() + 1).toString().padStart(2, '0')
            break
          default:
            datePart = `${now.getFullYear().toString().slice(2)}${(now.getMonth() + 1)
              .toString()
              .padStart(2, '0')}`
        }
        prefixPart = prefixPart ? `${prefixPart}${datePart}` : datePart
      }
      if (prefixPart) parts.push(prefixPart)
    }

    parts.push(numericPart)

    if (updated.useSuffix && updated.suffix) parts.push(updated.suffix)

    const separator = updated.separator || ''
    const ticketNumber = parts.join(separator)
    const sequenceNumber = updated.currentNumber
    return Result.ok({ ticketNumber, sequenceNumber, sequence: updated })
  }
}
