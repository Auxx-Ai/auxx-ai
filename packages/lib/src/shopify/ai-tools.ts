import { database as db, schema } from '@auxx/database'
import { formatEmail } from '@auxx/utils'
import { eq, inArray } from 'drizzle-orm'

export type CustomerResponse = {
  found: boolean
  id: number | null
  email: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
}
export async function fetchCustomer(email: string | null): Promise<CustomerResponse> {
  let response: CustomerResponse = {
    found: false,
    id: null,
    email: null,
    firstName: null,
    lastName: null,
    phone: null,
  }
  email = formatEmail(email)
  if (!email) return response

  const customers = await db
    .select({
      id: schema.shopify_customers.id,
      firstName: schema.shopify_customers.firstName,
      lastName: schema.shopify_customers.lastName,
      email: schema.shopify_customers.email,
      phone: schema.shopify_customers.phone,
    })
    .from(schema.shopify_customers)
    .where(eq(schema.shopify_customers.email, email))
  if (!customers.length) return response

  response = { ...customers[0], ...response }

  return response
}

type OrderResponse = {
  found: boolean
  id: bigint | null
  name: string | null
  createdAt: Date | null
  updatedAt: Date | null
  lineItems: { name: string }[]
}
export type OrdersResponse = { found: boolean; orders: OrderResponse[] }

export async function fetchOrdersByCustomer(customerId: bigint): Promise<OrdersResponse> {
  const response: OrdersResponse = { found: false, orders: [] }

  const orders = await db
    .select({
      id: schema.Order.id,
      name: schema.Order.name,
      createdAt: schema.Order.createdAt,
      updatedAt: schema.Order.updatedAt,
    })
    .from(schema.Order)
    .where(eq(schema.Order.customerId, customerId))

  if (orders.length === 0) return response

  const orderIds = orders.map((o) => o.id)
  const lineItems = await db
    .select({ name: schema.OrderLineItem.name, orderId: schema.OrderLineItem.orderId })
    .from(schema.OrderLineItem)
    .where(inArray(schema.OrderLineItem.orderId, orderIds))

  const itemsByOrder = new Map<number, { name: string }[]>()
  for (const li of lineItems) {
    const arr = itemsByOrder.get(li.orderId) || []
    arr.push({ name: li.name })
    itemsByOrder.set(li.orderId, arr)
  }

  if (!orders.length) return response
  response.found = true

  response.orders = orders.map((order) => {
    return {
      found: true,
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      lineItems: itemsByOrder.get(order.id) || [],
    }
  })
  return response
}

export async function fetchOrderByNumber({
  orderNumber,
}: {
  orderNumber: string
}): Promise<OrderResponse> {
  let response: OrderResponse = {
    found: false,
    id: null,
    name: null,
    createdAt: null,
    updatedAt: null,
    lineItems: [],
  }

  const [order] = await db
    .select({
      id: schema.Order.id,
      name: schema.Order.name,
      createdAt: schema.Order.createdAt,
      updatedAt: schema.Order.updatedAt,
    })
    .from(schema.Order)
    .where(eq(schema.Order.name, orderNumber))
    .limit(1)
  if (!order) return response

  const items = await db
    .select({ name: schema.OrderLineItem.name })
    .from(schema.OrderLineItem)
    .where(eq(schema.OrderLineItem.orderId, order.id))

  response = { ...order, found: true, lineItems: items }
  return response
}
