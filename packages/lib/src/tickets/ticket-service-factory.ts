// packages/lib/src/tickets/ticket-service-factory.ts

import { database as db } from '@auxx/database'
import { TicketService } from './ticket-service'

/**
 * Factory function to create a TicketService instance with the database
 */
export function createTicketService() {
  return new TicketService(db)
}

/**
 * Singleton instance of TicketService for convenience
 */
export const ticketService = createTicketService()
