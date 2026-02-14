import { z } from 'zod'

import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

export const orderRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        cursor: z.number().optional(), // Cursor for pagination
        sortOrder: z.enum(['asc', 'desc']).default('desc'), // Sorting order
        orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'), // Sorting field
      })
    )
    .query(async ({ ctx, input }) => {
      const take = 100

      const orders = await ctx.db.query.Order.findMany({
        columns: {
          id: true,
          customerId: true,
          name: true,
          email: true,
          totalPrice: true,
          subtotalPrice: true,
          totalTax: true,
          financialStatus: true,
          fulfillmentStatus: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          customer: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
            },
            with: {
              contact: true,
            },
          },
        },
        orderBy: (order, { desc, asc }) => [
          input.sortOrder === 'desc' ? desc(order[input.orderBy]) : asc(order[input.orderBy]),
        ],
        where: (order, { gt, lt, eq, and }) =>
          input.cursor
            ? and(
                eq(order.organizationId, ctx.session.organizationId),
                input.sortOrder === 'desc'
                  ? lt(order.id, input.cursor!)
                  : gt(order.id, input.cursor!)
              )
            : eq(order.organizationId, ctx.session.organizationId),
        limit: take,
      })

      const nextCursor = orders.length === take ? orders[take - 1]!.id : null
      return { orders, nextCursor }
    }),

  byId: protectedProcedure
    .input(
      z.object({
        id: z.union([z.bigint(), z.string()]), // Order ID accepts bigint or string
      })
    )
    .query(async ({ ctx, input }) => {
      const id = typeof input.id === 'string' ? Number(input.id) : Number(input.id)

      const order = await ctx.db.query.Order.findFirst({
        where: (order, { eq, and }) =>
          and(eq(order.organizationId, ctx.session.organizationId), eq(order.id, id)),
        with: {
          customer: true,
          refunds: true,
          returns: true,
          fulfillments: true,
          trackings: true,
          lineItems: true,
        },
      })

      return order
    }),

  getOrdersByShopifyCustomerIds: protectedProcedure
    .input(
      z.object({
        customerIds: z.array(z.string()), // Array of Shopify customer IDs
        page: z.number().default(1), // Current page number
        pageSize: z.number().default(10), // Number of orders per page
      })
    )
    .query(async ({ ctx, input }) => {
      const take = 10

      const customerIds = input.customerIds.map((id) => parseInt(id, 10))

      const orders = await ctx.db.query.Order.findMany({
        where: (order, { inArray, eq, and }) =>
          and(
            eq(order.organizationId, ctx.session.organizationId),
            inArray(order.customerId, customerIds)
          ),
        orderBy: (order, { desc }) => [desc(order.createdAt)],
        with: {
          lineItems: true,
          refunds: true,
          returns: true,
          fulfillments: true,
          trackings: true,
        },
        limit: take,
      })

      return { orders, totalCount: orders.length }
    }),
})
