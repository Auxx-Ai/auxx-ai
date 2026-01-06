// packages/lib/src/shopify/sync-orders.ts

import { extractShopifyId } from './utils'

import type { AdminApiClient, ResponseWithType } from '@shopify/admin-api-client'
import {
  convertToCents,
  formatComplexName,
  formatEmail,
  formatPhoneNumber,
  parseEmailString,
  withRetry,
} from '@auxx/utils'
import { schema, type Database } from '@auxx/database'
import {
  type FulfillmentTracking,
  type Order,
  ORDER_ADDRESS_TYPE,
  type OrderFulfillment,
  type OrderLineItem,
  type OrderRefund,
} from './shopify-types'
import { processAddress, upsertAddress, upsertCustomer } from './sync-customers'
import { createScopedLogger } from '@auxx/logger'
import { type ShopifyAdminClient } from './shopify-webhooks'

type SyncOptions = { limit: number; pageInfo?: string | null }
const logger = createScopedLogger('shopify-sync-orders')

export async function fetchOrder(ownerId: string, client: ShopifyAdminClient) {
  const response = (await withRetry(() =>
    client.fetch(getOneOrderGraphQL, { variables: { id: ownerId } })
  )) as ResponseWithType

  const json = await response.json()
  // data.orders.edges
  if (json.errors) {
    logger.error('Error fetching order', { errors: json.errors })
    throw new Error('Error fetching order')
  }
  const data = [{ node: json.data.order }]
  const formatted = processOrders(data)
  return formatted[0]
}

export class OrderSync {
  private shopifyClient: AdminApiClient
  private db: Database
  private integrationId: string
  private organizationId: string

  constructor(
    shopifyClient: AdminApiClient,
    db: Database,
    organizationId: string,
    integrationId: string
  ) {
    this.shopifyClient = shopifyClient
    this.db = db
    this.organizationId = organizationId
    this.integrationId = integrationId
  }

  async sync(): Promise<Order[]> {
    if (!this.shopifyClient) throw new Error('Shopify client not initialized')

    const allOrders = await this.fetch({ limit: 10 })

    const orders = await this.syncToDB(allOrders)

    // console.dir(allCustomers, { depth: null, colors: true })
    return orders
  }

  async fetch({ limit, pageInfo = null }: SyncOptions) {
    let result
    let i = 1
    let allOrders: Order[] = []
    try {
      do {
        i--

        const response = (await withRetry(() =>
          this.shopifyClient.fetch(getOrdersGraphQL, {
            variables: { first: limit, after: pageInfo },
          })
        )) as ResponseWithType

        const json = await response.json()
        if (json.errors) {
          console.log(json)
          logger.error('Error fetching orders from Shopify', { errors: json.errors })
          // console.dir(json.errors, { depth: null, colors: true })
          // throw new Error('Error fetching orders from Shopify', {
          //   cause: json.errors,
          // })
        }
        logger.info(`Orders fetched from Shopify: ${json?.data?.orders?.edges?.length}`)

        const orders = await this.process(json.data)
        // console.dir(processed, { depth: null, colors: true })
        logger.info(`Orders processed: ${orders.length}`)
        allOrders = allOrders.concat(orders)

        pageInfo = json?.data?.orders?.pageInfo?.endCursor
      } while (pageInfo && i > 0)

      logger.info(`Fetched orders: ${allOrders.length}`)
      return allOrders
    } catch (error: any) {
      logger.error('Error fetching orders:', { error })
      throw error
    }
  }

  async process(data: any) {
    // return data.orders.edges
    return processOrders(data.orders.edges)
  }

  async syncToDB(orders: Order[]) {
    // console.log(`Syncing ${customers.length} customers to database`)

    for (const [index, order] of orders.entries()) {
      await upsertOrder(this.db, order, index, this.organizationId, this.integrationId)
    }
    return orders
    // return syncCustomersToDatabase(customers)
  }
}

