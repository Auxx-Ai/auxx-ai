// src/lib/tickets/ticket-numbering.ts
import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

type TicketNumberReturn = { ticketNumber: string; sequenceNumber: number }

/** Format a ticket number from a sequence record */
function formatTicketNumber(seq: typeof schema.TicketSequence.$inferSelect): string {
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
 * Service for generating sequential ticket numbers
 */
export const ticketNumbering = {
  /**
   * Generate the next ticket number for an organization
   *
   * @param organizationId - The organization to generate a number for
   * @returns { ticketNumber, sequenceNumber }
   */
  async create(organizationId: string): Promise<TicketNumberReturn> {
    // Ensure a sequence row exists for the org
    const [existing] = await database
      .select()
      .from(schema.TicketSequence)
      .where(eq(schema.TicketSequence.organizationId, organizationId))
      .limit(1)

    let seqId: string
    if (!existing) {
      const [created] = await database
        .insert(schema.TicketSequence)
        .values({
          organizationId,
          currentNumber: 0,
          paddingLength: 4,
          usePrefix: true,
          updatedAt: new Date(),
        })
        .returning()
      seqId = created.id
    } else {
      seqId = existing.id
    }

    // Increment the counter
    const currentNumber = (existing?.currentNumber ?? 0) + 1
    const [updated] = await database
      .update(schema.TicketSequence)
      .set({ currentNumber, updatedAt: new Date() })
      .where(eq(schema.TicketSequence.id, seqId))
      .returning()

    const ticketNumber = formatTicketNumber(updated)
    return { ticketNumber, sequenceNumber: updated.currentNumber }
  },
}
