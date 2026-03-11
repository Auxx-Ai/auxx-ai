// apps/api/src/routes/deployments.ts
// Deployment management routes

import { database, schema } from '@auxx/database'
import { calculateNextVersion } from '@auxx/services/app-versions'
import { verifyAppAccess } from '@auxx/services/developer-accounts'
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
    deploymentType,
    targetOrganizationId,
    environmentVariables,
    version,
    metadata,
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

  // Auto-calculate version for production deployments when not provided
  const resolvedVersion =
    deploymentType === 'production'
      ? version || (await calculateNextVersion(appId))
      : version || null

  // Dev deployments: delete old deployments + insert + update installation atomically
  if (deploymentType === 'development' && targetOrganizationId) {
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

  return c.json({ deploymentId: deployment.id, version: deployment.version })
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

/**
 * PATCH /api/v1/apps/:appId/deployments/:id/status
 * Update deployment status (prod only).
 */
deployments.patch(
  '/:appId/deployments/:id/status',
  requireScope(['developer', 'apps:write']),
  async (c) => {
    const appId = c.req.param('appId')
    const deploymentId = c.req.param('id')
    const userId = c.get('userId')
    const body = await c.req.json()
    const { status } = body

    const accessResult = await verifyAppAccess({ appId, userId })
    if (accessResult.isErr()) {
      const error = accessResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    const deployment = await database.query.AppDeployment.findFirst({
      where: and(eq(schema.AppDeployment.id, deploymentId), eq(schema.AppDeployment.appId, appId)),
    })

    if (!deployment) {
      return c.json(errorResponse('DEPLOYMENT_NOT_FOUND', 'Deployment not found'), 404)
    }

    // Validate status transition (developer actions only)
    const validTransitions: Record<string, string[]> = {
      active: ['pending-review'],
      'pending-review': ['withdrawn'],
    }

    const allowed = validTransitions[deployment.status]
    if (!allowed || !allowed.includes(status)) {
      return c.json(
        errorResponse(
          'INVALID_STATUS_TRANSITION',
          `Cannot transition from '${deployment.status}' to '${status}'`
        ),
        400
      )
    }

    const [updated] = await database
      .update(schema.AppDeployment)
      .set({ status })
      .where(eq(schema.AppDeployment.id, deploymentId))
      .returning()

    return c.json({ deployment: updated })
  }
)

export default deployments
