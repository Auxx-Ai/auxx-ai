import { z } from 'zod'

export enum SYNC_STATUS {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum PRODUDT_STATUS {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  DRAFT = 'DRAFT',
}
export enum INVENTORY_POLICY {
  CONTINUE = 'CONTINUE',
  DENY = 'DENY',
}

export enum MEDIA_CONTENT_TYPE {
  EXTERNAL_VIDEO = 'EXTERNAL_VIDEO',
  IMAGE = 'IMAGE',
  MODEL_3D = 'MODEL_3D',
  VIDEO = 'VIDEO',
}
export enum MEDIA_PREVIEW_STATUS {
  FAILED = 'FAILED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  UPLOADED = 'UPLOADED',
}

export enum CURRENCY_CODE {
  EUR = 'EUR',
  USD = 'USD',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
}

export enum FULFILLMENT_STATUS {
  CANCELLED = 'CANCELLED',
  ERROR = 'ERROR',
  FAILURE = 'FAILURE',
  SUCCESS = 'SUCCESS',
  OPEN = 'OPEN',
  PENDING = 'PENDING',
}

export enum COUNTRY_CODE {
  AU = 'AU',
  CA = 'CA',
  CN = 'CN',
  DE = 'DE',
  ES = 'ES',
  FR = 'FR',
  GB = 'GB',
  HK = 'HK',
  IE = 'IE',
  LT = 'LT',
  IN = 'IN',
  IT = 'IT',
  JP = 'JP',
  MX = 'MX',
  NO = 'NO',
  NZ = 'NZ',
  PL = 'PL',
  PT = 'PT',
  RO = 'RO',
  RU = 'RU',
  SG = 'SG',
  TR = 'TR',
  TW = 'TW',
  UA = 'UA',
  NL = 'NL',
  SE = 'SE',
  US = 'US',
}

export enum ORDER_RISK_LEVEL {
  HIGH = 'HIGH',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
}

export enum ORDER_RISK_RECOMMENDATION {
  ACCEPT = 'ACCEPT',
  CANCEL = 'CANCEL',
  INVESTIGATE = 'INVESTIGATE',
  NONE = 'NONE',
}

export enum RETURN_DECLINE_REASON {
  FINAL_SALE = 'FINAL_SALE',
  OTHER = 'OTHER',
  RETURN_PERIOD_ENDED = 'RETURN_PERIOD_ENDED',
}

export enum ORDER_RETURN_STATUS {
  INSPECTION_COMPLETED = 'INSPECTION_COMPLETED',
  IN_PROGRESS = 'IN_PROGRESS',
  NO_RETURN = 'NO_RETURN',
  RETURNED = 'RETURNED',
  RETURN_FAILED = 'RETURN_FAILED',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
}

export enum ORDER_ADDRESS_TYPE {
  BILLING = 'BILLING',
  SHIPPING = 'SHIPPING',
}

export enum ORDER_CANCEL_REASON {
  CUSTOMER = 'CUSTOMER',
  DECLINED = 'DECLINED',
  FRAUD = 'FRAUD',
  INVENTORY = 'INVENTORY',
  OTHER = 'OTHER',
  STAFF = 'STAFF',
}

export enum ORDER_FINANCIAL_STATUS {
  AUTHORIZED = 'AUTHORIZED',
  EXPIRED = 'EXPIRED',
  PAID = 'PAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
  VOIDED = 'VOIDED',
}

export enum ORDER_FULFILLMENT_STATUS {
  FULFILLED = 'FULFILLED',
  IN_PROGRESS = 'IN_PROGRESS',
  ON_HOLD = 'ON_HOLD',
  OPEN = 'OPEN',
  PARTIALLY_FULFILLED = 'PARTIALLY_FULFILLED',
  PENDING_FULFILLMENT = 'PENDING_FULFILLMENT',
  REQUEST_DECLINED = 'REQUEST_DECLINED',
  RESTOCKED = 'RESTOCKED',
  SCHEDULED = 'SCHEDULED',
  UNFULFILLED = 'UNFULFILLED',
}

export enum RETURN_STATUS {
  CANCELED = 'CANCELED',
  CLOSED = 'CLOSED',
  DECLINED = 'DECLINED',
  OPEN = 'OPEN',
  REQUESTED = 'REQUESTED',
}
export enum CUSTOMER_EMAIL_MARKETING_STATE {
  INVALID = 'INVALID',
  NOT_SUBSCRIBED = 'NOT_SUBSCRIBED',
  PENDING = 'PENDING',
  SUBSCRIBED = 'SUBSCRIBED',
  UNSUBSCRIBED = 'UNSUBSCRIBED',
}

// export enum DISPUTE_STATUS {
//   ACCEPTED = 'ACCEPTED',
//   LOST = 'LOST',
//   NEEDS_RESPONSE = 'NEEDS_RESPONSE',
//   UNDER_REVIEW = 'UNDER_REVIEW',
//   WON = 'WON',
// }

export enum DISPUTE_STATUS {
  ACCEPTED = 'ACCEPTED',
  LOST = 'LOST',
  NEEDS_RESPONSE = 'NEEDS_RESPONSE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  WON = 'WON',
  CHARGE_REFUNDED = 'CHARGE_REFUNDED',
}

export enum WEIGHT_UNIT {
  GRAMS = 'GRAMS',
  KILOGRAMS = 'KILOGRAMS',
  OUNCES = 'OUNCES',
  POUNDS = 'POUNDS',
}

export enum WEBHOOK_TOPIC {
  CARTS_CREATE = 'CARTS_CREATE',
  COLLECTIONS_CREATE = 'COLLECTIONS_CREATE',
  COLLECTIONS_DELETE = 'COLLECTIONS_DELETE',
  COLLECTIONS_UPDATE = 'COLLECTIONS_UPDATE',

