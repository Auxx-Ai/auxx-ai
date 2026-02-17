// ~/server/api/routers/contact.ts

import { ContactService } from '@auxx/lib/contacts'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const contactRouter = createTRPCRouter({
  // Get all contacts with filtering
  getAll: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(100),
        cursor: z.string().optional(),
        search: z.string().optional(),
        status: z.enum(['ACTIVE', 'INACTIVE', 'SPAM', 'MERGED']).optional(),
        groupId: z.string().optional(),
        includeCustomFields: z.boolean().optional().default(false),
        sortField: z.string().optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        // If custom fields requested, use the new method
        if (input.includeCustomFields) {
          return await contactService.getAllContactsWithCustomFields({
            limit: input.limit,
            cursor: input.cursor,
            search: input.search,
            status: input.status,
            groupId: input.groupId,
            sortField: input.sortField,
            sortDirection: input.sortDirection,
          })
        }

        return await contactService.getAllContacts({
          limit: input.limit,
          cursor: input.cursor,
          search: input.search,
          status: input.status,
          groupId: input.groupId,
          sortField: input.sortField,
          sortDirection: input.sortDirection,
        })
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Get a single contact by ID
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { organizationId, userId } = ctx.session
      const contactService = new ContactService(organizationId, userId)

      const contact = await contactService.getContactById(input.id)

      if (!contact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' })
      }

      return contact
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    }
  }),

  // Create a new contact
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.email(),
        phone: z.string().optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        sourceType: z.enum(['EMAIL', 'TICKET_SYSTEM', 'SHOPIFY', 'MANUAL', 'OTHER']),
        sourceId: z.string().optional(),
        sourceData: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.createContact(input)
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Update a contact
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.email().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['ACTIVE', 'INACTIVE', 'SPAM']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.updateContact(input)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Delete a contact
  deleteContact: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        // Attempt to delete the contact
        await contactService.deleteContact(input.id)
        return { success: true }
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Mark a contact as spam
  markAsSpam: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.markContactAsSpam(input.id)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Bulk mark contacts as spam
  bulkMarkAsSpam: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.bulkMarkAsSpam(input.ids)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Bulk delete contacts
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.bulkDeleteContacts(input.ids)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // TODO: Customer groups (getGroups, createGroup, updateGroup, addToGroup, removeFromGroup,
  // deleteGroup, getCustomerGroupsByIds) have been removed.
  // CustomerGroup/CustomerGroupMember tables are deleted.
  // Groups are now managed via EntityInstance + FieldValue (entity-group-member table).
  // Stub endpoints below return empty data to prevent client errors during migration.

  /** @deprecated CustomerGroup table deleted. Returns empty array. */
  getGroups: protectedProcedure
    .input(z.object({ search: z.string().optional() }))
    .query(async () => {
      return [] as Array<{ id: string; name: string; description?: string; color?: string }>
    }),

  /** @deprecated CustomerGroup table deleted. Returns stub. */
  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        initialMemberIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'UNIMPLEMENTED',
        message: 'Customer groups have been migrated to entity groups',
      })
    }),

  /** @deprecated CustomerGroup table deleted. */
  updateGroup: protectedProcedure
    .input(
      z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional() })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'UNIMPLEMENTED',
        message: 'Customer groups have been migrated to entity groups',
      })
    }),

  /** @deprecated CustomerGroup table deleted. */
  addToGroup: protectedProcedure
    .input(z.object({ groupId: z.string(), customerIds: z.array(z.string()) }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'UNIMPLEMENTED',
        message: 'Customer groups have been migrated to entity groups',
      })
    }),

  /** @deprecated CustomerGroup table deleted. */
  removeFromGroup: protectedProcedure
    .input(z.object({ groupId: z.string(), customerIds: z.array(z.string()) }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'UNIMPLEMENTED',
        message: 'Customer groups have been migrated to entity groups',
      })
    }),

  /** @deprecated CustomerGroup table deleted. */
  deleteGroup: protectedProcedure.input(z.object({ id: z.string() })).mutation(async () => {
    throw new TRPCError({
      code: 'UNIMPLEMENTED',
      message: 'Customer groups have been migrated to entity groups',
    })
  }),

  /** @deprecated CustomerGroup table deleted. Returns empty array. */
  getCustomerGroupsByIds: protectedProcedure
    .input(z.object({ customerIds: z.array(z.string()) }))
    .query(async () => {
      return [] as Array<{ id: string; members: Array<{ contactId: string }> }>
    }),
})
