// apps/api/src/routes/deployments.ts
// Deployment management routes

import { database, schema } from '@auxx/database'
import { updateDeploymentStatus } from '@auxx/lib/apps'
import { invalidateAppCatalog, invalidateOrgsByDeploymentId, onCacheEvent } from '@auxx/lib/cache'
import { restampWebhookBindingsForDeployment } from '@auxx/lib/data-connectors'
import { calculateNextVersion } from '@auxx/services/app-versions'
import { verifyAppAccess } from '@auxx/services/developer-accounts'
import { verifyOrgMembership } from '@auxx/services/organization-members'
import { stableStringify } from '@auxx/utils/json'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type ErrorStatusCode, errorResponse } from '../lib/response'
import { authMiddleware } from '../middleware/auth'
import { requireScope } from '../middleware/scope'
import type { AppContext } from '../types/context'

const deployments = new Hono<AppContext>()

deployments.use('/*', authMiddleware)

const ERROR_STATUS_MAP: Record<string, ErrorStatusCode> = {
  APP_NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  DEPLOYMENT_NOT_FOUND: 404,
  DATABASE_ERROR: 500,
  BUNDLE_NOT_FOUND: 404,
  BUNDLE_NOT_UPLOADED: 400,
}

/**
 * POST /api/v1/apps/:appId/deployments
 * Create a deployment record.
 */
