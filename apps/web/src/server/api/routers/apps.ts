// apps/web/src/server/api/routers/apps.ts

import { isMasked, splitConnectionValues } from '@auxx/credentials/crypto'
import { setDefaultCredential } from '@auxx/credentials/store'
import type { Database } from '@auxx/database'
import {
  deleteAppConnection,
  getAppDeployments,
  getAppWithInstallationStatus,
  getAvailableApps,
  installApp,
  saveAppConnection,
} from '@auxx/lib/apps'
import { getCachedAppBySlug, getOrgCache, onCacheEvent } from '@auxx/lib/cache'
import { mintClientCredentialToken } from '@auxx/lib/connections'
import { resolveConnectorConfigOptions } from '@auxx/lib/data-connectors'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { resolveQuickActionOptions } from '@auxx/lib/quick-actions'
import { createScopedLogger } from '@auxx/logger'
import {
  getAppConnectionDefinition,
  getConnectionDefinitionById,
  listAppConnections,
  renameAppConnection,
} from '@auxx/services/app-connections'
import { getAppSettings, saveAppSettings, schemaToZod } from '@auxx/services/app-settings'
import {
  installAppRequestSchema,
  listAppsQuerySchema,
  listDeploymentsQuerySchema,
  listInstalledAppsQuerySchema,
  uninstallApp,
  uninstallAppRequestSchema,
} from '@auxx/services/apps'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { adminProcedure, createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('trpc-apps')

/**
 * Connection-scope gate: user-scoped credentials (Credential.userId set) are managed by their
 * owner; org-scoped ones (userId null) require admin.
 */
async function requireConnectionManageAccess(
  db: Database,
  session: { userId: string; organizationId: string },
  credentialId: string
): Promise<void> {
  const credential = await db.query.Credential.findFirst({
    where: (c, { and, eq }) =>
      and(eq(c.id, credentialId), eq(c.organizationId, session.organizationId)),
    columns: { userId: true },
  })
  if (!credential) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' })
  }
  if (credential.userId === session.userId) return
  if (!(await isAdminOrOwner(session.organizationId, session.userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can manage organization connections',
    })
  }
}

/**
 * Apps router
 * Provides tRPC procedures for app marketplace operations
 */
