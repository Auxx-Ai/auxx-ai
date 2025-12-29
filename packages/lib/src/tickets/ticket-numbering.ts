// src/lib/tickets/ticket-numbering.ts
import { TicketSequenceModel } from '@auxx/database/models'
type TicketNumberReturn = { ticketNumber: string; sequenceNumber: number }
/**
 * Service for merging multiple tickets into a single primary ticket
 */
export const ticketNumbering = {
  /**
   * Update number
   *
   * @param organizationId - The ID of the ticket that will remain after merging
   * @returns { ticketNumber, sequenceNumber }
   */
  async create(organizationId: string): Promise<TicketNumberReturn> {
    const model = new TicketSequenceModel(organizationId)
    const res = await model.nextNumber()
    if (!res.ok) throw res.error
    const { ticketNumber, sequenceNumber } = res.value
    return { ticketNumber, sequenceNumber }
  },
}