export const upsertOrder = async (
  db: Database,
  order: Order,
  index: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting Order ${index + 1} with id ${order.id}`)
    let shippingAddressId = undefined
    let billingAddressId = undefined

    if (order.customer) {
      logger.info(`Upserting Customer ${order.customer.id} for Order ${order.id}`)
      await upsertCustomer(db, order.customer, 0, organizationId, integrationId)
    }

    if (order.shippingAddress) {
      order.shippingAddress.customer.id = order.customerId
      const shippingAd = await upsertAddress(
        db,
        order.shippingAddress,
        ORDER_ADDRESS_TYPE.SHIPPING,
        order.customerId,
        organizationId,
        integrationId
      )
      if (shippingAd) shippingAddressId = shippingAd.id
    }

    if (order.billingAddress) {
      order.billingAddress.customer.id = order.customerId
      const billingAd = await upsertAddress(
        db,
        order.billingAddress,
        ORDER_ADDRESS_TYPE.BILLING,
        order.customerId,
        organizationId,
        integrationId
      )
      if (billingAd) billingAddressId = billingAd.id
    }

    // order.shippingAddressId = order.shippingAddress.id
    // Upsert order
    const orderInsertValues = {
      id: order.id,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
      closedAt: order.closedAt,
      processedAt: order.processedAt,
      cancelReason: order.cancelReason,
      canNotifyCustomer: order.canNotifyCustomer,
      confirmationNumber: order.confirmationNumber,
      currencyCode: order.currencyCode,
      discountCode: order.discountCode,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      email: order.email,
      name: order.name,
      note: order.note,
      phone: order.phone,
      poNumber: order.poNumber,
      returnStatus: order.returnStatus,
      tags: order.tags,
      taxExempt: order.taxExempt,
      subtotalPrice: order.subtotalPrice,
      totalDiscounts: order.totalDiscounts,
      totalPrice: order.totalPrice,
      totalRefunded: order.totalRefunded,
      totalShippingPrice: order.totalShippingPrice,
      totalTax: order.totalTax,
      ...(shippingAddressId !== undefined ? { shippingAddressId } : {}),
      ...(billingAddressId !== undefined ? { billingAddressId } : {}),
      customerId: order.customerId,
      organizationId,
      integrationId,
    } satisfies typeof schema.Order.$inferInsert

    const orderUpdateValues = {
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
      closedAt: order.closedAt,
      processedAt: order.processedAt,
      cancelReason: order.cancelReason,
      canNotifyCustomer: order.canNotifyCustomer,
      confirmationNumber: order.confirmationNumber,
      currencyCode: order.currencyCode,
      discountCode: order.discountCode,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      email: order.email,
      name: order.name,
      note: order.note,
      phone: order.phone,
      poNumber: order.poNumber,
      returnStatus: order.returnStatus,
      tags: order.tags,
      taxExempt: order.taxExempt,
      subtotalPrice: order.subtotalPrice,
      totalDiscounts: order.totalDiscounts,
      totalPrice: order.totalPrice,
      totalRefunded: order.totalRefunded,
      totalShippingPrice: order.totalShippingPrice,
      totalTax: order.totalTax,
      customerId: order.customerId,
      ...(shippingAddressId !== undefined ? { shippingAddressId } : {}),
      ...(billingAddressId !== undefined ? { billingAddressId } : {}),
    } satisfies Partial<typeof schema.Order.$inferInsert>

    await db.insert(schema.Order).values(orderInsertValues).onConflictDoUpdate({
      target: schema.Order.id,
      set: orderUpdateValues,
    })

    // Upsert refunds
    for (const [ri, refund] of order.refunds.entries()) {
      await upsertRefund(db, refund, ri, order.id, organizationId, integrationId)
    }

    // Upsert line items
    for (const [ri, lineItem] of order.lineItems.entries()) {
      await upsertOrderLineItem(db, lineItem, ri, order.id, organizationId, integrationId)
    }

    // Upsert fulfillments
    for (const [ri, fulfillment] of order.fulfillments.entries()) {
      await upsertOrderFulfillment(db, fulfillment, ri, order.id, organizationId, integrationId)
    }
  } catch (error: unknown) {
    logger.error(`Failed to upsert order ${order.id}`, { error })
    throw error
  }
}

const upsertRefund = async (
  db: Database,
  refund: OrderRefund,
  index: number,
  orderId: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting Refund ${index + 1} with id ${refund.id}`)

    const refundInsertValues = {
      id: refund.id,
      orderId,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
      totalRefundedAmount: refund.totalRefundedAmount,
      currencyCode: refund.currencyCode,
    } satisfies typeof schema.OrderRefund.$inferInsert

    const refundUpdateValues = {
      updatedAt: refund.updatedAt,
      totalRefundedAmount: refund.totalRefundedAmount,
      currencyCode: refund.currencyCode,
    } satisfies Partial<typeof schema.OrderRefund.$inferInsert>

    await db.insert(schema.OrderRefund).values(refundInsertValues).onConflictDoUpdate({
      target: schema.OrderRefund.id,
      set: refundUpdateValues,
    })
  } catch (error: unknown) {
    logger.error(`Failed to upsert order refund ${refund.id}`, { error })
    throw error
  }
}

