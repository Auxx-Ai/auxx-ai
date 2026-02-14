// apps/web/src/server/api/routers/customer.ts

import { schema } from '@auxx/database'
import { and, asc, desc, eq, gt, ilike, lt, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

// customerRouter: tRPC router that exposes Shopify customer queries scoped to the active organization
export const customerRouter = createTRPCRouter({
  // all: fetch paginated Shopify customers with optional cursor-based pagination and ordering
  all: protectedProcedure
    .input(
      z.object({
        cursor: z.number().optional(), // Cursor for pagination
        orderBy: z.enum(['createdAt', 'updatedAt']).default('updatedAt'), // Sorting field
        sortOrder: z.enum(['asc', 'desc']).default('desc'), // Sorting order
      })
    )
    .query(async ({ ctx, input }) => {
      const take = 100
      const { organizationId } = ctx.session

      // Build where conditions
      const filters: SQL[] = [eq(schema.shopify_customers.organizationId, organizationId)]

      if (input.cursor) {
        filters.push(
          input.sortOrder === 'desc'
            ? lt(schema.shopify_customers.id, input.cursor)
            : gt(schema.shopify_customers.id, input.cursor)
        )
      }

      // Query using relational API with 'with' for includes
      const customers = await ctx.db.query.shopify_customers.findMany({
        where: (customers, { and }) => and(...filters),
        orderBy: (customers, { asc, desc }) => [
          input.sortOrder === 'desc'
            ? desc(schema.shopify_customers[input.orderBy])
            : asc(schema.shopify_customers[input.orderBy]),
        ],
        limit: take,
        with: {
          orders: {
            columns: {
              name: true,
              id: true,
            },
          },
          contact: {
            columns: {
              id: true,
              email: true,
              phone: true,
            },
          },
        },
      })

      const nextCursor = customers.length === take ? customers[take - 1]?.id : null

      return { customers, nextCursor }
    }),
  // byId: fetch a single Shopify customer by id, scoped to the active organization
  byId: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { id } = input
      const { organizationId } = ctx.session
      const parsedId = BigInt(id)

      const customer = await ctx.db.query.shopify_customers.findFirst({
        where: (customers, { eq, and }) =>
          and(
            eq(schema.shopify_customers.id, parsedId),
            eq(schema.shopify_customers.organizationId, organizationId)
          ),
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      })

      return customer
    }),
  // search: search Shopify customers by name, email, or phone with cursor pagination
  search: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.bigint().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { limit, cursor, search } = input
      const { organizationId } = ctx.session

      // Build where conditions
      const filters: SQL[] = [eq(schema.shopify_customers.organizationId, organizationId)]

      if (search) {
        const searchTerm = `%${search.trim()}%`
        filters.push(
          or(
            ilike(schema.shopify_customers.firstName, searchTerm),
            ilike(schema.shopify_customers.lastName, searchTerm),
            ilike(schema.shopify_customers.email, searchTerm),
            ilike(schema.shopify_customers.phone, searchTerm)
          )!
        )
      }

      if (cursor) {
        filters.push(lt(schema.shopify_customers.id, cursor))
      }

      // Get one more item than requested to determine if there are more items
      const items = await ctx.db.query.shopify_customers.findMany({
        where: (customers, { and }) => and(...filters),
        orderBy: (customers, { desc }) => [desc(schema.shopify_customers.id)],
        limit: limit + 1,
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      })

      let nextCursor: typeof cursor | undefined

      // If we got more items than requested, we know there are more
      if (items.length > limit) {
        const nextItem = items.pop()
        nextCursor = nextItem?.id
      }

      return { items, nextCursor }
    }),
})
