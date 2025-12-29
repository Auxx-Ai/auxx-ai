// src/server/api/routers/widget.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'
import { widgetSchema } from '@auxx/lib/widgets/types'
import { database as db, schema } from '@auxx/database'
import { and, eq, desc, exists } from 'drizzle-orm'

const logger = createScopedLogger('widget-router')

/**
 * Router for handling chat widget functionality
 */
export const widgetRouter = createTRPCRouter({
  /**
   * Get a widget by ID
   */
  getWidget: protectedProcedure
    .input(z.object({ widgetId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const [widget] = await db
          .select()
          .from(schema.ChatWidget)
          .where(
            and(
              eq(schema.ChatWidget.id, input.widgetId),
              exists(
                db
                  .select()
                  .from(schema.OrganizationMember)
                  .where(
                    and(
                      eq(schema.OrganizationMember.organizationId, schema.ChatWidget.organizationId),
                      eq(schema.OrganizationMember.userId, ctx.session.user.id)
                    )
                  )
              )
            )
          )
          .limit(1)

        if (!widget) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat widget not found' })
        }

        return widget
      } catch (error) {
        logger.error('Failed to get widget', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get widget' })
      }
    }),

  /**
   * Get all widgets for the current user's organization
   */
  getWidgets: protectedProcedure.query(async ({ ctx }) => {
    try {
      // Get the user's current organization ID
      const [member] = await db
        .select({ organizationId: schema.OrganizationMember.organizationId })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.userId, ctx.session.user.id))
        .limit(1)

      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You need to be part of an organization',
        })
      }

      const widgets = await db
        .select()
        .from(schema.ChatWidget)
        .where(eq(schema.ChatWidget.organizationId, member.organizationId))
        .orderBy(desc(schema.ChatWidget.createdAt))

      return widgets
    } catch (error) {
      logger.error('Failed to get widgets', { error })

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get widgets' })
    }
  }),

  /**
   * Save (create or update) a widget
   */
  saveWidget: protectedProcedure.input(widgetSchema).mutation(async ({ ctx, input }) => {
    try {
      // Get the user's current organization ID
      const [member] = await db
        .select({ organizationId: schema.OrganizationMember.organizationId })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.userId, ctx.session.user.id))
        .limit(1)

      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You need to be part of an organization',
        })
      }

      // Prepare data for create/update
      const widgetData = {
        name: input.name,
        description: input.description,
        isActive: input.isActive,
        title: input.title,
        subtitle: input.subtitle,
        primaryColor: input.primaryColor,
        logoUrl: input.logoUrl,
        position: input.position,
        welcomeMessage: input.welcomeMessage,
        autoOpen: input.autoOpen,
        mobileFullScreen: input.mobileFullScreen,
        collectUserInfo: input.collectUserInfo,
        offlineMessage: input.offlineMessage,
        allowedDomains: input.allowedDomains,
        useAi: input.useAi,
        aiModel: input.aiModel,
        aiInstructions: input.aiInstructions,
      }

      let widget
      if (input.id) {
        // Update existing widget
        // First, check if widget exists and belongs to the user's organization
        const [existingWidget] = await db
          .select()
          .from(schema.ChatWidget)
          .where(
            and(
              eq(schema.ChatWidget.id, input.id),
              eq(schema.ChatWidget.organizationId, member.organizationId)
            )
          )
          .limit(1)

        if (!existingWidget) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Widget not found or you do not have permission to edit it',
          })
        }

        const [updatedWidget] = await db
          .update(schema.ChatWidget)
          .set(widgetData)
          .where(eq(schema.ChatWidget.id, input.id))
          .returning()

        widget = updatedWidget
      } else {
        // Create new widget
        const [createdWidget] = await db
          .insert(schema.ChatWidget)
          .values({ ...widgetData, organizationId: member.organizationId })
          .returning()

        widget = createdWidget
      }

      return widget
    } catch (error) {
      logger.error('Failed to save widget', { error, input })

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save widget' })
    }
  }),

  /**
   * Delete a widget
   */
  deleteWidget: protectedProcedure
    .input(z.object({ widgetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Get the user's current organization ID
        const [member] = await db
          .select({ organizationId: schema.OrganizationMember.organizationId })
          .from(schema.OrganizationMember)
          .where(eq(schema.OrganizationMember.userId, ctx.session.user.id))
          .limit(1)

        if (!member) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You need to be part of an organization',
          })
        }

        // Check if widget exists and belongs to the user's organization
        const [widget] = await db
          .select()
          .from(schema.ChatWidget)
          .where(
            and(
              eq(schema.ChatWidget.id, input.widgetId),
              eq(schema.ChatWidget.organizationId, member.organizationId)
            )
          )
          .limit(1)

        if (!widget) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Widget not found or you do not have permission to delete it',
          })
        }

        // Delete widget
        await db
          .delete(schema.ChatWidget)
          .where(eq(schema.ChatWidget.id, input.widgetId))

        return { success: true }
      } catch (error) {
        logger.error('Failed to delete widget', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete widget' })
      }
    }),

  /**
   * Initialize a new chat session from an embedded widget
   */
  initializeChat: publicProcedure
    .input(
      z.object({
        widgetId: z.string(),
        visitorId: z.string().optional(),
        userAgent: z.string().optional(),
        referrer: z.string().optional(),
        url: z.string().optional(),
        ipAddress: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Get the widget to check if it exists and is active
        const [widget] = await db
          .select({
            id: schema.ChatWidget.id,
            organizationId: schema.ChatWidget.organizationId,
            welcomeMessage: schema.ChatWidget.welcomeMessage,
            allowedDomains: schema.ChatWidget.allowedDomains,
          })
          .from(schema.ChatWidget)
          .where(
            and(
              eq(schema.ChatWidget.id, input.widgetId),
              eq(schema.ChatWidget.isActive, true)
            )
          )
          .limit(1)

        if (!widget) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Chat widget not found or is inactive',
          })
        }

        // Check domain restrictions if applicable
        if (input.url && widget.allowedDomains && widget.allowedDomains.length > 0) {
          try {
            const url = new URL(input.url)
            const domain = url.hostname

            const isAllowed = widget.allowedDomains.some(
              (allowedDomain) => domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
            )

            if (!isAllowed) {
              throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'This widget is not available on this domain',
              })
            }
          } catch (error: unknown) {
            // If URL parsing fails, continue (could be a local development environment)
            logger.warn('Failed to parse URL for domain check', { url: input.url })
          }
        }

        // Create a new chat session
        const [session] = await db
          .insert(schema.ChatSession)
          .values({
            widgetId: input.widgetId,
            organizationId: widget.organizationId,
            status: 'ACTIVE',
            visitorId: input.visitorId || crypto.randomUUID(),
            userAgent: input.userAgent,
            referrer: input.referrer,
            url: input.url,
            ipAddress: input.ipAddress,
            lastActivityAt: new Date(),
          })
          .returning()

        // Create welcome message if configured
        if (widget.welcomeMessage) {
          await db
            .insert(schema.ChatMessage)
            .values({
              sessionId: session.id,
              content: widget.welcomeMessage,
              sender: 'SYSTEM',
              status: 'DELIVERED',
            })
        }

        return { sessionId: session.id, visitorId: session.visitorId }
      } catch (error) {
        logger.error('Failed to initialize chat session', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initialize chat session',
        })
      }
    }),

  /**
   * Get widget installation code
   */
  getInstallationCode: protectedProcedure
    .input(z.object({ widgetId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        // Get the widget to check if it exists
        const [widget] = await db
          .select({
            id: schema.ChatWidget.id,
            organizationId: schema.ChatWidget.organizationId,
          })
          .from(schema.ChatWidget)
          .where(
            and(
              eq(schema.ChatWidget.id, input.widgetId),
              exists(
                db
                  .select()
                  .from(schema.OrganizationMember)
                  .where(
                    and(
                      eq(schema.OrganizationMember.organizationId, schema.ChatWidget.organizationId),
                      eq(schema.OrganizationMember.userId, ctx.session.user.id)
                    )
                  )
              )
            )
          )
          .limit(1)

        if (!widget) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat widget not found' })
        }

        // Generate installation script
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const script = `<script src="${baseUrl}/api/widget/${widget.organizationId}/${widget.id}"></script>`

        return { script }
      } catch (error) {
        logger.error('Failed to get installation code', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get installation code',
        })
      }
    }),
})