deployments.post('/:appId/deployments', requireScope(['developer', 'apps:write']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')
  const body = await c.req.json()

  const {
    clientBundleSha,
    serverBundleSha,
    settingsSchema,
    catalog,
    deploymentType,
    targetOrganizationId,
    environmentVariables,
    version,
    metadata,
    publish,
  } = body

  if (!clientBundleSha || !serverBundleSha || !deploymentType) {
    return c.json(
      errorResponse(
        'BAD_REQUEST',
        'clientBundleSha, serverBundleSha, and deploymentType are required'
      ),
      400
    )
  }

  if (publish && deploymentType !== 'production') {
    return c.json(
      errorResponse('BAD_REQUEST', 'publish is only supported for production deployments'),
      400
    )
  }

  // Verify app access
  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Look up bundle rows by hash (must be uploaded)
  const clientBundle = await database.query.AppBundle.findFirst({
    where: and(
      eq(schema.AppBundle.appId, appId),
      eq(schema.AppBundle.bundleType, 'client'),
      eq(schema.AppBundle.sha256, clientBundleSha)
    ),
  })

  if (!clientBundle || !clientBundle.uploadedAt) {
    return c.json(
      errorResponse('BUNDLE_NOT_UPLOADED', 'Client bundle not found or not uploaded'),
      400
    )
  }

  const serverBundle = await database.query.AppBundle.findFirst({
    where: and(
      eq(schema.AppBundle.appId, appId),
      eq(schema.AppBundle.bundleType, 'server'),
      eq(schema.AppBundle.sha256, serverBundleSha)
    ),
  })

  if (!serverBundle || !serverBundle.uploadedAt) {
    return c.json(
      errorResponse('BUNDLE_NOT_UPLOADED', 'Server bundle not found or not uploaded'),
      400
    )
  }

  // Idempotency: skip no-op production releases. Re-running create (e.g. the
  // batch push-all loop) with identical bundles + catalog + settingsSchema
  // returns the existing deployment instead of bumping a new version. jsonb does
  // NOT preserve object key order on round-trip, so compare canonical
  // serializations — never raw JSON.stringify.
  if (deploymentType === 'production') {
    const latest = await database.query.AppDeployment.findFirst({
      where: and(
        eq(schema.AppDeployment.appId, appId),
        eq(schema.AppDeployment.deploymentType, 'production')
      ),
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    })

    // Dead-end statuses (rejected/withdrawn/deprecated) never count as a match —
    // a re-run should produce a fresh deployment. When publishing, the existing
    // deployment must already be in the publish pipeline; an unpublished
    // 'active' match still needs the publish chain to run.
    const liveStatuses = publish
      ? ['pending-review', 'in-review', 'approved', 'published']
      : ['active', 'pending-review', 'in-review', 'approved', 'published']

    if (
      latest &&
      latest.clientBundleId === clientBundle.id &&
      latest.serverBundleId === serverBundle.id &&
      liveStatuses.includes(latest.status) &&
      stableStringify(latest.catalog ?? null) === stableStringify(catalog ?? null) &&
      stableStringify(latest.settingsSchema ?? null) === stableStringify(settingsSchema ?? null)
    ) {
      return c.json({
        deploymentId: latest.id,
        version: latest.version,
        status: latest.status,
        unchanged: true,
      })
    }
  }

  // Auto-calculate version for production deployments when not provided
  const resolvedVersion =
    deploymentType === 'production'
      ? version || (await calculateNextVersion(appId))
      : version || null

  // Dev deployments: delete old deployments + insert + update installation atomically
  if (deploymentType === 'development') {
    // `targetOrganizationId` is caller-supplied body input, and a dev deployment
    // installs this developer's server bundle into that tenant, where it later
    // executes as app code. Nothing upstream binds the request to an
    // organization: authMiddleware sets only userId/scopes, requireScope is a
    // pure token-scope check, verifyAppAccess covers only the developer account
    // that owns the App, and organizationMiddleware is not mounted on this
    // router (it keys off a :handle URL param). So membership must be asserted
    // here. The CLI already picks the org from the membership-scoped
    // GET /developers/dev-organizations, so this only rejects forged bodies.
    if (!targetOrganizationId) {
      return c.json(
        errorResponse(
          'BAD_REQUEST',
          'targetOrganizationId is required for development deployments'
        ),
        400
      )
    }

    // Deliberately a direct indexed OrganizationMember lookup (via the shared
    // verifyOrgMembership service) rather than the cached isOrgMember helper
    // from @auxx/lib/cache: this runs once per bundle upload, not on a hot read
    // path, it is a security boundary where the org-cache staleness window is
    // undesirable, and it is cheaper than materializing the whole members blob
    // to answer a single boolean. No apps/api route uses isOrgMember today —
    // the established convention here is the services-layer verify* functions.
    const membershipResult = await verifyOrgMembership({
      userId,
      organizationId: targetOrganizationId,
    })

    if (membershipResult.isErr()) {
      if (membershipResult.error.code === 'DATABASE_ERROR') {
        return c.json(errorResponse('INTERNAL_ERROR', 'Database error occurred'), 500)
      }
      // Fail closed: a missing organization and a non-member are indistinguishable.
      return c.json(
        errorResponse(
          'ORG_ACCESS_DENIED',
          'You do not have access to the target organization for this deployment'
        ),
        403
      )
    }

    const result = await database.transaction(async (tx) => {
      // 1. Clean up old dev deployments from the same developer
      await tx
        .delete(schema.AppDeployment)
        .where(
          and(
            eq(schema.AppDeployment.appId, appId),
            eq(schema.AppDeployment.deploymentType, 'development'),
            eq(schema.AppDeployment.targetOrganizationId, targetOrganizationId),
            eq(schema.AppDeployment.createdById, userId)
          )
        )

      // 2. Insert new deployment
      const [deployment] = await tx
        .insert(schema.AppDeployment)
        .values({
          appId,
          deploymentType,
          clientBundleId: clientBundle.id,
          serverBundleId: serverBundle.id,
          settingsSchema: settingsSchema || null,
          catalog: catalog || null,
          targetOrganizationId: targetOrganizationId || null,
          environmentVariables: environmentVariables || null,
          version: resolvedVersion,
          status: 'active',
          metadata: metadata || null,
          createdById: userId,
        })
        .returning()

      if (!deployment) {
        throw new Error('Failed to create deployment')
      }

      // 3. Update or create installation
      const existing = await tx.query.AppInstallation.findFirst({
        where: and(
          eq(schema.AppInstallation.appId, appId),
          eq(schema.AppInstallation.organizationId, targetOrganizationId),
          eq(schema.AppInstallation.installationType, 'development')
        ),
      })

      if (existing && !existing.uninstalledAt) {
        await tx
          .update(schema.AppInstallation)
          .set({ currentDeploymentId: deployment.id, updatedAt: new Date() })
          .where(eq(schema.AppInstallation.id, existing.id))
      } else {
        if (existing?.uninstalledAt) {
          await tx.delete(schema.AppInstallation).where(eq(schema.AppInstallation.id, existing.id))
        }
        await tx.insert(schema.AppInstallation).values({
          appId,
          organizationId: targetOrganizationId,
          installationType: 'development',
          currentDeploymentId: deployment.id,
          installedAt: new Date(),
        })
      }

      return deployment
    })

    // Invalidate: auto-install + deployment switch for this org
    await onCacheEvent('app.installed', { orgId: targetOrganizationId })

    return c.json({ deploymentId: result.id, version: result.version })
  }

  // Non-dev deployments: existing flow
  const [deployment] = await database
    .insert(schema.AppDeployment)
    .values({
      appId,
      deploymentType,
      clientBundleId: clientBundle.id,
      serverBundleId: serverBundle.id,
      settingsSchema: settingsSchema || null,
      catalog: catalog || null,
      targetOrganizationId: targetOrganizationId || null,
      environmentVariables: environmentVariables || null,
      version: resolvedVersion,
      status: 'active',
      metadata: metadata || null,
      createdById: userId,
    })
    .returning()

  if (!deployment) {
    return c.json(errorResponse('INTERNAL_ERROR', 'Failed to create deployment'), 500)
  }

  let status = deployment.status

  // Publish chain: submit-for-review (→ approved via autoApprove) → publish.
  // Without autoApprove the deployment stops at pending-review. The deployment
  // already exists at this point, so chain failures are reported alongside it
  // rather than as a request error.
  if (publish) {
    let publishError: string | undefined

    const submitResult = await updateDeploymentStatus({
      deploymentId: deployment.id,
      action: 'submit-for-review',
      userId,
    })

    if (submitResult.isErr()) {
      publishError = submitResult.error.message
    } else {
      status = submitResult.value.deployment.status

      if (submitResult.value.autoApproved) {
        const publishResult = await updateDeploymentStatus({
          deploymentId: deployment.id,
          action: 'publish',
          userId,
        })
        if (publishResult.isErr()) {
          publishError = publishResult.error.message
        } else {
          status = publishResult.value.deployment.status
        }
      }
    }

    // Invalidate caches (mirrors the build portal's versions router; covers
    // rolled-forward installations, which now reference this deployment)
    const app = await database.query.App.findFirst({ where: eq(schema.App.id, appId) })
    if (app) {
      await onCacheEvent('build.app.updated', { developerAccountId: app.developerAccountId })
    }
    await invalidateOrgsByDeploymentId(deployment.id, database)
    await restampWebhookBindingsForDeployment(deployment.id, database)
    await invalidateAppCatalog()

    return c.json({
      deploymentId: deployment.id,
      version: deployment.version,
      status,
      publishError,
    })
  }

  return c.json({ deploymentId: deployment.id, version: deployment.version, status })
})

/**
 * GET /api/v1/apps/:appId/deployments
 * List deployments for an app.
 */
deployments.get('/:appId/deployments', requireScope(['developer', 'apps:read']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')
  const deploymentType = c.req.query('type')

  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const conditions = [eq(schema.AppDeployment.appId, appId)]
  if (deploymentType) {
    conditions.push(eq(schema.AppDeployment.deploymentType, deploymentType))
  }

  const result = await database.query.AppDeployment.findMany({
    where: and(...conditions),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
    with: {
      clientBundle: true,
      serverBundle: true,
    },
  })

  return c.json({
    deployments: result.map((d) => ({
      id: d.id,
      deploymentType: d.deploymentType,
      version: d.version,
      status: d.status,
      clientBundleSha: d.clientBundle.sha256,
      serverBundleSha: d.serverBundle.sha256,
      settingsSchema: d.settingsSchema,
      metadata: d.metadata,
      createdAt: d.createdAt.toISOString(),
    })),
  })
})

export default deployments