const upsertOrderLineItem = async (
  db: Database,
  lineItem: OrderLineItem,
  index: number,
  orderId: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting OrderLineItem ${index + 1} with id ${lineItem.id}`)

    const lineItemInsertValues = {
      id: lineItem.id,
      createdAt: lineItem.createdAt ?? new Date(),
      updatedAt: lineItem.updatedAt ?? new Date(),
      name: lineItem.name,
      quantity: lineItem.quantity,
      ...(lineItem.productId !== undefined ? { productId: lineItem.productId } : {}),
      ...(lineItem.variantId !== undefined ? { variantId: lineItem.variantId } : {}),
      title: lineItem.title,
      originalTotal: lineItem.originalTotal,
      originalUnitPrice: lineItem.originalUnitPrice,
      orderId,
    } satisfies typeof schema.OrderLineItem.$inferInsert

    const lineItemUpdateValues = {
      updatedAt: lineItem.updatedAt ?? new Date(),
      name: lineItem.name,
      quantity: lineItem.quantity,
      title: lineItem.title,
      originalTotal: lineItem.originalTotal,
      originalUnitPrice: lineItem.originalUnitPrice,
      ...(lineItem.productId !== undefined ? { productId: lineItem.productId } : {}),
      ...(lineItem.variantId !== undefined ? { variantId: lineItem.variantId } : {}),
    } satisfies Partial<typeof schema.OrderLineItem.$inferInsert>

    await db.insert(schema.OrderLineItem).values(lineItemInsertValues).onConflictDoUpdate({
      target: schema.OrderLineItem.id,
      set: lineItemUpdateValues,
    })
  } catch (error: unknown) {
    logger.error(`Failed to upsert OrderLineItem ${lineItem.id}`, { error })
    throw error
  }
}

const upsertOrderFulfillment = async (
  db: Database,
  fulfillment: OrderFulfillment,
  index: number,
  orderId: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting OrderFulfillment ${index + 1} with id ${fulfillment.id}`)

    const fulfillmentInsertValues = {
      id: fulfillment.id,
      createdAt: fulfillment.createdAt,
      updatedAt: fulfillment.updatedAt,
      deliveredAt: fulfillment.deliveredAt,
      status: fulfillment.status,
      requiresShipping: fulfillment.requiresShipping,
      orderId,
    } satisfies typeof schema.OrderFulfillment.$inferInsert

    const fulfillmentUpdateValues = {
      updatedAt: fulfillment.updatedAt,
      deliveredAt: fulfillment.deliveredAt,
      status: fulfillment.status,
      requiresShipping: fulfillment.requiresShipping,
    } satisfies Partial<typeof schema.OrderFulfillment.$inferInsert>

    await db.insert(schema.OrderFulfillment).values(fulfillmentInsertValues).onConflictDoUpdate({
      target: schema.OrderFulfillment.id,
      set: fulfillmentUpdateValues,
    })

    // Upsert tracking
    for (const [ri, tracking] of fulfillment.trackingInfos.entries()) {
      await upsertFulfillmentTracking(
        db,
        tracking,
        ri,
        orderId,
        fulfillment.id,
        organizationId,
        integrationId
      )
    }
  } catch (error: unknown) {
    logger.error(`Failed to upsert OrderFulfillment ${fulfillment.id}`, { error })
    throw error
  }
}

const upsertFulfillmentTracking = async (
  db: Database,
  tracking: FulfillmentTracking,
  index: number,
  orderId: number,
  fulfillmentId: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting FulfillmentTracking ${index + 1} with tracking #: ${tracking.number}`)

    const createdAt = tracking.createdAt ?? new Date()
    const updatedAt = tracking.updatedAt ?? new Date()

    await db
      .insert(schema.FulfillmentTracking)
      .values({
        number: tracking.number,
        company: tracking.company,
        url: tracking.url ?? null,
        orderId,
        fulfillmentId,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.FulfillmentTracking.number,
        set: {
          company: tracking.company,
          url: tracking.url ?? null,
          updatedAt,
          orderId,
          fulfillmentId,
        },
      })
  } catch (error: unknown) {
    logger.error(`Failed to upsert FulfillmentTracking ${tracking.number}`, { error })
    throw error
  }
}

