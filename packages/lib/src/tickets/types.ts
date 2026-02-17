// packages/lib/src/tickets/types.ts

/**
 * Interface for Missing Item Case type-specific data
 */
export interface MissingItemCaseData {
  orderId?: string
  orderDate?: Date
  missingItems: Array<{
    name: string
    quantity: number
    sku?: string
  }>
  replacementSent?: boolean
}

/**
 * Interface for Shipping Issue Case type-specific data
 */
export interface ShippingIssueCaseData {
  orderId?: string
  orderDate?: Date
  trackingNumber?: string
  carrier?: string
  issue: string
}

/**
 * Interface for Refund Case type-specific data
 */
export interface RefundCaseData {
  orderId?: string
  orderDate?: Date
  refundAmount?: number
  refundReason: string
  refundStatus?: 'PENDING' | 'APPROVED' | 'PROCESSED' | 'REJECTED'
}

/**
 * Interface for Return Case type-specific data
 */
export interface ReturnCaseData {
  orderId?: string
  orderDate?: Date
  returnItems: Array<{
    name: string
    quantity: number
    sku?: string
    reason?: string
  }>
  returnReason?: string
  returnStatus?:
    | 'REQUESTED'
    | 'APPROVED'
    | 'RETURN_LABEL_SENT'
    | 'IN_TRANSIT'
    | 'RECEIVED'
    | 'COMPLETED'
    | 'REJECTED'
  returnLabelSent?: boolean
  returnTrackingNumber?: string
}

/**
 * Interface for Product Issue Case type-specific data
 */
export interface ProductIssueCaseData {
  productId?: string
  purchaseDate?: Date
  orderId?: string
  issueDescription?: string
  productImages?: string[]
}

/**
 * Interface for Billing Case type-specific data
 */
export interface BillingCaseData {
  invoiceId?: string
  invoiceDate?: Date
  billingIssue: string
  amountDisputed?: number
}

/**
 * Interface for Technical Case type-specific data
 */
export interface TechnicalCaseData {
  deviceInfo?: string
  browserInfo?: string
  errorMessage?: string
  stepsToReproduce?: string
}

/**
 * Union type for all type-specific data
 */
export type TicketTypeData =
  | MissingItemCaseData
  | ShippingIssueCaseData
  | RefundCaseData
  | ReturnCaseData
  | ProductIssueCaseData
  | BillingCaseData
  | TechnicalCaseData
  | Record<string, never> // For GENERAL tickets

/**
 * Helper type for ticket with typed data.
 * Since the Ticket table is dropped, tickets are now EntityInstance records.
 * This type represents any ticket entity instance with typeData.
 */
export interface TicketWithTypeData {
  id: string
  typeData: TicketTypeData
  [key: string]: unknown
}
