// apps/web/src/server/api/routers/product.ts

import { z } from 'zod'

import { createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc'

/** Product router exposes product queries and utilities. */
export const productRouter = createTRPCRouter({
  /** getProducts returns paginated products with related entities. */
  getProducts: protectedProcedure
    .input(
      z.object({
        cursor: z.bigint().optional(), // Cursor for pagination
        sortOrder: z.enum(['asc', 'desc']).default('desc'), // Sorting order
        orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'), // Sorting field
      })
    )
    .query(async ({ ctx, input }) => {
      const take = 100
      // Convert bigint cursor input to number to match column typing
      const cursorValue = input.cursor ? Number(input.cursor) : undefined

      const products = await ctx.db.query.Product.findMany({
        with: {
          variants: true,
          media: true,
          options: true,
        },
        orderBy: (product, { asc, desc }) => {
          const column = input.orderBy === 'createdAt' ? product.createdAt : product.updatedAt
          return [input.sortOrder === 'desc' ? desc(column) : asc(column)]
        },
        where: (product, { and, eq, gt }) =>
          cursorValue !== undefined
            ? and(
                eq(product.organizationId, ctx.session.organizationId),
                gt(product.id, cursorValue)
              )
            : eq(product.organizationId, ctx.session.organizationId),
        limit: take,
      })

      const nextCursor = products.length === take ? products[products.length - 1]!.id : null
      return { products, nextCursor }
    }),

  /** getSecretMessage demonstrates a protected route. */
  getSecretMessage: protectedProcedure.query(() => {
    return 'you can now see this secret message!'
  }),
  /** getCategories aggregates unique tags and vendors from products. */
  getCategories: publicProcedure.query(async ({ ctx }) => {
    // Get all products to extract tags and vendors
    const products = await ctx.db.query.Product.findMany({
      columns: {
        tags: true,
        vendor: true,
      },
    })

    // Extract unique tags
    const allTags = products.flatMap((product) => product.tags || [])
    const uniqueTags = [...new Set(allTags)].filter(Boolean).sort()

    // Extract unique vendors
    const allVendors = products.map((product) => product.vendor).filter(Boolean)
    const uniqueVendors = [...new Set(allVendors)].sort()

    return { tags: uniqueTags, vendors: uniqueVendors }
  }),
})