export const processRefunds = (refunds: any, orderId: number) => {
  const result: OrderRefund[] = refunds.map((r: any) => {
    r.id = extractShopifyId(r.id)
    r.orderId = orderId
    r.createdAt = new Date(r.createdAt)
    r.updatedAt = new Date(r.updatedAt)
    r.totalRefundedAmount = convertToCents(r.totalRefundedSet?.shopMoney?.amount)
    r.currencyCode = r.totalRefundedSet?.shopMoney?.currencyCode || 'USD'

    delete r.totalRefundedSet

    return r as OrderRefund
  })

  return result as OrderRefund[]
}

export const processFulfillments = (fulfillments: any, orderId: number) => {
  const result: OrderFulfillment[] = fulfillments.map((f: any) => {
    // f.node.id = extractShopifyId(f.node.id)
    f.id = extractShopifyId(f.id)
    f.orderId = orderId
    f.createdAt = new Date(f.createdAt)
    f.updatedAt = new Date(f.updatedAt)
    f.deliveredAt = f.deliveredAt ? new Date(f.deliveredAt) : null
    f.trackingInfos = f.trackingInfo.map((t: any) => {
      return {
        company: t.company,
        number: t.number,
        url: t.url,
        fulfillmentId: f.id,
        orderId: orderId,
      } as FulfillmentTracking
    })
    return f as OrderFulfillment
  })

  return result
}

export const processLineItems = (lineItems: any, orderId: number) => {
  const result: OrderLineItem[] = lineItems.map((l: any) => {
    l.id = extractShopifyId(l.id)
    l.orderId = orderId
    if (l.product) {
      l.productId = extractShopifyId(l.product.id)
    }
    if (l.variant) {
      l.variantId = extractShopifyId(l.variant.id)
    }
    l.originalTotal = convertToCents(l.originalTotalSet?.shopMoney?.amount)
    l.originalUnitPrice = convertToCents(l.originalUnitPriceSet?.shopMoney?.amount)
    // l.createdAt = new Date(l.createdAt)
    // l.updatedAt = new Date(l.updatedAt)
    delete l.originalTotalSet
    delete l.originalUnitPriceSet

    return l as OrderLineItem
  })

  return result
}

export const processOrders = (orders: any) => {
  const result: Order[] = orders
    .map((o: any, i: number) => {
      const order = o.node
      logger.info(`Processing order ${i}: ${o?.node?.id}`)
      try {
        order.id = extractShopifyId(order.id)
        order.createdAt = new Date(order.createdAt)
        order.updatedAt = new Date(order.updatedAt)
        order.cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null
        order.closedAt = order.closedAt ? new Date(order.closedAt) : null
        order.processedAt = order.processedAt ? new Date(order.processedAt) : null

        order.financialStatus = order.displayFinancialStatus
        order.fulfillmentStatus = order.displayFulfillmentStatus

        order.customerId = extractShopifyId(order.customer.id)
        // delete order.customer

        if (order.email) {
          const parsedEmail = parseEmailString(order.email)
          order.email = parsedEmail[0]?.address
        }
        order.phone = formatPhoneNumber(order.phone)

        order.subtotalPrice = convertToCents(order.subtotalPriceSet?.shopMoney?.amount)
        order.totalDiscounts = convertToCents(order.totalDiscountsSet?.shopMoney?.amount)

        order.totalPrice = convertToCents(order.totalPriceSet?.shopMoney?.amount)
        order.totalRefunded = convertToCents(order.totalRefundedSet?.shopMoney?.amount)
        order.totalShippingPrice = convertToCents(order.totalShippingPriceSet?.shopMoney?.amount)
        order.totalTax = convertToCents(order.totalTaxSet?.shopMoney?.amount)

        delete order.subtotalPriceSet
        delete order.totalDiscountsSet
        delete order.totalRefundedSet
        delete order.totalShippingPriceSet
        delete order.totalPriceSet
        delete order.totalTaxSet

        if (order.billingAddress) {
          order.billingAddress = processAddress(order.billingAddress, 'billing', order.customerId)
        }
        if (order.shippingAddress) {
          order.shippingAddress = processAddress(
            order.shippingAddress,
            'shipping',
            order.customerId
          )
        }

        order.lineItems = processLineItems(order.lineItems?.nodes || [], order.id)
        order.fulfillments = processFulfillments(order.fulfillments || [], order.id)
        order.customer = {
          id: order.customerId,
          firstName: formatComplexName(order.customer.firstName),
          lastName: formatComplexName(order.customer.lastName),
          phone: formatPhoneNumber(order.customer.phone),
          email: formatEmail(order.customer.email),
          createdAt: new Date(order.customer.createdAt),
          updatedAt: new Date(order.customer.updatedAt),
          addresses: [],
        }
        order.refunds = processRefunds(order.refunds || [], order.id)

        return order as Order
      } catch (error) {
        logger.error(`Error processing order ${i}:`, { error })
        return null
      }
    })
    .filter(Boolean)
  return result
}

