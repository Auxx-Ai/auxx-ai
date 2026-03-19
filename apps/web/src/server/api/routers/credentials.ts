// apps/web/src/server/api/routers/credentials.ts

import { CredentialTypeRegistry } from '@auxx/credentials'
import { CredentialService, CredentialTestingService } from '@auxx/lib/workflow-engine'
import { OAuth2WorkflowService } from '@auxx/lib/workflows'
import { hasOAuth2Config } from '@auxx/workflow-nodes/types'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

// Singleton registry instance
const credentialRegistry = new CredentialTypeRegistry()

export const credentialsRouter = createTRPCRouter({
  /**
   * Create a new workflow credential
   */
  create: protectedProcedure
    .input(
      z.object({
        type: z.string().min(1, 'Credential type is required'),
        name: z.string().min(1, 'Credential name is required'),
        data: z.record(z.string(), z.any()).describe('Credential data (API keys, tokens, etc.)'),
      })
    )
    .use(notDemo('create credentials'))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const credentialId = await CredentialService.saveCredential(
          ctx.session.user.defaultOrganizationId,
          ctx.session.user.id,
          input.type,
          input.name,
          input.data
        )

        return { id: credentialId }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create credential',
        })
      }
    }),

  /**
   * List all credentials for the organization
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.string().optional().describe('Filter by credential type'),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const credentials = await CredentialService.listCredentials(
          ctx.session.user.defaultOrganizationId,
          input?.type
        )

        return credentials
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list credentials',
        })
      }
    }),

  /**
   * Get credential info (without decrypted data)
   */
  getInfo: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Credential ID is required'),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const credentialInfo = await CredentialService.getCredentialInfo(
          input.id,
          ctx.session.user.defaultOrganizationId
        )

        if (!credentialInfo) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Credential not found',
          })
        }

        return credentialInfo
      } catch (error) {
        if (error instanceof TRPCError) throw error

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get credential info',
        })
      }
    }),

  /**
   * Get non-sensitive credential data for editing
   */
  getNonSensitiveData: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Credential ID is required'),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const result = await CredentialService.getNonSensitiveCredentialData(
          input.id,
          ctx.session.user.defaultOrganizationId
        )

        if (!result) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Credential not found',
          })
        }

        return result
      } catch (error) {
        if (error instanceof TRPCError) throw error

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get credential data',
        })
      }
    }),

  /**
   * Update a credential
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Credential ID is required'),
        name: z.string().min(1).optional(),
        data: z.record(z.string(), z.any()).optional(),
      })
    )
    .use(notDemo('update credentials'))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      if (!input.name && !input.data) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one field (name or data) must be provided for update',
        })
      }

      try {
        await CredentialService.updateCredential(
          input.id,
          ctx.session.user.defaultOrganizationId,
          ctx.session.user.id,
          {
            name: input.name,
            data: input.data,
          }
        )

        return { success: true }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update credential',
        })
      }
    }),

  /**
   * Delete a credential
   */
  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Credential ID is required'),
      })
    )
    .use(notDemo('delete credentials'))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        await CredentialService.deleteCredential(
          input.id,
          ctx.session.user.defaultOrganizationId,
          ctx.session.user.id
        )

        return { success: true }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to delete credential',
        })
      }
    }),

  /**
   * Test a credential (validate it works with the external service)
   */
  test: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Credential ID is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const testResult = await CredentialTestingService.testCredential(
          input.id,
          ctx.session.user.defaultOrganizationId
        )

        return testResult
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to test credential',
        })
      }
    }),

  /**
   * Test credential data before saving (for validation during creation/editing)
   */
  testData: protectedProcedure
    .input(
      z.object({
        type: z.string().min(1, 'Credential type is required'),
        data: z.record(z.string(), z.any()).describe('Credential data to test'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const testResult = await CredentialTestingService.testCredentialData(
          input.type,
          input.data,
          ctx.session.user.defaultOrganizationId
        )

        return testResult
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to test credential data',
        })
      }
    }),

  /**
   * Initiate OAuth2 flow for a credential type
   */
  initiateOAuth: protectedProcedure
    .input(
      z.object({
        credentialType: z.string().min(1, 'Credential type is required'),
        credentialName: z.string().min(1, 'Credential name is required'),
      })
    )
    .use(notDemo('connect OAuth credentials'))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        // Get the credential type class to check if it supports OAuth2
        const credentialTypeClass = credentialRegistry.getProvider(input.credentialType)

        if (!credentialTypeClass || !hasOAuth2Config(credentialTypeClass)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Credential type does not support OAuth2',
          })
        }

        const oauth2Service = OAuth2WorkflowService.getInstance()

        const result = await oauth2Service.initiateOAuth(
          credentialTypeClass.oauth2Config,
          ctx.session.user.defaultOrganizationId,
          ctx.session.user.id,
          input.credentialType,
          input.credentialName
        )

        return result
      } catch (error) {
        if (error instanceof TRPCError) throw error

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to initiate OAuth flow',
        })
      }
    }),

  /**
   * Handle OAuth2 callback and create credential
   */
  handleOAuthCallback: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1, 'Authorization code is required'),
        state: z.string().min(1, 'State parameter is required'),
      })
    )
    .use(notDemo('complete OAuth connection'))
    .mutation(async ({ input }) => {
      try {
        const oauth2Service = OAuth2WorkflowService.getInstance()
        const result = await oauth2Service.handleCallback(input.code, input.state)

        if (!result.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: result.error || 'OAuth callback failed',
          })
        }

        return result
      } catch (error) {
        if (error instanceof TRPCError) throw error

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to handle OAuth callback',
        })
      }
    }),

  /**
   * Refresh OAuth2 tokens for a credential
   */
  refreshOAuthTokens: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().min(1, 'Credential ID is required'),
      })
    )
    .use(notDemo('refresh OAuth tokens'))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.defaultOrganizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No organization selected',
        })
      }

      try {
        const oauth2Service = OAuth2WorkflowService.getInstance()
        const success = await oauth2Service.refreshTokens(
          input.credentialId,
          ctx.session.user.defaultOrganizationId
        )

        if (!success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to refresh tokens',
          })
        }

        return { success: true }
      } catch (error) {
        if (error instanceof TRPCError) throw error

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to refresh OAuth tokens',
        })
      }
    }),
})
