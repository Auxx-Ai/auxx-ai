// apps/web/src/server/api/routers/part.ts

import { PartService } from '@auxx/lib/parts'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Schema for inventory input
 */
const inventorySchema = z.object({
  quantity: z.number(),
  location: z.string().optional(),
  reorderPoint: z.number().optional(),
  reorderQty: z.number().optional(),
})

/**
 * Schema for vendor part input during part creation
 */
const vendorPartSchema = z.object({
  contactId: z.string().min(1),
  vendorSku: z.string().min(1),
  unitPrice: z.number().nullable().optional(),
  leadTime: z.number().nullable().optional(),
  minOrderQty: z.number().nullable().optional(),
  isPreferred: z.boolean().optional(),
})

/**
 * Schema for creating a part
 */
const createPartSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  sku: z.string().min(1),
  hsCode: z.string().optional(),
  category: z.string().optional(),
  shopifyProductLinkId: z.string().optional(),
  inventory: inventorySchema.optional(),
  vendorPart: vendorPartSchema.optional(),
})

/**
 * Schema for updating a part
 */
const updatePartSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  sku: z.string().min(1),
  hsCode: z.string().optional(),
  category: z.string().optional(),
  shopifyProductLinkId: z.string().optional(),
  inventory: inventorySchema.optional(),
})

/**
 * Schema for listing parts
 */
const allPartsSchema = z.object({
  cursor: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  searchParams: z
    .object({
      category: z.string().optional(),
      query: z.string().optional(),
    })
    .optional(),
  orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
})

export const partRouter = createTRPCRouter({
  /**
   * Create a new part
   */
  create: protectedProcedure.input(createPartSchema).mutation(async ({ ctx, input }) => {
    try {
      const { userId, organizationId } = ctx.session
      const partService = new PartService(organizationId, userId)
      const part = await partService.createPart(input)
      return { part }
    } catch (error: any) {
      if (error.message.includes('SKU already exists')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),

  /**
   * Get all parts with pagination and filtering
   */
  all: protectedProcedure.input(allPartsSchema).query(async ({ ctx, input }) => {
    try {
      const { organizationId, userId } = ctx.session
      const partService = new PartService(organizationId, userId)
      return await partService.getAllParts(input)
    } catch (error: any) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),

  /**
   * Get a single part by ID
   */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { organizationId, userId } = ctx.session
      const partService = new PartService(organizationId, userId)
      return await partService.getPartById(input.id)
    } catch (error: any) {
      if (error.message.includes('not found')) {
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),

  /**
   * Update a part
   */
  update: protectedProcedure.input(updatePartSchema).mutation(async ({ ctx, input }) => {
    try {
      const { organizationId, userId } = ctx.session
      const partService = new PartService(organizationId, userId)
      return await partService.updatePart(input)
    } catch (error: any) {
      if (error.message.includes('not found')) {
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
      }
      if (error.message.includes('SKU already exists')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),

  /**
   * Delete a part
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const partService = new PartService(organizationId, userId)
        return await partService.deletePart(input.id)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  /**
   * Calculate cost for a single part
   */
  calculateCost: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const partService = new PartService(organizationId, userId)
        return await partService.calculateCost(input.id)
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  /**
   * Calculate costs for all parts
   */
  calculateAllCosts: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const { organizationId, userId } = ctx.session
      const partService = new PartService(organizationId, userId)
      return await partService.calculateAllCosts()
    } catch (error: any) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),
})
