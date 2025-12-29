// ~/server/api/routers/contact.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { ContactService } from '@auxx/lib/contacts'

export const contactRouter = createTRPCRouter({
  // Search contacts with a simple query
  search: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId } = ctx.session
        const contactService = new ContactService(organizationId, ctx.session.user.id)

        return await contactService.searchContacts({
          limit: input.limit,
          cursor: input.cursor,
          search: input.search,
        })
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

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

  // Get contacts by their IDs
  getCustomersByIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.getContactsByIds(input.ids)
      } catch (error: any) {
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

  // Merge contacts
  mergeCustomers: protectedProcedure
    .input(z.object({ primaryContactId: z.string(), customerIdsToMerge: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.mergeContacts({
          primaryContactId: input.primaryContactId,
          customerIdsToMerge: input.customerIdsToMerge,
        })
      } catch (error: any) {
        if (error.message.includes('Cannot merge')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Get customer groups
  getGroups: protectedProcedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.getCustomerGroups(input.search)
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Create a customer group
  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        initialMemberIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.createCustomerGroup(
          input.name,
          input.description,
          input.initialMemberIds
        )
      } catch (error: any) {
        if (error.message.includes('already exists')) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Update a customer group
  updateGroup: protectedProcedure
    .input(
      z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional() })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.updateCustomerGroup(input.id, {
          name: input.name,
          description: input.description,
        })
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Add contacts to a group
  addToGroup: protectedProcedure
    .input(z.object({ groupId: z.string(), customerIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.addToCustomerGroup(input.groupId, input.customerIds)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Remove contacts from a group
  removeFromGroup: protectedProcedure
    .input(z.object({ groupId: z.string(), customerIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.removeFromCustomerGroup(input.groupId, input.customerIds)
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Delete a customer group
  deleteGroup: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.deleteCustomerGroup(input.id)
      } catch (error: any) {
        if (error.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),

  // Get customer groups by contact IDs
  getCustomerGroupsByIds: protectedProcedure
    .input(z.object({ customerIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId, userId } = ctx.session
        const contactService = new ContactService(organizationId, userId)

        return await contactService.getCustomerGroupsByContactIds(input.customerIds)
      } catch (error: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
    }),
})
