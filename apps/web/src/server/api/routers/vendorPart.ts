// apps/web/src/server/api/routers/vendorPart.ts

import { database as db, schema } from '@auxx/database'
import { handleVendorPartChange, handleVendorPartDelete } from '@auxx/lib/bom'
import { createScopedLogger } from '@auxx/logger'
import * as vendorPartDb from '@auxx/services/vendor-parts'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-vendorPart')

export const vendorPartRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        entityInstanceId: z.string().min(1),
        partId: z.string().min(1),
        vendorSku: z.string().min(1),
        unitPrice: z.number().nullable().optional(),
        leadTime: z.number().nullable().optional(),
        minOrderQty: z.number().nullable().optional(),
        isPreferred: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { entityInstanceId, partId, vendorSku, leadTime, minOrderQty, isPreferred } = input
      const { unitPrice } = input

      // Check if entity instance exists
      const entityInstance = await db.query.EntityInstance.findFirst({
        where: and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, organizationId)
        ),
      })
      if (!entityInstance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Entity instance not found' })
      }

      // Check if part exists
      const part = await db.query.Part.findFirst({
        where: and(eq(schema.Part.id, partId), eq(schema.Part.organizationId, organizationId)),
      })
      if (!part) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Part not found' })
      }

      // Check if association already exists
      const existsResult = await vendorPartDb.checkVendorPartExists({
        entityInstanceId,
        partId,
        organizationId,
      })
      if (existsResult.isOk() && existsResult.value) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This entity instance is already associated with this part',
        })
      }

      // Create the association
      const createResult = await vendorPartDb.insertVendorPart({
        organizationId,
        entityInstanceId,
        partId,
        vendorSku,
        unitPrice,
        leadTime,
        minOrderQty,
        isPreferred,
      })

      if (createResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create vendor part association',
        })
      }

      const vendorPart = createResult.value

      // Handle cost updates
      await handleVendorPartChange(organizationId, partId, false, isPreferred!)

      // Clear other preferred if setting this one
      if (isPreferred && vendorPart) {
        await vendorPartDb.clearOtherPreferred({
          organizationId,
          partId,
          excludeId: vendorPart.id,
        })
      }

      return { vendorPart: { ...vendorPart, contact: entityInstance, part } }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        entityInstanceId: z.string().min(1),
        partId: z.string().min(1),
        vendorSku: z.string().min(1),
        unitPrice: z.number().nullable().optional(),
        leadTime: z.number().nullable().optional(),
        minOrderQty: z.number().nullable().optional(),
        isPreferred: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id, partId, vendorSku, leadTime, minOrderQty, isPreferred, unitPrice } = input

      // Check if association exists
      const vendorPartResult = await vendorPartDb.getVendorPartById({
        id,
        organizationId,
      })

      if (vendorPartResult.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor-part association not found' })
      }

      const existingVendorPart = vendorPartResult.value

      // Update the association
      const updateResult = await vendorPartDb.updateVendorPart({
        id,
        organizationId,
        vendorSku,
        unitPrice,
        leadTime,
        minOrderQty,
        isPreferred,
      })

      if (updateResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update vendor part association',
        })
      }

      // Handle cost updates
      await handleVendorPartChange(
        organizationId,
        partId,
        existingVendorPart?.isPreferred,
        isPreferred!
      )

      if (isPreferred) {
        await vendorPartDb.clearOtherPreferred({
          organizationId,
          partId,
          excludeId: id,
        })
      }
    }),

  all: protectedProcedure
    .input(
      z
        .object({
          query: z
            .object({
              entityInstanceId: z.string().optional(),
              partId: z.string().optional(),
            })
            .optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { entityInstanceId, partId } = input?.query || {}

      // Use service function with relational queries
      const result = await vendorPartDb.getVendorParts({
        organizationId,
        entityInstanceId,
        partId,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch vendor parts',
        })
      }

      return { vendorParts: result.value }
    }),

  byPartAndEntityInstance: protectedProcedure
    .input(
      z.object({
        entityInstanceId: z.string().min(1),
        partId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { entityInstanceId, partId } = input

      const result = await vendorPartDb.getVendorPartByEntityInstanceAndPart({
        entityInstanceId,
        partId,
        organizationId,
      })

      if (result.isErr()) {
        logger.error('Vendor-part association not found', { entityInstanceId, partId })
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor-part association not found' })
      }

      return { vendorPart: result.value }
    }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const { id } = input

    const result = await vendorPartDb.getVendorPartById({
      id,
      organizationId,
    })

    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor-part association not found' })
    }

    return { vendorPart: result.value }
  }),

  delete: protectedProcedure
    .input(z.object({ entityInstanceId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id } = input

      // Check if vendor part exists
      const vendorPartResult = await vendorPartDb.getVendorPartById({
        id,
        organizationId,
      })

      if (vendorPartResult.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor-part association not found' })
      }

      const vendorPart = vendorPartResult.value

      // Delete the association
      const deleteResult = await vendorPartDb.deleteVendorPart({
        id,
        organizationId,
      })

      if (deleteResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete vendor part association',
        })
      }

      await handleVendorPartDelete(organizationId, vendorPart.part.id)

      return { success: true }
    }),
})
