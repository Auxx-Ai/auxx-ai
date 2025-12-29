// src/server/api/routers/googleOAuth.ts
// TODO: DELETE
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { google } from 'googleapis'
import { env, WEBAPP_URL } from '@auxx/config/server'
import { database as db } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('google-oauth')

export const googleOAuthRouter = createTRPCRouter({
  // Get the authorization URL for Google OAuth
  getAuthUrl: protectedProcedure
    .input(
      z.object({ scopes: z.array(z.string()).optional(), redirectPath: z.string().optional() })
    )
    .query(async ({ input, ctx }) => {
      try {
        // Verify user has admin role
        const isAdmin = false
        const organizationId = ctx.session.user.defaultOrganizationId
        // Verify user has admin role
        if (!isAdmin || !organizationId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only administrators can view integration status',
          })
        }

        // Create OAuth client
        const oauth2Client = new google.auth.OAuth2(
          env.GOOGLE_CLIENT_ID,
          env.GOOGLE_CLIENT_SECRET,
          WEBAPP_URL + '/api/google/oauth2/callback'
        )

        // Define the scopes needed for Gmail and Admin operations
        const defaultScopes = [
          // Gmail API scopes
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.settings.basic',
          'https://www.googleapis.com/auth/gmail.settings.sharing',

          // Admin SDK scopes
          // 'https://www.googleapis.com/auth/admin.directory.domain',
          // 'https://www.googleapis.com/auth/admin.directory.customer',
          // 'https://www.googleapis.com/auth/admin.directory.user',
          // 'https://www.googleapis.com/auth/admin.directory.group',
          // 'https://www.googleapis.com/auth/apps.licensing',
        ]

        // Build the authorization URL
        const scopes = input.scopes || defaultScopes
        const url = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: scopes,
          prompt: 'consent', // Force to get refresh token
          // Store additional state to restore after callback
          state: JSON.stringify({
            userId: ctx.session.user.id,
            orgId: ctx.session.user.defaultOrganizationId,
            redirectPath: input.redirectPath || '/app/settings/google',
          }),
        })

        return { url }
      } catch (error) {
        logger.error('Error generating auth URL:', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to generate Google authentication URL',
        })
      }
    }),

  // Get current OAuth connection status
  getConnectionStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const isAdmin = false
      const organizationId = ctx.session.user.defaultOrganizationId
      // Verify user has admin role
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators can view integration status',
        })
      }

      // Get organization ID
      if (!organizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'User is not associated with an organization',
        })
      }

      // Find the integration for this organization
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, organizationId))
        .limit(1)

      if (!integration) {
        return { connected: false, email: null, domain: null, lastVerified: null }
      }

      // Test the connection by making a simple API call
      try {
        const oauth2Client = new google.auth.OAuth2(
          env.GOOGLE_CLIENT_ID,
          env.GOOGLE_CLIENT_SECRET,
          WEBAPP_URL + '/api/google/oauth2/callback'
        )

        oauth2Client.setCredentials({ refresh_token: integration.refreshToken })

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
        const profile = await gmail.users.getProfile({ userId: 'me' })

        return {
          connected: true,
          email: profile.data.emailAddress,
          domain: profile.data.emailAddress?.split('@')[1] || null,
          lastVerified: new Date(),
        }
      } catch (error) {
        logger.error('Failed to verify Google connection:', { error })

        // If the token is invalid, mark as disconnected
        return {
          connected: false,
          email: integration.email,
          domain: integration.routingDomain,
          lastVerified: integration.updatedAt,
          error: 'Connection failed. Please reconnect your Google Workspace account.',
        }
      }
    } catch (error) {
      logger.error('Error checking connection status:', { error })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to check Google Workspace connection status',
      })
    }
  }),

  // Disconnect Google Workspace integration
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const isAdmin = false
      const organizationId = ctx.session.user.defaultOrganizationId
      // Verify user has admin role
      if (!isAdmin || !organizationId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators can view integration status',
        })
      }

      // Find the integration
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, organizationId))
        .limit(1)

      if (!integration) {
        return { success: true } // Already disconnected
      }

      // If there's active email routing, disable it first
      if (integration.routingEnabled && integration.routingId) {
        try {
          const oauth2Client = new google.auth.OAuth2(
            env.GOOGLE_CLIENT_ID,
            env.GOOGLE_CLIENT_SECRET,
            WEBAPP_URL + '/api/google/oauth2/callback'
          )

          oauth2Client.setCredentials({ refresh_token: integration.refreshToken })

          // Initialize the Admin SDK API
          const admin = google.admin({ version: 'directory_v1', auth: oauth2Client })

          // Delete the routing rule if it exists
          await admin.customers.settings.mail.routingSettings.delete({
            name: `customers/${integration.customerId}/settings/mail/routingSettings/${integration.routingId}`,
          })
        } catch (error) {
          logger.error('Failed to remove routing rule:', { error })
          // Continue with disconnection even if routing removal fails
        }
      }

      // Delete the integration
      await db.delete(schema.Integration).where(eq(schema.Integration.id, integration.id))

      return { success: true }
    } catch (error) {
      logger.error('Error disconnecting Google Workspace:', { error })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to disconnect Google Workspace integration',
      })
    }
  }),
})
