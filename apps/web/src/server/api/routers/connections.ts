// apps/web/src/server/api/routers/connections.ts

import {
  deleteCredential,
  listCredentials,
  mergeSecrets,
  splitSensitiveFields,
  updateCredential,
} from '@auxx/credentials/store'
import { saveConnection } from '@auxx/lib/connections'
import { getAllProviders } from '@auxx/lib/connections/providers'
import { isAdminOrOwner } from '@auxx/lib/members'
import { getChannelProviderIcon } from '@auxx/lib/providers'
import { CredentialTestingService, isCredentialInUse } from '@auxx/lib/workflow-engine'
import { refreshCredentialTokens } from '@auxx/lib/workflows'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

/** The four credential families (mirrors `CredentialKind` in @auxx/credentials). */
const credentialKindSchema = z.enum(['app', 'mcp', 'integration', 'workflow'])

/**
 * Consecutive refresh failures at which a connection's circuit breaker is "open"
 * — mirrors `CONNECTION_CIRCUIT_OPEN_THRESHOLD` in
 * `@auxx/services/app-connections`. At or above this, the credential surfaces as
 * `expired` so a uniform status applies across every kind.
 */
const CONNECTION_CIRCUIT_OPEN_THRESHOLD = 5

/**
 * The single connection surface over the `Credential` table. Covers listing,
 * the non-OAuth *secret* connect (a single API key or a multi-field
 * `connectionVariables` form), editing, deleting, testing, and token refresh.
 * OAuth connects run through `/api/connections/[connectionDefinitionId]/oauth2/*`.
 */
