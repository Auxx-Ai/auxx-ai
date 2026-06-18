// apps/web/src/server/api/routers/credentials.ts

import { CredentialTypeRegistry } from '@auxx/credentials'
import {
  deleteCredential,
  getCredential,
  insertCredential,
  listCredentials,
  mergeSecrets,
  splitSensitiveFields,
  updateCredential,
} from '@auxx/credentials/store'
import { CredentialTestingService, isCredentialInUse } from '@auxx/lib/workflow-engine'
import { handleOAuth2Callback, initiateOAuth, refreshCredentialTokens } from '@auxx/lib/workflows'
import { hasOAuth2Config } from '@auxx/workflow-nodes/types'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

// Singleton registry instance
const credentialRegistry = new CredentialTypeRegistry()

/** The four credential families (mirrors `CredentialKind` in @auxx/credentials). */
const credentialKindSchema = z.enum(['app', 'mcp', 'integration', 'workflow'])

/**
 * Consecutive refresh failures at which a connection's circuit breaker is
 * "open" — mirrors `CONNECTION_CIRCUIT_OPEN_THRESHOLD` in
 * `@auxx/services/app-connections`. At or above this, the credential is
 * surfaced as `expired` so a uniform status applies to every kind.
 */
const CONNECTION_CIRCUIT_OPEN_THRESHOLD = 5

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
        /**
         * Credential family to create under. Defaults to `workflow` so the
         * workflow-credentials UI keeps minting workflow creds; data connectors
         * pass `integration` for app-less sync secrets.
         */
        kind: credentialKindSchema.optional(),
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

      const { secrets, metadata } = splitSensitiveFields(input.data)
      const result = await insertCredential({
        organizationId: ctx.session.user.defaultOrganizationId,
        createdById: ctx.session.user.id,
        kind: input.kind ?? 'workflow',
        type: input.type,
        name: input.name,
        secrets,
        metadata,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return { id: result.value.id }
    }),

  /**
   * List all credentials for the organization
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.string().optional().describe('Filter by credential type'),
          /**
           * Credential family/families to list. Single value or a set (matched
           * with `IN`). Defaults to `workflow` so the workflow-credentials UI
           * keeps its current scope; pass e.g. `['integration','workflow']` to
           * widen (data connectors bind `integration`-kind credentials).
           */
          kind: z
            .union([credentialKindSchema, credentialKindSchema.array().min(1)])
            .optional()
            .describe('Filter by credential family'),
          /**
           * When true, only org-scoped (workspace) connections are returned —
           * personal/user-scoped creds are excluded. Background resources like
           * data connectors must bind org-scoped creds so they don't break for
           * other users.
           */
          orgScopedOnly: z.boolean().optional(),
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

      const result = await listCredentials({
        organizationId: ctx.session.user.defaultOrganizationId,
        kind: input?.kind ?? 'workflow',
        type: input?.type,
        // `userId: null` filters to org-scoped rows; omitting the key entirely
        // leaves user scope unfiltered (the workflow-credentials default).
        ...(input?.orgScopedOnly ? { userId: null } : {}),
        withCreatedBy: true,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      const now = new Date()
      return result.value.map((record) => {
        const expired =
          record.consecutiveRefreshFailures >= CONNECTION_CIRCUIT_OPEN_THRESHOLD ||
          (record.expiresAt !== null && record.expiresAt < now)
        return {
          id: record.id,
          name: record.name,
          type: record.type ?? '',
          kind: record.kind,
          label: record.label,
          appId: record.appId,
          appInstallationId: record.appInstallationId,
          // user-scoped vs org-scoped — reconnect picks the matching connection
          // definition by scope (05c §2).
          scope: record.userId ? ('user' as const) : ('organization' as const),
          status: expired ? ('expired' as const) : ('connected' as const),
          createdAt: record.createdAt,
          createdBy: { name: record.createdByName },
        }
      })
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

      const result = await getCredential(input.id, ctx.session.user.defaultOrganizationId)

      if (result.isErr()) {
        throw new TRPCError({
          code:
            result.error.code === 'CREDENTIAL_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message:
            result.error.code === 'CREDENTIAL_NOT_FOUND'
              ? 'Credential not found'
              : result.error.message,
        })
      }

      return {
        id: result.value.id,
        name: result.value.name,
        type: result.value.type ?? '',
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

      const result = await getCredential(input.id, ctx.session.user.defaultOrganizationId)

      if (result.isErr()) {
        throw new TRPCError({
          code:
            result.error.code === 'CREDENTIAL_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message:
            result.error.code === 'CREDENTIAL_NOT_FOUND'
              ? 'Credential not found'
              : result.error.message,
        })
      }

      const record = result.value
      return {
        info: {
          id: record.id,
          name: record.name,
          type: record.type ?? '',
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
        // The plaintext metadata column IS the non-sensitive half of the credential.
        nonSensitiveData: record.metadata,
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

      const organizationId = ctx.session.user.defaultOrganizationId
      const { secrets, metadata } = input.data
        ? splitSensitiveFields(input.data)
        : { secrets: {}, metadata: undefined }

      const updateResult = await updateCredential(input.id, organizationId, {
        name: input.name,
        metadata,
      })
      if (updateResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: updateResult.error.message,
        })
      }

      // mergeSecrets keeps existing values for blank fields, so an edit form
      // that leaves a password empty never wipes the stored secret.
      if (Object.keys(secrets).length > 0) {
        const mergeResult = await mergeSecrets(input.id, organizationId, secrets)
        if (mergeResult.isErr()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: mergeResult.error.message,
          })
        }
      }

      return { success: true }
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

      const organizationId = ctx.session.user.defaultOrganizationId

      if (await isCredentialInUse(input.id, organizationId)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Cannot delete credential: it is currently being used in workflows',
        })
      }

      const result = await deleteCredential(input.id, organizationId)
      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return { success: true }
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

        const result = await initiateOAuth(
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
        const result = await handleOAuth2Callback(input.code, input.state)

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
        const result = await refreshCredentialTokens(
          input.credentialId,
          ctx.session.user.defaultOrganizationId
        )

        if (!result.success) {
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