  COMPANIES_CREATE = 'COMPANIES_CREATE',
  COMPANIES_DELETE = 'COMPANIES_DELETE',
  COMPANIES_UPDATE = 'COMPANIES_UPDATE',

  CUSTOMERS_CREATE = 'CUSTOMERS_CREATE',
  CUSTOMERS_DELETE = 'CUSTOMERS_DELETE',
  CUSTOMERS_DISABLE = 'CUSTOMERS_DISABLE',
  CUSTOMERS_ENABLE = 'CUSTOMERS_ENABLE',
  CUSTOMERS_UPDATE = 'CUSTOMERS_UPDATE',
  CUSTOMER_TAGS_ADDED = 'CUSTOMER_TAGS_ADDED',
  CUSTOMER_TAGS_REMOVED = 'CUSTOMER_TAGS_REMOVED',

  FULFILLMENTS_CREATE = 'FULFILLMENTS_CREATE',
  FULFILLMENTS_UPDATE = 'FULFILLMENTS_UPDATE',
  FULFILLMENT_EVENTS_CREATE = 'FULFILLMENT_EVENTS_CREATE',
  FULFILLMENT_EVENTS_DELETE = 'FULFILLMENT_EVENTS_DELETE',
  FULFILLMENT_ORDERS_PLACED_ON_HOLD = 'FULFILLMENT_ORDERS_PLACED_ON_HOLD',
  // FULFILLMENT_HOLDS_ADDED = 'FULFILLMENT_HOLDS_ADDED',
  // FULFILLMENT_HOLDS_RELEASED= 'FULFILLM
  ORDERS_CANCELLED = 'ORDERS_CANCELLED',
  ORDERS_CREATE = 'ORDERS_CREATE',
  ORDERS_DELETE = 'ORDERS_DELETE',
  ORDERS_EDITED = 'ORDERS_EDITED',
  ORDERS_FULFILLED = 'ORDERS_FULFILLED',
  ORDERS_PAID = 'ORDERS_PAID',
  ORDERS_PARTIALLY_FULFILLED = 'ORDERS_PARTIALLY_FULFILLED',
  ORDERS_UPDATED = 'ORDERS_UPDATED',

