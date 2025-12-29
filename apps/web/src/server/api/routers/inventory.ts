import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { schema } from '@auxx/database'
import { and, eq, lt, asc } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('api-inventory')
export const inventoryRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()
  create: protectedProcedure
    .input(
      z.object({
        partId: z.string().min(1), // Ensure partId is a non-empty string
        quantity: z.number().nullable(), // Inventory details
        location: z.string().nullable(), // Optional location
        reorderPoint: z.number().nullable(), // Optional reorder point
        reorderQty: z.number().nullable(), // Optional reorder quantity
      })
    )
    .mutation(async ({ ctx, input }) => {
      // const userId = ctx.session.user.id
      const { organizationId } = ctx.session
      const { partId, quantity, location, reorderPoint, reorderQty } = input
      // Check if part exists
      const [part] = await ctx.db
        .select()
        .from(schema.Part)
        .where(and(eq(schema.Part.organizationId, organizationId), eq(schema.Part.id, partId)))
        .limit(1)
      if (!part) {
        return NextResponse.json({ error: 'Part not found' }, { status: 404 })
      }
      // Check if inventory already exists for this part
      const [existingInventory] = await ctx.db
        .select({ id: schema.Inventory.id })
        .from(schema.Inventory)
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            eq(schema.Inventory.partId, partId)
          )
        )
        .limit(1)
      if (existingInventory) {
        return NextResponse.json(
          { error: 'Inventory already exists for this part' },
          { status: 400 }
        )
      }
      // Create new inventory
      const [inv] = await ctx.db
        .insert(schema.Inventory)
        .values({
          organizationId,
          partId,
          quantity: quantity ?? 0, // Default to 0 if not provided
          location: location ?? '', // Default to empty string if not provided
          reorderPoint: reorderPoint ?? 0, // Default to 0 if not provided
          reorderQty: reorderQty ?? 0, // Default to 0 if not provided
          updatedAt: new Date(),
        })
        .returning()

      return { inventory: { ...inv, part } }
    }),

  all: protectedProcedure
    .input(
      z.object({
        query: z
          .object({
            lowStock: z.string().optional(), // Optional search name
            location: z.string().optional(), // Optional search contact name
          })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // const userId = ctx.session.user.id
      // if (!userId) {
      //   return { error: 'Unauthorized' }
      // }
      const { lowStock, location } = input.query || {}

      const rows = await ctx.db
        .select({
          inv: {
            id: schema.Inventory.id,
            organizationId: schema.Inventory.organizationId,
            partId: schema.Inventory.partId,
            quantity: schema.Inventory.quantity,
            location: schema.Inventory.location,
            reorderPoint: schema.Inventory.reorderPoint,
            reorderQty: schema.Inventory.reorderQty,
            createdAt: schema.Inventory.createdAt,
            updatedAt: schema.Inventory.updatedAt,
          },
          part: {
            id: schema.Part.id,
            title: schema.Part.title,
            sku: schema.Part.sku,
            description: schema.Part.description,
            category: schema.Part.category,
          },
        })
        .from(schema.Inventory)
        .innerJoin(schema.Part, eq(schema.Inventory.partId, schema.Part.id))
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            ...(lowStock === 'true'
              ? [lt(schema.Inventory.quantity, schema.Inventory.reorderPoint)]
              : []),
            ...(location ? [eq(schema.Inventory.location, location)] : [])
          )
        )
        .orderBy(asc(schema.Part.title))

      const inventory = rows.map((r) => ({ ...r.inv, part: r.part }))
      return { inventory }
    }),

  byId: protectedProcedure
    .input(z.object({ partId: z.string() })) // Expecting both parentId and subpartId
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // const userId = ctx.session.user.id
      // if (!userId) {
      //   return { error: 'Unauthorized' }
      // }
      const { partId } = input
      // Check if part exists
      const [part] = await ctx.db
        .select()
        .from(schema.Part)
        .where(and(eq(schema.Part.organizationId, organizationId), eq(schema.Part.id, partId)))
        .limit(1)

      if (!part) {
        return NextResponse.json({ error: 'Part not found' }, { status: 404 })
      }

      // Get the inventory
      const [inventoryRow] = await ctx.db
        .select()
        .from(schema.Inventory)
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            eq(schema.Inventory.partId, partId)
          )
        )
        .limit(1)

      if (!inventoryRow) {
        // Return a zero inventory if none exists
        return NextResponse.json({ partId, quantity: 0, part })
      }

      return { inventory: { ...inventoryRow, part } }

      // const { id: parentId, subpartId } = params
    }),
  updateQty: protectedProcedure
    .input(
      z.object({
        updates: z.array(
          z.object({
            partId: z.string().min(1), // Ensure partId is a non-empty string
            quantity: z.number().positive().optional(), // Ensure quantity is a positive number
            adjust: z.number().optional(), // Optional adjustment amount
          })
        ),
      }) // Ensure quantity is a positive number
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // const userId = ctx.session.user.id
      // if (!userId) {
      //   return { error: 'Unauthorized' }
      // }
      const { updates } = input

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return NextResponse.json({ error: 'Invalid or missing inventory updates' }, { status: 400 })
      }

      // Process each update
      const results = await Promise.all(
        updates.map(async (update) => {
          const { partId, quantity, adjust } = update

          if (!partId || (quantity === undefined && adjust === undefined)) {
            return { partId, success: false, message: 'Missing required fields' }
          }

          try {
            // Find the current inventory
            const [inventory] = await ctx.db
              .select()
              .from(schema.Inventory)
              .where(
                and(
                  eq(schema.Inventory.organizationId, organizationId),
                  eq(schema.Inventory.partId, partId)
                )
              )
              .limit(1)

            if (!inventory) {
              // Create new inventory if it doesn't exist
              if (quantity !== undefined) {
                const [newInventory] = await ctx.db
                  .insert(schema.Inventory)
                  .values({ organizationId, partId, quantity, updatedAt: new Date() })
                  .returning()
                return { partId, success: true, inventory: newInventory }
              } else {
                return {
                  partId,
                  success: false,
                  message: 'Inventory does not exist and adjustment requested',
                }
              }
            }

            // Update the inventory
            let newQuantity
            if (quantity !== undefined) {
              // Set to specific quantity
              newQuantity = quantity
            } else if (adjust !== undefined) {
              // Adjust by amount (can be positive or negative)
              newQuantity = inventory.quantity + adjust

              // Don't allow negative inventory
              if (newQuantity < 0) {
                newQuantity = 0
              }
            }

            const [updatedInventory] = await ctx.db
              .update(schema.Inventory)
              .set({ quantity: newQuantity, updatedAt: new Date() })
              .where(
                and(
                  eq(schema.Inventory.organizationId, organizationId),
                  eq(schema.Inventory.partId, partId)
                )
              )
              .returning()

            return { partId, success: true, inventory: updatedInventory }
          } catch (error) {
            logger.error(`Error updating inventory for part ${partId}:`, { error })
            return { partId, success: false, message: 'Database error' }
          }
        })
      )

      return { results }

      // const { id: parentId, subpartId } = params
    }),
  update: protectedProcedure
    .input(
      z.object({
        partId: z.string(),
        quantity: z.number().optional(), // Ensure quantity is a positive number
        adjust: z.number().optional(), // Optional adjustment amount
        location: z.string().optional(), // Optional location
        reorderPoint: z.number().optional().nullable(), // Optional reorder point
        reorderQty: z.number().optional().nullable(), // Optional reorder quantity})
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // const userId = ctx.session.user.id
      // if (!userId) {
      //   return { error: 'Unauthorized' }
      // }

      // const partId = params.partId;
      // const body = await request.json();
      const { partId, quantity, location, reorderPoint, reorderQty, adjust } = input

      // Check if part exists
      const [part] = await ctx.db
        .select()
        .from(schema.Part)
        .where(and(eq(schema.Part.organizationId, organizationId), eq(schema.Part.id, partId)))
        .limit(1)

      if (!part) {
        return NextResponse.json({ error: 'Part not found' }, { status: 404 })
      }

      // Find existing inventory
      const [existingInventory] = await ctx.db
        .select()
        .from(schema.Inventory)
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            eq(schema.Inventory.partId, partId)
          )
        )
        .limit(1)

      // Determine the new quantity
      let newQuantity
      if (quantity !== undefined) {
        newQuantity = quantity
      } else if (adjust !== undefined && existingInventory) {
        newQuantity = existingInventory.quantity + adjust

        // Don't allow negative inventory
        if (newQuantity < 0) {
          newQuantity = 0
        }
      } else if (existingInventory) {
        newQuantity = existingInventory.quantity
      } else {
        newQuantity = 0
      }

      if (existingInventory) {
        // Update existing inventory
        const [updated] = await ctx.db
          .update(schema.Inventory)
          .set({
            quantity: newQuantity,
            ...(location !== undefined ? { location } : {}),
            ...(reorderPoint !== undefined ? { reorderPoint } : {}),
            ...(reorderQty !== undefined ? { reorderQty } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.Inventory.organizationId, organizationId),
              eq(schema.Inventory.partId, partId)
            )
          )
          .returning()
        return { inventory: { ...updated, part } }
      } else {
        // Create new inventory
        const [created] = await ctx.db
          .insert(schema.Inventory)
          .values({
            organizationId,
            partId,
            quantity: newQuantity,
            ...(location !== undefined ? { location } : {}),
            ...(reorderPoint !== undefined ? { reorderPoint } : {}),
            ...(reorderQty !== undefined ? { reorderQty } : {}),
            updatedAt: new Date(),
          })
          .returning()
        return { inventory: { ...created, part } }
      }
    }),
  delete: protectedProcedure
    .input(z.object({ partId: z.string() })) // Expecting partId}))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // const userId = ctx.session.user.id

      // if (!userId) {
      //   return { error: 'Unauthorized' }
      // }
      const partId = input.partId

      // Check if inventory exists
      const [inventory] = await ctx.db
        .select({ id: schema.Inventory.id })
        .from(schema.Inventory)
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            eq(schema.Inventory.partId, partId)
          )
        )
        .limit(1)

      if (!inventory) {
        return NextResponse.json({ error: 'Inventory not found' }, { status: 404 })
      }

      // Delete the inventory
      await ctx.db
        .delete(schema.Inventory)
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            eq(schema.Inventory.partId, partId)
          )
        )

      return NextResponse.json({ message: 'Inventory successfully deleted' })
      // return { file }
    }),
})
