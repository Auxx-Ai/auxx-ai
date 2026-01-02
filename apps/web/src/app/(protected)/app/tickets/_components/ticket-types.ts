// apps/web/src/app/(protected)/app/tickets/_components/ticket-types.ts

/**
 * Ticket type matching record store schema
 */
export interface Ticket {
  id: string
  number: string
  title: string
  subject?: string | null
  description?: string | null
  type: string
  status: string
  priority: string
  dueDate?: string | null
  createdAt: string
  updatedAt: string
  contact: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
  }
  assignments: Array<{
    id: string
    agent: {
      id: string
      name: string | null
      email: string
    }
  }>
}

/**
 * Filter state for tickets
 */
export interface TicketFilterState {
  status?: string
  type?: string
  priority?: string
  assignee?: string
  search?: string
}