export const connectionsRouter = createTRPCRouter({
  /**
   * Lists connections across kinds (`app | integration | workflow`). Default
   * (no input) — the Settings → Channels → Connections card grid: admins see all
   * org connections; members see their own + org-scoped ones. With input, the
   * picker narrows by `kind`/`type` and can force org-scoped rows only.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.string().optional().describe('Filter by provider type'),
          /** Connection family/families to list. Defaults to all bindable kinds. */
          kind: z
            .union([credentialKindSchema, credentialKindSchema.array().min(1)])
            .optional()
            .describe('Filter by connection family'),
          /**
           * When true, only org-scoped (workspace) connections are returned —
           * personal/user-scoped rows are excluded. Background resources like data
           * connectors must bind org-scoped connections so they don't break for
           * other users.
           */
          orgScopedOnly: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const isAdmin = await isAdminOrOwner(organizationId, ctx.session.user.id)
      const result = await listCredentials({
        organizationId,
        kind: input?.kind ?? ['app', 'integration', 'workflow'],
        type: input?.type,
        // `orgScopedOnly` forces `userId: null`; otherwise apply member visibility —
        // admins see everything, members see their own + org-scoped rows.
        ...(input?.orgScopedOnly
          ? { userId: null }
          : isAdmin
            ? {}
            : { ownedByOrOrgScoped: ctx.session.user.id }),
        withCreatedBy: true,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
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
          // Visual-ref for non-app rows: channel/integration creds store the provider
          // as `type` ('google', 'outlook', …) → resolve its brand mark. App rows leave
          // this null and hydrate the app's avatar client-side.
          icon: record.type ? getChannelProviderIcon(record.type) : null,
          appId: record.appId,
          appInstallationId: record.appInstallationId,
          scope: record.userId ? ('user' as const) : ('organization' as const),
          status: expired ? ('expired' as const) : ('connected' as const),
          createdAt: record.createdAt,
          createdBy: { name: record.createdByName },
        }
      })
    }),

  /**
   * Client-safe projection of the platform provider catalog (`getAllProviders()`)
   * for the "+ New connection" dialog. Each entry feeds `useConnectFlow` as a
   * `platform` owner — its `connectionDefinitionId` is the `providerKey` (the
   * OAuth route + `save` resolve a providerKey as the id).
   */
  listProviders: protectedProcedure.query(() =>
    getAllProviders().map((p) => ({
      providerKey: p.providerKey,
      label: p.label,
      description: p.description ?? null,
      connectionType: p.connectionType,
      global: p.global ?? false,
      connectionVariables: p.connectionVariables ?? [],
      icon: p.uiMetadata?.icon ?? null,
      category: p.uiMetadata?.category ?? null,
    }))
  ),

  /**
   * Persists a non-OAuth secret connection (a single API key, or a multi-field
   * `connectionVariables` form) via the unified `saveConnection`. Supports
   * reconnect by rotating an existing credential.
   */
  save: protectedProcedure
    .input(
      z.object({
        /** ConnectionDefinition id or platform providerKey (resolved either way). */
        connectionDefinitionId: z.string().min(1),
        /** Display name for the connection. */
        name: z.string().min(1),
        /** Multi-field connection-variable values (split by the def's secret flags). */
        values: z.record(z.string(), z.string()).optional(),
        /** Single API-key value (for definitions without connection variables). */
        secret: z.string().optional(),
        /** Reconnect: rotate the existing credential instead of inserting. */
        connectionId: z.string().optional(),
      })
    )
    .use(notDemo('save connection'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const def = await ctx.db.query.ConnectionDefinition.findFirst({
        where: (cd, { eq, or }) =>
          or(
            eq(cd.id, input.connectionDefinitionId),
            eq(cd.providerKey, input.connectionDefinitionId)
          ),
      })
      if (!def?.providerKey) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection definition not found' })
      }

      // Split the provided values by the definition's secret flags: secret-flagged values
      // encrypt under `secrets.fields`, plain ones ride in plaintext metadata.
      const secretKeys = new Set(
        (def.connectionVariables ?? []).filter((v) => v.secret).map((v) => v.key)
      )
      const secretFields: Record<string, string> = {}
      const plainVariables: Record<string, string> = {}
      for (const [key, value] of Object.entries(input.values ?? {})) {
        if (secretKeys.has(key)) secretFields[key] = value
        else plainVariables[key] = value
      }

      const result = await saveConnection({
        connectionDefinitionId: def.id,
        providerKey: def.providerKey,
        name: input.name,
        organizationId,
        createdById: ctx.session.user.id,
        // Scope follows the definition's `global` flag — the resolver queries the credential by it.
        userId: def.global ? null : ctx.session.user.id,
        connectionData: {
          ...(input.secret && { secret: input.secret }),
          ...(Object.keys(secretFields).length > 0 && { secretFields }),
          ...(Object.keys(plainVariables).length > 0 && {
            metadata: { connectionVariables: plainVariables },
          }),
        },
        ...(input.connectionId && { connectionId: input.connectionId }),
      })

      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      return { credentialId: result.value }
    }),

  /**
   * Update a connection's name and/or data.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Connection ID is required'),
        name: z.string().min(1).optional(),
        data: z.record(z.string(), z.any()).optional(),
      })
    )
    .use(notDemo('update connection'))
    .mutation(async ({ ctx, input }) => {
      if (!input.name && !input.data) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one field (name or data) must be provided for update',
        })
      }

      const { organizationId } = ctx.session
      const { secrets, metadata } = input.data
        ? splitSensitiveFields(input.data)
        : { secrets: {}, metadata: undefined }

      const updateResult = await updateCredential(input.id, organizationId, {
        name: input.name,
        metadata,
      })
      if (updateResult.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: updateResult.error.message })
      }

      // mergeSecrets keeps existing values for blank fields, so an edit form that
      // leaves a password empty never wipes the stored secret.
      if (Object.keys(secrets).length > 0) {
        const mergeResult = await mergeSecrets(input.id, organizationId, secrets)
        if (mergeResult.isErr()) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: mergeResult.error.message })
        }
      }

      return { success: true }
    }),

  /**
   * Delete a connection (errors if it's in use in workflows).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1, 'Connection ID is required') }))
    .use(notDemo('delete connection'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      if (await isCredentialInUse(input.id, organizationId)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Cannot delete connection: it is currently being used in workflows',
        })
      }

      const result = await deleteCredential(input.id, organizationId)
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      return { success: true }
    }),

  /**
   * Test a connection against its external service. Pass `credentialId` to test
   * a saved connection, or `type` + `data` to validate prospective values before
   * saving.
   */
  test: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        data: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        if (input.credentialId) {
          return await CredentialTestingService.testCredential(input.credentialId, organizationId)
        }
        if (input.type && input.data) {
          return await CredentialTestingService.testCredentialData(
            input.type,
            input.data,
            organizationId
          )
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provide either credentialId, or type and data',
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to test connection',
        })
      }
    }),

  /**
   * Refresh OAuth2 tokens for a connection.
   */
  refreshTokens: protectedProcedure
    .input(z.object({ credentialId: z.string().min(1, 'Connection ID is required') }))
    .use(notDemo('refresh connection tokens'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        const result = await refreshCredentialTokens(input.credentialId, organizationId)
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
          message: error instanceof Error ? error.message : 'Failed to refresh tokens',
        })
      }
    }),
})
