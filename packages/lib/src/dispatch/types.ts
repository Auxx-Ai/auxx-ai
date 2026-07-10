// packages/lib/src/dispatch/types.ts

/** Input for {@link createWorkOrderFromTicket} — the SECONDARY intake path (01 §8). */
export interface CreateFromTicketInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the source ticket (not the RecordId). */
  ticketInstanceId: string
}

/** Input for {@link convertRequestToWorkOrder} — the PRIMARY intake path (01 §8/§9). */
export interface ConvertRequestToWorkOrderInput {
  organizationId: string
  userId: string
  /** EntityInstance id of the source service request (not the RecordId). */
  requestInstanceId: string
}