// 'updated_at:>2019-12-01'`query {
export const getOrdersGraphQL = `#graphql
  query ($first: Int = 1, $after: String) {
    orders(first: $first,  after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          createdAt
          updatedAt
          cancelledAt
          closedAt
          processedAt
          cancelReason
          canNotifyCustomer
          confirmationNumber
          currencyCode
          discountCode
          displayFinancialStatus
          displayFulfillmentStatus
          email
          name
          note
          phone
          poNumber
          returnStatus
          tags
          taxExempt

          subtotalPriceSet {
            shopMoney {
              amount
            }
          }

          totalDiscountsSet {
            shopMoney {
              amount
            }
          }
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
            }
          }

          totalTaxSet {
            shopMoney {
              amount
            }
          }

          lineItems(first: 200) {
            nodes {
              id
              name
              quantity
              title
              product {
                id
              }
              variant {
                id
              }
              originalTotalSet {
                shopMoney {
                  amount
                }
              }
              originalUnitPriceSet {
                shopMoney {
                  amount
                }
              }
            }
          }

          fulfillments {
            id
            createdAt
            updatedAt
            deliveredAt
            status
            requiresShipping
            trackingInfo {
              company
              number
              url  
            }
          }

          customer {
            id
            firstName
            lastName
            createdAt
            updatedAt
            email
            phone
          }

          shippingAddress {
            id
            address1
            address2
            city
            company
            countryCodeV2
            firstName
            lastName
            latitude
            longitude
            name
            phone
            provinceCode
            timeZone
            zip
          }

          billingAddress {
            id
            address1
            address2
            city
            company
            countryCodeV2
            firstName
            lastName
            latitude
            longitude
            name
            phone
            provinceCode
            timeZone
            zip
          }

          refunds {
            id
            createdAt
            updatedAt
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }

        }
      }
    }
}`

export const getOneOrderGraphQL = `query getOneOrder($id: ID!) {
  order(id: $id) {
    id
    createdAt
    updatedAt
    cancelledAt
    closedAt
    processedAt
    cancelReason
    canNotifyCustomer
    confirmationNumber
    currencyCode
    discountCode
    displayFinancialStatus
    displayFulfillmentStatus
    email
    name
    note
    phone
    poNumber
    returnStatus
    tags
    taxExempt
    subtotalPriceSet {
      shopMoney {
        amount
      }
    }
    totalDiscountsSet {
      shopMoney {
        amount
      }
    }
    totalPriceSet {
      shopMoney {
        amount
      }
    }
    totalRefundedSet {
      shopMoney {
        amount
      }
    }
    totalShippingPriceSet {
      shopMoney {
        amount
      }
    }
    totalTaxSet {
      shopMoney {
        amount
      }
    }
    lineItems(first: 200) {
      nodes {
        id
        name
        quantity
        title
        product {
          id
        }
        variant {
          id
        }
        originalTotalSet {
          shopMoney {
            amount
          }
        }
        originalUnitPriceSet {
          shopMoney {
            amount
          }
        }
      }
    }
    fulfillments {
      id
      createdAt
      updatedAt
      deliveredAt
      status
      requiresShipping
      trackingInfo {
        company
        number
        url
      }
    }
    customer {
      id
      firstName
      lastName
      createdAt
      updatedAt
      email
    }
    shippingAddress {
      id
      address1
      address2
      city
      company
      countryCodeV2
      firstName
      lastName
      latitude
      longitude
      name
      phone
      provinceCode
      timeZone
      zip
    }
    billingAddress {
      id
      address1
      address2
      city
      company
      countryCodeV2
      firstName
      lastName
      latitude
      longitude
      name
      phone
      provinceCode
      timeZone
      zip
    }
    refunds {
      id
      createdAt
      updatedAt
      totalRefundedSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
  }
}`

// const processAddress = (a: any) => {
//   a.id = extractShopifyId(a.id)

//   return a
// }