export const appsRouter = createTRPCRouter({
  /**
   * List all available apps for the organization
   * Includes both private dev apps and public marketplace apps
   */
  list: protectedProcedure.input(listAppsQuerySchema).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const { category, search, limit, offset } = input

    return getAvailableApps({
      organizationId,
      db: ctx.db,
      filters: {
        category,
        searchQuery: search,
      },
      pagination: {
        limit,
        offset,
      },
    })
  }),

  /**
   * List installed apps for the organization (cached)
   */
  listInstalled: protectedProcedure
    .input(listInstalledAppsQuerySchema)
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const orgCache = getOrgCache()
      const { installedApps } = await orgCache.getOrRecompute(organizationId, ['installedApps'])

      // Apply type filter if provided
      const filtered = input.type
        ? installedApps.filter((a) => a.installationType === input.type)
        : installedApps

      // Rehydrate dates for SuperJSON compatibility
      const installations = filtered.map((app) => ({
        ...app,
        installedAt: new Date(app.installedAt),
        currentDeployment: app.currentDeployment
          ? { ...app.currentDeployment, createdAt: new Date(app.currentDeployment.createdAt) }
          : null,
      }))

      return { installations }
    }),

  /**
   * Resolve the live options for a tool-backed `dynamic-select` field by running
   * an app tool in the sandbox and mapping its output. One generic procedure for
   * every option-picker surface — discriminated by `source`:
   *  - `entity`    → a quick-action input, scoped to a subject record (binds args
   *                  off the record's fields).
   *  - `connector` → a data-connector config field, scoped to the connector's own
   *                  bound connection (e.g. a repo picker).
   * Both share the generic app-tool resolver core in `@auxx/lib`.
   */
  resolveToolOptions: protectedProcedure
    .input(
      z.object({
        source: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('entity'),
            appId: z.string(),
            installationId: z.string(),
            actionId: z.string(),
            recordId: z.string(),
          }),
          z.object({ kind: z.literal('connector'), connectorId: z.string() }),
        ]),
        fieldKey: z.string(),
        query: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const organization = await ctx.db.query.Organization.findFirst({
        where: (orgs, { eq }) => eq(orgs.id, organizationId),
      })
      if (!organization?.handle) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
      }

      if (input.source.kind === 'connector') {
        return resolveConnectorConfigOptions({
          db: ctx.db,
          organizationId,
          organizationHandle: organization.handle,
          connectorId: input.source.connectorId,
          fieldKey: input.fieldKey,
          query: input.query,
        })
      }

      // entity (quick-action): validate the subject record belongs to the org
      // before binding args against it.
      const { recordId } = input.source
      const [, entityInstanceId] = recordId.split(':')
      if (!entityInstanceId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid recordId' })
      }
      const instance = await ctx.db.query.EntityInstance.findFirst({
        where: (rows, { eq, and }) =>
          and(eq(rows.id, entityInstanceId), eq(rows.organizationId, organizationId)),
        columns: { id: true },
      })
      if (!instance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' })
      }
      const user = await ctx.db.query.User.findFirst({
        where: (users, { eq }) => eq(users.id, userId),
      })
      return resolveQuickActionOptions({
        appId: input.source.appId,
        installationId: input.source.installationId,
        actionId: input.source.actionId,
        fieldKey: input.fieldKey,
        recordId,
        query: input.query,
        organizationId,
        organizationHandle: organization.handle,
        userId,
        userEmail: user?.email ?? '',
        userName: user?.name ?? '',
      })
    }),

  /**
   * Get app details with installation status
   */
  getBySlug: protectedProcedure
    .input(z.object({ appSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug } = input

      const result = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!result.ok) {
        const error = result.error
        logger.error('Failed to get app details', { error, appSlug, organizationId })

        throw new TRPCError({
          code: error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * Install an app (requires ADMIN or OWNER role)
   */
  install: adminProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(installAppRequestSchema)
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appSlug, type, deploymentId } = input

      // Resolve slug from cache
      const cachedApp = await getCachedAppBySlug(appSlug)
      if (!cachedApp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `App "${appSlug}" not found` })
      }

      // If the app is not verified, require the unverifiedApps feature gate.
      // Verified apps skip this check entirely.
      if (!cachedApp.verified) {
        await new FeaturePermissionService().requireAccess(
          organizationId,
          FeatureKey.unverifiedApps
        )
      }

      const result = await installApp({
        appId: cachedApp.id,
        organizationId,
        installationType: type!,
        deploymentId,
        installedById: userId,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to install app', { error, appSlug, organizationId })

        throw new TRPCError({
          code:
            error.code === 'APP_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'APP_ACCESS_DENIED'
                ? 'CONFLICT'
                : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      await onCacheEvent('app.installed', { orgId: organizationId })
      // Installation-scoped app fields were just provisioned — bust the
      // customFields cache now instead of waiting on its TTL, or a fresh
      // field can be unresolved by the @app: rail on the first write.
      await onCacheEvent('custom-field.created', { orgId: organizationId })

      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'app.installed',
        targetType: 'App',
        targetId: cachedApp.id,
        metadata: { appSlug, appName: cachedApp.title, installationType: type! },
      })

      return result.value
    }),

  /**
   * Uninstall an app (requires ADMIN or OWNER role)
   */
  uninstall: adminProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(uninstallAppRequestSchema)
    )
    .use(notDemo('uninstall apps'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appSlug, type } = input

      // Resolve slug from cache
      const cachedApp = await getCachedAppBySlug(appSlug)
      if (!cachedApp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `App "${appSlug}" not found` })
      }

      const result = await uninstallApp({
        appId: cachedApp.id,
        organizationId,
        uninstalledById: userId,
        installationType: type,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to uninstall app', { error, appSlug, organizationId })

        throw new TRPCError({
          code: error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      await onCacheEvent('app.uninstalled', { orgId: organizationId })

      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'app.uninstalled',
        targetType: 'App',
        targetId: cachedApp.id,
        metadata: { appSlug, appName: cachedApp.title, installationType: type },
      })

      return result.value
    }),

  /**
   * List available deployments for an app
   */
  listDeployments: protectedProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(listDeploymentsQuerySchema)
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, deploymentType, status } = input

      const result = await getAppDeployments({
        appSlug,
        organizationId,
        db: ctx.db,
        filters: {
          deploymentType,
          status,
        },
      })

      if (!result.ok) {
        const error = result.error
        logger.error('Failed to get app deployments', { error, appSlug, organizationId })

        throw new TRPCError({
          code: error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * List app connections for organization
   * Returns both user-specific and organization-wide connections
   */
  listConnections: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    // Don't pass userId to get all connections (both user and org-wide)
    const result = await listAppConnections(organizationId)

    if (result.isErr()) {
      logger.error('Failed to list app connections', {
        error: result.error,
        organizationId,
      })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: result.error.message,
      })
    }

    return result.value
  }),

  /**
   * Delete an app connection
   */
  deleteConnection: protectedProcedure
    .input(
      z.object({
        credentialId: z.string(),
      })
    )
    .use(notDemo('delete app connections'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { credentialId } = input

      await requireConnectionManageAccess(ctx.db, { userId, organizationId }, credentialId)

      const result = await deleteAppConnection(credentialId, organizationId)

      if (result.isErr()) {
        logger.error('Failed to delete app connection', {
          error: result.error,
          credentialId,
          organizationId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return { success: true }
    }),

  /**
   * Save secret-based connection. Definitions without connection variables take a single
   * `secret` (API key); definitions with variables take `values` keyed by variable key —
   * secret-flagged values are encrypted under `secrets.fields`, plain ones ride in metadata.
   */
  saveSecretConnection: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        installationId: z.string(),
        appName: z.string(),
        connectionType: z.enum(['user', 'organization']),
        /** User-chosen display name. Falls back to the deduped app name when omitted. */
        label: z.string().min(1).optional(),
        secret: z.string().min(1).optional(),
        values: z.record(z.string(), z.string()).optional(),
        connectionId: z.string().optional(),
        // The picked method (ConnectionDefinition.id). Sent by the connect flow when an app
        // exposes >1 method; the def is then looked up by id and scope derived from it. Omitted
        // for single-method apps, which fall back to the (appId, connectionType-scope) lookup.
        connectionDefinitionId: z.string().optional(),
      })
    )
    .use(notDemo('save app credentials'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appId, installationId, appName, secret, values, connectionId } = input
      const { connectionDefinitionId } = input

      // Validate against the chosen method server-side — the client form is convenience, not a
      // gate. With a picked method, look it up by id and derive scope from its `global`; without
      // one (single-method app), fall back to the legacy (appId, scope) lookup.
      const defResult = connectionDefinitionId
        ? await getConnectionDefinitionById(appId, connectionDefinitionId)
        : await getAppConnectionDefinition(appId, input.connectionType === 'organization')
      if (defResult.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection definition not found' })
      }
      const def = defResult.value

      // Scope is a property of the method: org-scoped (userId null) vs user-scoped.
      const isOrgScoped = connectionDefinitionId
        ? def.global === true
        : input.connectionType === 'organization'
      const userIdField = isOrgScoped ? null : userId

      // Org-scoped connections are an admin decision; user-scoped ones belong to the caller.
      if (isOrgScoped && !(await isAdminOrOwner(organizationId, userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only admins can manage organization connections',
        })
      }
      if (!isOrgScoped && connectionId) {
        await requireConnectionManageAccess(ctx.db, { userId, organizationId }, connectionId)
      }

      const variableDefs = def.connectionVariables ?? []

      let connectionData: {
        secret?: string
        secretFields?: Record<string, string>
        metadata?: Record<string, any>
      }
      if (variableDefs.length === 0) {
        // Bare API key. On edit, the form submits the `HIDDEN_VALUE` sentinel when the key is
        // unchanged — drop it (the reconnect merge keeps the stored value); only a fresh connect
        // must supply a real secret.
        const resolvedSecret = secret !== undefined && !isMasked(secret) ? secret : undefined
        if (!resolvedSecret && !connectionId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Secret is required' })
        }
        connectionData = resolvedSecret ? { secret: resolvedSecret } : {}
      } else {
        const provided = values ?? {}
        const knownKeys = new Set(variableDefs.map((v) => v.key))
        for (const key of Object.keys(provided)) {
          if (!knownKeys.has(key)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown field: ${key}` })
          }
        }
        // Trim, then split by the def's secret flags, dropping any masked echo (an unchanged secret
        // submitted as the sentinel) so editing one field never overwrites the others.
        const trimmed: Record<string, string> = {}
        for (const [key, value] of Object.entries(provided)) trimmed[key] = value?.trim() ?? ''
        const resolved = splitConnectionValues(variableDefs, trimmed)

        const secretFields: Record<string, string> = {}
        for (const [key, value] of Object.entries(resolved.secretFields)) {
          if (value !== '') secretFields[key] = value
        }
        const plainValues: Record<string, string> = {}
        for (const [key, value] of Object.entries(resolved.plainVariables)) {
          if (value !== '') plainValues[key] = value
        }

        // Required validation, sentinel-aware: a kept (masked) secret satisfies required on edit.
        for (const varDef of variableDefs) {
          if (varDef.required === false) continue
          const kept = isMasked(provided[varDef.key] ?? '')
          const hasValue = varDef.secret
            ? secretFields[varDef.key] !== undefined
            : plainValues[varDef.key] !== undefined
          if (!kept && !hasValue) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Missing required field: ${varDef.label}`,
            })
          }
        }

        connectionData = {
          secretFields,
          ...(Object.keys(plainValues).length > 0 && {
            metadata: { connectionVariables: plainValues },
          }),
        }
      }

      const result = await saveAppConnection(
        appId,
        installationId,
        appName,
        organizationId,
        userId, // createdById
        userIdField, // userId field for scoping
        connectionData,
        { connectionId, connectionDefinitionId, label: input.label }
      )

      if (result.isErr()) {
        logger.error('Failed to save secret connection', {
          error: result.error,
          appId,
          organizationId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message || 'Failed to save connection',
        })
      }

      // Connection test for the no-browser `client-credentials` grant: mint once now so a bad
      // client id/secret surfaces immediately rather than on first runtime use. The minted token
      // is cached on the credential for reuse.
      if (def.connectionType === 'client-credentials') {
        const minted = await mintClientCredentialToken(result.value, organizationId)
        if (!minted.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Couldn't authenticate with these credentials: ${minted.error ?? 'mint failed'}`,
          })
        }
      }

      return { success: true, credentialId: result.value }
    }),

  /**
   * Make an org-scoped connection the primary one record actions use when an app has more than
   * one connection — by method or by account (§4a). Org decision → admin only.
   */
  setDefaultConnection: adminProcedure
    .input(z.object({ connectionId: z.string() }))
    .use(notDemo('change the primary connection'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const result = await setDefaultCredential(input.connectionId, organizationId)
      if (result.isErr()) {
        logger.error('Failed to set default connection', {
          error: result.error,
          connectionId: input.connectionId,
          organizationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message || 'Failed to set primary connection',
        })
      }
      return { success: true }
    }),

  /**
   * Rename an app connection's label
   */
  renameConnection: protectedProcedure
    .input(
      z.object({
        connectionId: z.string(),
        label: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { connectionId, label } = input

      await requireConnectionManageAccess(ctx.db, { userId, organizationId }, connectionId)

      const result = await renameAppConnection(connectionId, label, organizationId)

      if (result.isErr()) {
        logger.error('Failed to rename connection', {
          error: result.error,
          connectionId,
          organizationId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return { success: true }
    }),

  /**
   * Get app's settings schema
   * Returns the schema definition from the app version
   */
  getSettingsSchema: protectedProcedure
    .input(
      z.object({
        appSlug: z.string(),
        installationType: z.enum(['development', 'production']),
      })
    )
    .query(async ({ ctx, input }) => {
      const { appSlug, installationType } = input
      const { organizationId } = ctx.session

      // Get app installation
      const appResult = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!appResult.ok) {
        logger.error('Failed to get app for schema', {
          error: appResult.error,
          appSlug,
          organizationId,
        })

        throw new TRPCError({
          code: appResult.error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: appResult.error.message,
        })
      }

      const app = appResult.value

      // Verify app is installed
      if (!app.installation.isInstalled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not installed',
        })
      }

      // Verify installation type matches
      if (app.installation.installationType !== installationType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `App is installed as ${app.installation.installationType}, not ${installationType}`,
        })
      }

      // Get deployment
      if (!app.installation.currentDeploymentId) {
        return {} // No schema if no deployment
      }

      const deployment = await ctx.db.query.AppDeployment.findFirst({
        where: (d, { eq }) => eq(d.id, app.installation.currentDeploymentId!),
        columns: {
          settingsSchema: true,
        },
      })

      // Return the settings schema from AppDeployment.settingsSchema
      return deployment?.settingsSchema?.organization || {}
    }),

  /**
   * Get app settings (for rendering form)
   * Returns settings merged with schema defaults
   */
  getSettings: protectedProcedure
    .input(
      z.object({
        appSlug: z.string(),
        installationType: z.enum(['development', 'production']),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, installationType } = input

      // Get app installation
      const appResult = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!appResult.ok) {
        logger.error('Failed to get app for settings', {
          error: appResult.error,
          appSlug,
          organizationId,
        })

        throw new TRPCError({
          code: appResult.error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: appResult.error.message,
        })
      }

      const app = appResult.value

      // Verify app is installed
      if (!app.installation.isInstalled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not installed',
        })
      }

      // Verify installation type matches
      if (app.installation.installationType !== installationType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `App is installed as ${app.installation.installationType}, not ${installationType}`,
        })
      }

      // Load schema from deployment for default merging
      let schema
      if (app.installation.currentDeploymentId) {
        const deployment = await ctx.db.query.AppDeployment.findFirst({
          where: (d, { eq }) => eq(d.id, app.installation.currentDeploymentId!),
          columns: {
            settingsSchema: true,
          },
        })

        schema = deployment?.settingsSchema?.organization
      }

      // Get settings with schema for default merging
      const settingsResult = await getAppSettings({
        appInstallationId: app.installation.id!,
        schema,
      })

      if (settingsResult.isErr()) {
        logger.error('Failed to get app settings', {
          error: settingsResult.error,
          installationId: app.installation.id,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: settingsResult.error.message,
        })
      }

      return settingsResult.value
    }),

  /**
   * Save app settings (from form submission)
   * Validates on server-side before persisting
   */
  saveSettings: adminProcedure
    .input(
      z.object({
        appSlug: z.string(),
        installationType: z.enum(['development', 'production']),
        settings: z.record(z.string(), z.any()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, installationType, settings } = input

      // Get app installation
      const appResult = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!appResult.ok) {
        logger.error('Failed to get app for saving settings', {
          error: appResult.error,
          appSlug,
          organizationId,
        })

        throw new TRPCError({
          code: appResult.error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: appResult.error.message,
        })
      }

      const app = appResult.value

      // Verify app is installed
      if (!app.installation.isInstalled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not installed',
        })
      }

      // Verify installation type matches
      if (app.installation.installationType !== installationType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `App is installed as ${app.installation.installationType}, not ${installationType}`,
        })
      }

      // Load schema for server-side validation
      let schema
      if (app.installation.currentDeploymentId) {
        const deployment = await ctx.db.query.AppDeployment.findFirst({
          where: (d, { eq }) => eq(d.id, app.installation.currentDeploymentId!),
          columns: {
            settingsSchema: true,
          },
        })

        schema = deployment?.settingsSchema?.organization
      }

      // SERVER-SIDE VALIDATION using Zod
      if (schema && Object.keys(schema).length > 0) {
        try {
          const zodSchema = schemaToZod(schema)
          const validationResult = zodSchema.safeParse(settings)

          if (!validationResult.success) {
            const errors = validationResult.error.flatten()
            logger.error('Settings validation failed', {
              errors,
              settings,
              appSlug,
              organizationId,
            })

            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Validation failed: Invalid settings provided',
              cause: errors,
            })
          }
        } catch (err) {
          // Handle schema conversion errors or validation errors
          if (err instanceof TRPCError) {
            throw err
          }

          logger.error('Settings validation error', {
            error: err,
            settings,
            schema,
            appSlug,
            organizationId,
          })

          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err instanceof Error ? err.message : 'Invalid settings',
          })
        }
      }

      // Save settings (now validated)
      const saveResult = await saveAppSettings({
        appInstallationId: app.installation.id!,
        appDeploymentId: app.installation.currentDeploymentId ?? undefined,
        settings,
      })

      if (saveResult.isErr()) {
        logger.error('Failed to save app settings', {
          error: saveResult.error,
          installationId: app.installation.id,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: saveResult.error.message,
        })
      }

      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'app.settings_changed',
        targetType: 'App',
        targetId: app.app.id,
        metadata: { appSlug, installationType, settingKeys: Object.keys(settings) },
      })

      return { success: true }
    }),
})
