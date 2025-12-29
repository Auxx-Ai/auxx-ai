// server/api/routers/labels.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { getUserOrganizationId } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import { LabelService } from '@auxx/lib/email'
import { ReauthenticationRequiredError } from '@auxx/lib/email'

const logger = createScopedLogger('labels-router')

export const labelRouter = createTRPCRouter({
  // Get all labels for an integration
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  all: protectedProcedure
    .input(
      z
        .object({ integrationType: z.string().optional(), integrationId: z.string().optional() })
        .optional()
    )
    .query(async ({ ctx }) => {
      // const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const labels = await labelService.getAllLabels(organizationId)

        return { labels }
      } catch (error) {
        logger.error('Error getting all labels', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch labels' })
      }
    }),
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  getLabels: protectedProcedure
    .input(z.object({ integrationType: z.string(), integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const labels = await labelService.getLabels(
          organizationId,
          input.integrationType,
          input.integrationId
        )

        return labels
      } catch (error) {
        logger.error('Error getting labels', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch labels' })
      }
    }),

  // Note: integrationType parameter represents integration.provider (not removed schema field)
  syncAllLabels: protectedProcedure
    .input(
      z
        .object({ integrationType: z.string().optional(), integrationId: z.string().optional() })
        .optional()
    )
    .mutation(async ({ ctx }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)
      try {
        const labelService = new LabelService()
        const labels = await labelService.syncAllLabels(organizationId, userId)

        return labels
      } catch (error) {
        if (error instanceof ReauthenticationRequiredError) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: error.message })
        }

        logger.error('Error syncing all labels', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to sync all labels' })
      }
    }),
  // Sync labels from provider
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  syncLabels: protectedProcedure
    .input(z.object({ integrationType: z.string(), integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const labels = await labelService.syncLabels(
          organizationId,
          input.integrationType,
          input.integrationId,
          userId
        )

        return labels
      } catch (error) {
        logger.error('Error syncing labels', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to sync labels' })
      }
    }),

  // Create a new label
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  createLabel: protectedProcedure
    .input(
      z.object({
        integrationType: z.string(),
        integrationId: z.string(),
        name: z.string(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const label = await labelService.createLabel(
          organizationId,
          input.integrationType,
          input.integrationId,
          userId,
          {
            name: input.name,
            backgroundColor: input.backgroundColor,
            textColor: input.textColor,
            description: input.description,
          }
        )

        return label
      } catch (error) {
        logger.error('Error creating label', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create label' })
      }
    }),

  // Update a label
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  updateLabel: protectedProcedure
    .input(
      z.object({
        labelId: z.string(),
        integrationType: z.string(),
        integrationId: z.string(),
        name: z.string().optional(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
        description: z.string().optional(),
        isVisible: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const label = await labelService.updateLabel(
          input.labelId,
          organizationId,
          input.integrationType,
          input.integrationId,
          {
            name: input.name,
            backgroundColor: input.backgroundColor,
            textColor: input.textColor,
            description: input.description,
            isVisible: input.isVisible,
          }
        )

        return label
      } catch (error) {
        logger.error('Error updating label', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update label' })
      }
    }),

  // Delete a label
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  deleteLabel: protectedProcedure
    .input(
      z.object({ labelId: z.string(), integrationType: z.string(), integrationId: z.string() })
    )
    .mutation(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        await labelService.deleteLabel(
          input.labelId,
          organizationId,
          input.integrationType,
          input.integrationId
        )

        return { success: true }
      } catch (error) {
        logger.error('Error deleting label', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete label' })
      }
    }),

  // Add label to thread
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  addLabelToThread: protectedProcedure
    .input(
      z.object({
        labelId: z.string(),
        threadId: z.string(),
        integrationType: z.string(),
        integrationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const success = await labelService.addLabelToThread(
          input.labelId,
          input.threadId,
          organizationId,
          input.integrationType,
          input.integrationId
        )

        return { success }
      } catch (error) {
        logger.error('Error adding label to thread', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add label to thread',
        })
      }
    }),

  // Remove label from thread
  // Note: integrationType parameter represents integration.provider (not removed schema field)
  removeLabelFromThread: protectedProcedure
    .input(
      z.object({
        labelId: z.string(),
        threadId: z.string(),
        integrationType: z.string(),
        integrationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const success = await labelService.removeLabelFromThread(
          input.labelId,
          input.threadId,
          organizationId,
          input.integrationType,
          input.integrationId
        )

        return { success }
      } catch (error) {
        logger.error('Error removing label from thread', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove label from thread',
        })
      }
    }),

  // Get thread labels
  getThreadLabels: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      // const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const labels = await labelService.getThreadLabels(input.threadId)

        return labels
      } catch (error) {
        logger.error('Error getting thread labels', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get thread labels',
        })
      }
    }),

  toggleLabelVisibility: protectedProcedure
    .input(z.object({ labelId: z.string(), visible: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // const { userId } = ctx.session
      // const organizationId = getUserOrganizationId(ctx.session)

      try {
        const labelService = new LabelService()
        const label = await labelService.toggleLabelVisibility(input.labelId, input.visible)

        return label
      } catch (error) {
        logger.error('Error toggling label visibility', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update label visibility',
        })
      }
    }),
})
