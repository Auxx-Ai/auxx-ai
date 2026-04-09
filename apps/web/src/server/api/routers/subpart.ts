// @deprecated — Mutations migrated to entity system (record.create / useSaveFieldValue).
// Remaining consumers: part-detail.tsx. Remove once that file is migrated.
import { database as db, schema } from '@auxx/database'
import { recalculateAffectedParts } from '@auxx/lib/bom'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-subparts')

export const subpartRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()

  all: protectedProcedure
    .input(
      z.object({
        parentPartId: z.string(), // Optional: if you want to filter by partId
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const { parentPartId } = input
      // const parentId = input.partId

      // Check if parent part exists
      const [parentPart] = await db
        .select()
        .from(schema.Part)
        .where(
          and(eq(schema.Part.id, parentPartId), eq(schema.Part.organizationId, organizationId))
        )
        .limit(1)

      if (!parentPart) {
        logger.error('Parent part not found', { parentPartId })
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent part not found' })
        // return NextResponse.json(
        //   { error: 'Parent part not found' },
        //   { status: 404 }
        // )
      }

      // Get all subparts with their details
      const subparts = await db
        .select({
          id: schema.Subpart.id,
          parentPartId: schema.Subpart.parentPartId,
          childPartId: schema.Subpart.childPartId,
          quantity: schema.Subpart.quantity,
          notes: schema.Subpart.notes,
          organizationId: schema.Subpart.organizationId,
          createdAt: schema.Subpart.createdAt,
          updatedAt: schema.Subpart.updatedAt,
          childPart: {
            id: schema.Part.id,
            title: schema.Part.title,
            description: schema.Part.description,
            organizationId: schema.Part.organizationId,
            createdAt: schema.Part.createdAt,
            updatedAt: schema.Part.updatedAt,
          },
        })
        .from(schema.Subpart)
        .leftJoin(schema.Part, eq(schema.Subpart.childPartId, schema.Part.id))
        .where(eq(schema.Subpart.parentPartId, parentPartId))
        .orderBy(asc(schema.Part.title))

      return subparts
    }),

  byId: protectedProcedure
    .input(z.object({ parentPartId: z.string(), childPartId: z.string() })) // Expecting both parentId and subpartId
    .query(async ({ ctx, input }) => {
      // const { organizationId } = ctx.session

      const { parentPartId, childPartId } = input

      const [subpart] = await db
        .select({
          id: schema.Subpart.id,
          parentPartId: schema.Subpart.parentPartId,
          childPartId: schema.Subpart.childPartId,
          quantity: schema.Subpart.quantity,
          notes: schema.Subpart.notes,
          organizationId: schema.Subpart.organizationId,
          createdAt: schema.Subpart.createdAt,
          updatedAt: schema.Subpart.updatedAt,
          childPart: {
            id: schema.Part.id,
            title: schema.Part.title,
            description: schema.Part.description,
          },
        })
        .from(schema.Subpart)
        .leftJoin(schema.Part, eq(schema.Subpart.childPartId, schema.Part.id))
        .where(
          and(
            eq(schema.Subpart.parentPartId, parentPartId),
            eq(schema.Subpart.childPartId, childPartId)
          )
        )
        .limit(1)

      if (!subpart) {
        return NextResponse.json({ error: 'Subpart relationship not found' }, { status: 404 })
      }
      return { subpart }
    }),

  create: protectedProcedure
    .input(
      z.object({
        parentPartId: z.string().min(1),
        childPartId: z.string().min(1),
        quantity: z.number().min(1), // Ensure quantity is a positive number
        notes: z.string().optional(), // Optional notes for the subpart
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // const userId = ctx.session.user.id
      // const organizationId = ctx.session.user.defaultOrganizationId
      // if (!userId || !organizationId) {
      //   return { error: 'Unauthorized' }
      // }

      const { parentPartId, childPartId, quantity, notes } = input
      // const parentId = input.parentPartId

      // Check if parent part exists
      const [parentPart] = await db
        .select()
        .from(schema.Part)
        .where(
          and(eq(schema.Part.organizationId, organizationId), eq(schema.Part.id, parentPartId))
        )
        .limit(1)

      if (!parentPart) {
        return NextResponse.json({ error: 'Parent part not found' }, { status: 404 })
      }

      // Check if subpart exists
      const [subPart] = await db
        .select()
        .from(schema.Part)
        .where(eq(schema.Part.id, childPartId))
        .limit(1)

      if (!subPart) {
        return NextResponse.json({ error: 'Subpart not found' }, { status: 404 })
      }

      // Check if trying to add the part to itself
      if (parentPartId === childPartId) {
        return NextResponse.json({ error: 'A part cannot be a subpart of itself' }, { status: 400 })
      }

      // Check if the relationship already exists
      const [existingRelation] = await db
        .select()
        .from(schema.Subpart)
        .where(
          and(
            eq(schema.Subpart.parentPartId, parentPartId),
            eq(schema.Subpart.childPartId, childPartId)
          )
        )
        .limit(1)

      if (existingRelation) {
        return NextResponse.json(
          { error: 'This subpart is already associated with this part' },
          { status: 400 }
        )
      }

      // Create the subpart relationship
      const [subpart] = await db
        .insert(schema.Subpart)
        .values({
          organizationId,
          parentPartId,
          childPartId,
          quantity,
          notes,
          updatedAt: new Date(),
        })
        .returning()

      // Get the subpart with child part details
      const [subpartWithChild] = await db
        .select({
          id: schema.Subpart.id,
          parentPartId: schema.Subpart.parentPartId,
          childPartId: schema.Subpart.childPartId,
          quantity: schema.Subpart.quantity,
          notes: schema.Subpart.notes,
          organizationId: schema.Subpart.organizationId,
          createdAt: schema.Subpart.createdAt,
          updatedAt: schema.Subpart.updatedAt,
          childPart: {
            id: schema.Part.id,
            title: schema.Part.title,
            description: schema.Part.description,
          },
        })
        .from(schema.Subpart)
        .leftJoin(schema.Part, eq(schema.Subpart.childPartId, schema.Part.id))
        .where(eq(schema.Subpart.id, subpart.id))
        .limit(1)

      await recalculateAffectedParts(organizationId, [parentPartId])

      return { subpart: subpartWithChild }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1), // Parent part ID
        parentPartId: z.string().min(1),
        childPartId: z.string().min(1),
        quantity: z.number().min(1), // Ensure quantity is a positive number
        notes: z.string().optional(), // Optional notes for the subpart
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id, parentPartId, quantity, notes } = input
      // Validate the request
      if (!input.quantity || input.quantity <= 0) {
        return NextResponse.json({ error: 'Valid quantity is required' }, { status: 400 })
      }

      // Check if the relationship exists
      const [existingRelation] = await db
        .select()
        .from(schema.Subpart)
        .where(eq(schema.Subpart.id, id))
        .limit(1)

      if (!existingRelation) {
        logger.error('Subpart relationship not found')

        return NextResponse.json({ error: 'Subpart relationship not found' }, { status: 404 })
      }

      // Update the relationship
      const updateData: any = { quantity }
      if (notes !== undefined) {
        updateData.notes = notes
      }

      await db.update(schema.Subpart).set(updateData).where(eq(schema.Subpart.id, id))

      // Get the updated relationship with child part
      const [updatedRelation] = await db
        .select({
          id: schema.Subpart.id,
          parentPartId: schema.Subpart.parentPartId,
          childPartId: schema.Subpart.childPartId,
          quantity: schema.Subpart.quantity,
          notes: schema.Subpart.notes,
          organizationId: schema.Subpart.organizationId,
          createdAt: schema.Subpart.createdAt,
          updatedAt: schema.Subpart.updatedAt,
          childPart: {
            id: schema.Part.id,
            title: schema.Part.title,
            description: schema.Part.description,
          },
        })
        .from(schema.Subpart)
        .leftJoin(schema.Part, eq(schema.Subpart.childPartId, schema.Part.id))
        .where(eq(schema.Subpart.id, id))
        .limit(1)

      await recalculateAffectedParts(organizationId, [parentPartId])

      return { updatedRelation }
    }),
  delete: protectedProcedure
    .input(z.object({ parentPartId: z.string(), childPartId: z.string() })) // Expecting both parentId and subpartId
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { parentPartId, childPartId } = input

      // Check if the relationship exists
      const [existingRelation] = await db
        .select()
        .from(schema.Subpart)
        .where(
          and(
            eq(schema.Subpart.parentPartId, parentPartId),
            eq(schema.Subpart.childPartId, childPartId)
          )
        )
        .limit(1)

      if (!existingRelation) {
        logger.error('Existing subpart relationship found')
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Subpart relationship not found',
          // optional: pass the original error to retain stack trace
        })
      }

      // Delete the relationship
      await db
        .delete(schema.Subpart)
        .where(
          and(
            eq(schema.Subpart.parentPartId, parentPartId),
            eq(schema.Subpart.childPartId, childPartId)
          )
        )

      await recalculateAffectedParts(organizationId, [parentPartId])
      return { success: true }
    }),
})
