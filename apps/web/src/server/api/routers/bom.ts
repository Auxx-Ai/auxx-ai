import { BomService } from '@auxx/lib/bom'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

export const bomRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()

  get: protectedProcedure
    .input(
      z.object({
        partId: z.string().min(1), // Expecting partId
        query: z
          .object({
            depth: z.number().optional(), // Optional search name
          })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const organizationId = ctx.session.user.defaultOrganizationId

      if (!userId || !organizationId) {
        return { error: 'Unauthorized' }
      }
      const { partId } = input
      let { depth } = input.query || {}

      if (!depth) depth = 10
      // depth = depth ? parseInt(depth) : 10
      const bom = await BomService.getFlattenedBom(organizationId, partId, depth)

      return { bom }
    }),

  buildDeck: protectedProcedure
    .input(
      z.object({
        partId: z.string(),
        query: z.object({ quantity: z.number().optional() }).optional(),
      })
    ) // Expecting both parentId and subpartId
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!userId || !organizationId) {
        return { error: 'Unauthorized' }
      }
      const { partId } = input

      let quantity = input.query?.quantity
      quantity = quantity ?? 1

      const result = await BomService.checkInventorySufficiency(organizationId, partId, quantity)

      return NextResponse.json(result)

      // const { id: parentId, subpartId } = params
    }),
  cost: protectedProcedure
    .input(
      z.object({ partId: z.string(), query: z.object({ preferredOnly: z.boolean() }).optional() })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!userId || !organizationId) {
        return { error: 'Unauthorized' }
      }
      const { partId } = input
      const { preferredOnly } = input.query || {}

      // preferredOnly = preferredOnly
      // const preferredOnly = searchParams.get('preferredOnly') === 'true'

      await BomService.calculatePartCost(organizationId, partId, preferredOnly)

      // return NextResponse.json(result)
    }),
})