  PRODUCTS_CREATE = 'PRODUCTS_CREATE',
  PRODUCTS_DELETE = 'PRODUCTS_DELETE',
  PRODUCTS_UPDATE = 'PRODUCTS_UPDATE',

  REFUNDS_CREATE = 'REFUNDS_CREATE',
  RETURNS_APPROVE = 'RETURNS_APPROVE',
  RETURNS_CANCEL = 'RETURNS_CANCEL',
  RETURNS_CLOSE = 'RETURNS_CLOSE',
  RETURNS_DECLINE = 'RETURNS_DECLINE',
  RETURNS_REOPEN = 'RETURNS_REOPEN',
  RETURNS_REQUEST = 'RETURNS_REQUEST',
  RETURNS_UPDATE = 'RETURNS_UPDATE',
}

export const SHOPIFY_WEBHOOK_EVENTS = {
  'customers/create': WEBHOOK_TOPIC.CUSTOMERS_CREATE,
  'customers/update': WEBHOOK_TOPIC.CUSTOMERS_UPDATE,
  'products/create': WEBHOOK_TOPIC.PRODUCTS_CREATE,
  'products/update': WEBHOOK_TOPIC.PRODUCTS_UPDATE,
  'orders/create': WEBHOOK_TOPIC.ORDERS_CREATE,
  'orders/updated': WEBHOOK_TOPIC.ORDERS_UPDATED,
} as const
export type ShopifyWebhookEventKey = keyof typeof SHOPIFY_WEBHOOK_EVENTS
export type ShopifyWebhookEventValue = (typeof SHOPIFY_WEBHOOK_EVENTS)[ShopifyWebhookEventKey]

export enum WEBHOOK_FORMAT {
  JSON = 'JSON',
  XML = 'XML',
}

export interface webhookSubscriptionCreate {
  topic: WEBHOOK_TOPIC
  webhookSubscription: webhookSubscription
}

export interface webhookSubscription {
  callbackUrl: string
  filter?: string
  format: WEBHOOK_FORMAT
  includeFields: string[]
}

export interface webhookSubscriptionDelete {
  id: string
}

export interface ShopifyAddress {
  address1: string
  address2?: string
  city: string
  company?: string
  countryCodeV2: COUNTRY_CODE
  firstName: string
  lastName: string
  latitude?: number
  longitude?: number
  name?: string
  phone?: string
  provinceCode?: string
  zip: string
}

export interface ShopifyImage {
  id: string
  altText?: string
  url: string
  width?: number
  height?: number
}

export interface ShopifyMediaPreview {
  image: ShopifyImage
  // status: "FAILED"| "PROCESSING" |"READY"|"UPLOADED"
}

export interface ShopifyMedia {
  alt?: string
  mediaContentType: MEDIA_CONTENT_TYPE
  // preview:
}

export interface ShopifyProductVariant {
  availableForSale: boolean
  barcode?: string
  compareAtPrice?: string
  createdAt: string
  displayName: string
  id: string
  image?: ShopifyImage
  // inventoryItem: string
  inventoryManagement: string
  inventoryPolicy: INVENTORY_POLICY
  inventoryQuantity: number
  position: number
  price: string
  // requiresShipping: boolean
  sku?: string
  taxable: boolean
  title: string
  updatedAt: string
  weight?: number
  weightUnit?: WEIGHT_UNIT
}

export interface ShopifyProduct {
  createdAt: string
  updatedAt: string
  publishedAt: string
  description: string
  descriptionHtml: string
  handle: string
  hasOnlyDefaultVariant: boolean
  productType?: string
  status: PRODUDT_STATUS
  tags: string[]
  title: string
  totalInventory: number
  tracksInventory: boolean
  variants: ShopifyProductVariant[]
  vendor: string
}

export const productMediaSchema = z.object({
  id: z.number(),
  alt: z.string().optional().nullable(),
  mediaContentType: z.enum(MEDIA_CONTENT_TYPE),
  preview: z.object({
    id: z.number(),
    altText: z.string().optional().nullable(),
    url: z.string(),
    width: z.number().optional().nullable(),
    height: z.number().optional().nullable(),
  }),
  productId: z.number(),
})
export type ProductMedia = z.infer<typeof productMediaSchema>

export const productImageSchema = z.object({
  id: z.number(),
  originalSrc: z.string(),
  altText: z.string().optional().nullable(),
  url: z.string(),
})
export type ProductImage = z.infer<typeof productImageSchema>

export const productOptionSchema = z.object({
  id: z.number(),
  productId: z.number(),
  name: z.string(),
  values: z.array(z.string()).optional(),
  position: z.number(),
})

export type ProductOption = z.infer<typeof productOptionSchema>

export const inventoryItemSchema = z.object({
  id: z.number(),
  // createdAt: z.date(),
  measurement: z.object({
    weight: z
      .object({ value: z.number().nullable(), unit: z.enum(WEIGHT_UNIT).nullable() })
      .nullable(),
  }),
})

export type InventoryItem = z.infer<typeof inventoryItemSchema>

export const variantSchema = z.object({
  id: z.number(),
  availableForSale: z.boolean(),
  barcode: z.string().optional().nullable(),
  price: z.number(),
  compareAtPrice: z.number().optional().nullable(),
  createdAt: z.date(),
  displayName: z.string(),
  inventoryPolicy: z.enum(INVENTORY_POLICY),
  inventoryQuantity: z.number(),
  position: z.number(),
  sku: z.string().optional().nullable(),
  taxable: z.boolean(),
  title: z.string(),
  updatedAt: z.date(),
  weight: z.number().optional().nullable(),
  weightUnit: z.enum(WEIGHT_UNIT).optional().nullable(),
  inventoryItem: inventoryItemSchema.optional().nullable(),
  inventoryManagement: z.string().optional().nullable(),
  imageId: z.number().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  inventoryItemId: z.number().optional().nullable(),
  selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
})
export type ProductVariant = z.infer<typeof variantSchema>

export const productSchema = z.object({
  id: z.number(),
  title: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  publishedAt: z.date().optional().nullable(),
  description: z.string().optional().nullable(),
  descriptionHtml: z.string(),
  handle: z.string(),
  hasOnlyDefaultVariant: z.boolean(),
  productType: z.string().optional().nullable(),
  status: z.enum(PRODUDT_STATUS),
  tags: z.array(z.string()),
  totalInventory: z.number(),
  tracksInventory: z.boolean(),
  variants: z.array(variantSchema),
  options: z.array(productOptionSchema),
  images: z.array(productImageSchema),
  media: z.array(productMediaSchema),
  vendor: z.string(),
})
export type Product = z.infer<typeof productSchema>

export const addressSchema = z.object({
  id: z.number(),
  address1: z.string().optional().nullable(),
  address2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  countryCode: z.enum(COUNTRY_CODE),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  provinceCode: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  customer: z
    .object({ id: z.number(), createdAt: z.date(), updatedAt: z.date() })
    .optional()
    .nullable(),
  customerId: z.number().optional().nullable(),
  orderId: z.number().optional().nullable(),
  orderType: z.enum(ORDER_ADDRESS_TYPE).optional().nullable(),
})
export type Address = z.infer<typeof addressSchema>

export const customerSchema = z.object({
  id: z.number(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  numberOfOrders: z.number().default(0),
  state: z.string().optional().nullable(),
  amountSpent: z.number().nullable().optional(),
  // amountSpent: z
  //   .object({ amount: z.number(), currencyCode: z.enum(CURRENCY_CODE) })
  //   .nullable(),
  // lastOrder: z.object({ id: z.number(), name: z.string() }).nullable(),
  lastOrderId: z.number().optional().nullable(),
  lastOrderName: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  verifiedEmail: z.boolean().default(false),
  multipassIdentifier: z.string().optional().nullable(),
  taxExempt: z.boolean().default(false),
  tags: z.array(z.string()),
  addresses: z.array(addressSchema),
  defaultAddress: addressSchema.optional().nullable(),
  // taxExemptions: z.array(z.string()),
})

export type Customer = z.infer<typeof customerSchema>

export const orderLineItemSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  name: z.string(),
  createdAt: z.date().optional().nullable(),
  updatedAt: z.date().optional().nullable(),
  // updatedAt: z.date(),
  title: z.string(),
  quantity: z.number(),
  originalTotal: z.number(),
  originalUnitPrice: z.number(),
  productId: z.number().optional().nullable(),
  variantId: z.number().optional().nullable(),
})
export type OrderLineItem = z.infer<typeof orderLineItemSchema>

