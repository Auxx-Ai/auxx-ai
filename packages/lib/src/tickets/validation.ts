// packages/lib/src/tickets/validation.ts
import { z } from 'zod'
import { TicketType } from '@auxx/database/enums'
/**
 * Validation schema for Missing Item Case data
 */
export const missingItemCaseSchema = z.object({
  orderId: z.string().optional(),
  orderDate: z.date().optional(),
  missingItems: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().positive(),
      sku: z.string().optional(),
    })
  ),
  replacementSent: z.boolean().optional(),
})
/**
 * Validation schema for Shipping Issue Case data
 */
export const shippingIssueCaseSchema = z.object({
  orderId: z.string().optional(),
  orderDate: z.date().optional(),
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  issue: z.string(),
})
/**
 * Validation schema for Refund Case data
 */
export const refundCaseSchema = z.object({
  orderId: z.string().optional(),
  orderDate: z.date().optional(),
  refundAmount: z.number().positive().optional(),
  refundReason: z.string(),
  refundStatus: z.enum(['PENDING', 'APPROVED', 'PROCESSED', 'REJECTED']).optional(),
})
/**
 * Validation schema for Return Case data
 */
export const returnCaseSchema = z.object({
  orderId: z.string().optional(),
  orderDate: z.date().optional(),
  returnItems: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().positive(),
      sku: z.string().optional(),
      reason: z.string().optional(),
    })
  ),
  returnReason: z.string().optional(),
  returnStatus: z
    .enum([
      'REQUESTED',
      'APPROVED',
      'RETURN_LABEL_SENT',
      'IN_TRANSIT',
      'RECEIVED',
      'COMPLETED',
      'REJECTED',
    ])
    .optional(),
  returnLabelSent: z.boolean().optional(),
  returnTrackingNumber: z.string().optional(),
})
/**
 * Validation schema for Product Issue Case data
 */
export const productIssueCaseSchema = z.object({
  productId: z.string().optional(),
  purchaseDate: z.date().optional(),
  orderId: z.string().optional(),
  issueDescription: z.string().optional(),
  productImages: z.array(z.string()).optional(),
})
/**
 * Validation schema for Billing Case data
 */
export const billingCaseSchema = z.object({
  invoiceId: z.string().optional(),
  invoiceDate: z.date().optional(),
  billingIssue: z.string(),
  amountDisputed: z.number().positive().optional(),
})
/**
 * Validation schema for Technical Case data
 */
export const technicalCaseSchema = z.object({
  deviceInfo: z.string().optional(),
  browserInfo: z.string().optional(),
  errorMessage: z.string().optional(),
  stepsToReproduce: z.string().optional(),
})
/**
 * Validates type-specific data based on ticket type
 * @param type - The ticket type
 * @param data - The data to validate
 * @returns Validated data object
 * @throws ZodError if validation fails
 */
export const validateTicketTypeData = (type: TicketType, data: unknown) => {
  switch (type) {
    case TicketType.MISSING_ITEM:
      return missingItemCaseSchema.parse(data)
    case TicketType.SHIPPING_ISSUE:
      return shippingIssueCaseSchema.parse(data)
    case TicketType.REFUND:
      return refundCaseSchema.parse(data)
    case TicketType.RETURN:
      return returnCaseSchema.parse(data)
    case TicketType.PRODUCT_ISSUE:
      return productIssueCaseSchema.parse(data)
    case TicketType.BILLING:
      return billingCaseSchema.parse(data)
    case TicketType.TECHNICAL:
      return technicalCaseSchema.parse(data)
    case TicketType.GENERAL:
    case TicketType.OTHER:
    default:
      return {}
  }
}