export const fulfillmentTrackingSchema = z.object({
  id: z.number().optional().nullable(),
  company: z.string(),
  createdAt: z.date().nullable().optional(),
  updatedAt: z.date().nullable().optional(),
  number: z.string(),
  url: z.string().nullable().optional(),
  fulfillmentId: z.number(),
  orderId: z.number(),
})

export type FulfillmentTracking = z.infer<typeof fulfillmentTrackingSchema>

export const orderFulfillmentSchema = z.object({
  id: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deliveredAt: z.date().optional().nullable(),
  requiresShipping: z.boolean(),
  status: z.enum(FULFILLMENT_STATUS),
  orderId: z.number(),
  trackingInfos: z.array(fulfillmentTrackingSchema),
})
export type OrderFulfillment = z.infer<typeof orderFulfillmentSchema>

export const orderRefundSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),

  note: z.string().optional().nullable(),
  totalRefundedAmount: z.number(),
  currencyCode: z.enum(CURRENCY_CODE),
})
export type OrderRefund = z.infer<typeof orderRefundSchema>

export const orderReturnSchema = z.object({
  id: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  status: z.enum(RETURN_STATUS),
})
export type OrderReturn = z.infer<typeof orderReturnSchema>

export const orderSchema = z.object({
  id: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  cancelledAt: z.date().optional().nullable(),
  closedAt: z.date().optional().nullable(),
  processedAt: z.date().optional().nullable(),
  cancelReason: z.enum(ORDER_CANCEL_REASON).optional().nullable(),
  canNotifyCustomer: z.boolean(),
  confirmationNumber: z.string().optional().nullable(),
  currencyCode: z.enum(CURRENCY_CODE),
  discountCode: z.string().optional().nullable(),
  financialStatus: z.enum(ORDER_FINANCIAL_STATUS), //displayFinancialStatus
  fulfillmentStatus: z.enum(ORDER_FULFILLMENT_STATUS), // displayFulfillmentStatus
  email: z.string().optional().nullable(),
  name: z.string(),
  note: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  poNumber: z.string().optional().nullable(),
  returnStatus: z.enum(ORDER_RETURN_STATUS).optional().nullable(),
  tags: z.array(z.string()),
  taxExempt: z.boolean().default(false),

  subtotalPrice: z.number().default(0),
  totalDiscounts: z.number().default(0),
  totalPrice: z.number().default(0),
  totalRefunded: z.number().default(0),
  totalShippingPrice: z.number().default(0),
  totalTax: z.number().default(0),

  refunds: z.array(orderRefundSchema),
  shippingAddress: addressSchema.optional().nullable(),
  billingAddress: addressSchema.optional().nullable(),

  customer: z.object({ id: z.string() }),
  customerId: z.number(),
  title: z.string(),
  lineItems: z.array(orderLineItemSchema),
  fulfillments: z.array(orderFulfillmentSchema),
})

export type Order = z.infer<typeof orderSchema>

export const webhookSchema = z.object({
  id: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  callbackUrl: z.url(),
  topic: z.enum(WEBHOOK_TOPIC),
  format: z.enum(WEBHOOK_FORMAT),
})
