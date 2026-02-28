// apps/api/src/routes/versions.ts

import { completeBundle, createBundle, getBundleById } from '@auxx/services/app-bundles'
import { createDevVersion, createProdVersion, listProdVersions } from '@auxx/services/app-versions'
// Service imports
import { verifyAppAccess } from '@auxx/services/developer-accounts'
import { verifyOrgMembership } from '@auxx/services/organization-members'
import { Hono } from 'hono'
import { generateBundleUploadUrls } from '../lib/generate-bundle-upload-urls'
import { type ErrorStatusCode, errorResponse } from '../lib/response'
import { authMiddleware } from '../middleware/auth'
import { requireScope } from '../middleware/scope'
import type { AppContext } from '../types/context'

const versions = new Hono<AppContext>()

versions.use('/*', authMiddleware)

/**
 * Error code to HTTP status code mapping
 */
const ERROR_STATUS_MAP: Record<string, ErrorStatusCode> = {
  APP_NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  NOT_MEMBER: 403,
  ORGANIZATION_NOT_FOUND: 404,
  CREATE_FAILED: 500,
  VERSION_NOT_FOUND: 404,
  BUNDLE_NOT_FOUND: 404,
  BUNDLE_ALREADY_COMPLETE: 400,
  INSTALLATION_NOT_FOUND: 404,
  DATABASE_ERROR: 500,
  S3_ERROR: 500,
}

/**
 * POST /api/v1/apps/:appId/dev-versions
 * Create a new development version with bundle upload URLs
 */
versions.post('/:appId/dev-versions', requireScope(['developer', 'apps:write']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const { target_organization_id, environment_variables, cli_version } = body

  console.log('[dev-versions] Starting for app:', appId, 'user:', userId)

  // Step 1: Verify app access
  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    console.error('[dev-versions] Step 1 failed (verifyAppAccess):', error.code, error.message)
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }
  console.log('[dev-versions] Step 1 passed (verifyAppAccess)')

  // Step 2: Verify org membership
  const orgResult = await verifyOrgMembership({
    userId,
    organizationId: target_organization_id,
  })

  if (orgResult.isErr()) {
    const error = orgResult.error
    console.error('[dev-versions] Step 2 failed (verifyOrgMembership):', error.code, error.message)
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }
  console.log('[dev-versions] Step 2 passed (verifyOrgMembership)')

  // Step 3: Create version
  const versionResult = await createDevVersion({
    appId,
    targetOrganizationId: target_organization_id,
    environmentVariables: environment_variables || {},
    cliVersion: cli_version,
    createdById: accessResult.value.member.id,
  })
  if (versionResult.isErr()) {
    const error = versionResult.error
    console.error('[dev-versions] Step 3 failed (createDevVersion):', error.code, error.message)
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message), statusCode)
  }
  console.log('[dev-versions] Step 3 passed (createDevVersion):', versionResult.value.id)

  // Step 4: Create bundle
  const bundleResult = await createBundle({
    appVersionId: versionResult.value.id,
    versionType: 'dev',
  })
  if (bundleResult.isErr()) {
    const error = bundleResult.error
    console.error('[dev-versions] Step 4 failed (createBundle):', error.code, error.message)
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message), statusCode)
  }
  console.log('[dev-versions] Step 4 passed (createBundle):', bundleResult.value.id)

  // Step 5: Generate upload URLs
  const urlsResult = await generateBundleUploadUrls({
    bundleId: bundleResult.value.id,
    appId,
    versionId: versionResult.value.id,
  })
  if (urlsResult.isErr()) {
    const error = urlsResult.error
    console.error(
      '[dev-versions] Step 5 failed (generateBundleUploadUrls):',
      error.code,
      error.message
    )
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse(error.code, error.message), statusCode)
  }
  console.log('[dev-versions] Step 5 passed (generateBundleUploadUrls)')

  // Success response
  return c.json({
    versionId: versionResult.value.id,
    appId: versionResult.value.appId,
    major: versionResult.value.major,
    minor: versionResult.value.minor,
    bundle: {
      id: bundleResult.value.id,
      clientBundleUploadUrl: urlsResult.value.urls.clientBundleUploadUrl,
      serverBundleUploadUrl: urlsResult.value.urls.serverBundleUploadUrl,
    },
  })
})

/**
 * POST /api/v1/apps/:appId/dev-versions/:versionId/bundles/:bundleId/complete
 * Complete a bundle upload for a dev version
 */
versions.post(
  '/:appId/dev-versions/:versionId/bundles/:bundleId/complete',
  requireScope(['developer', 'apps:write']),
  async (c) => {
    const appId = c.req.param('appId')
    const versionId = c.req.param('versionId')
    const bundleId = c.req.param('bundleId')
    const userId = c.get('userId')

    // Parse request body
    const body = await c.req.json()
    const { bundle_sha, settings_schema } = body

    console.log('SHA:', bundle_sha)
    console.log('settings_schema:', settings_schema)
    // Step 1: Verify app access
    const accessResult = await verifyAppAccess({ appId, userId })
    if (accessResult.isErr()) {
      const error = accessResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    // Step 2: Get bundle and verify ownership
    const bundleResult = await getBundleById({ bundleId })
    if (bundleResult.isErr()) {
      const error = bundleResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    if (bundleResult.value.appVersionId !== versionId) {
      return c.json(errorResponse('BAD_REQUEST', 'Bundle does not belong to this version'), 400)
    }

    // Step 3: Complete the bundle with SHA value and settings schema
    const completeResult = await completeBundle({
      bundleId,
      bundleSha: bundle_sha,
      settingsSchema: settings_schema,
      versionId,
    })
    if (completeResult.isErr()) {
      const error = completeResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    return c.json({ success: true })
  }
)

/**
 * POST /api/v1/apps/:appId/prod-versions
 * Create a new production version with bundle upload URLs
 */
versions.post('/:appId/prod-versions', requireScope(['developer', 'apps:write']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const { major, cli_version } = body

  // Step 1: Verify app access
  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Step 2: Create version
  const versionResult = await createProdVersion({
    appId,
    major,
    cliVersion: cli_version,
    createdById: accessResult.value.member.id,
  })
  if (versionResult.isErr()) {
    const error = versionResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Step 3: Create bundle
  const bundleResult = await createBundle({
    appVersionId: versionResult.value.id,
    versionType: 'prod',
  })
  if (bundleResult.isErr()) {
    const error = bundleResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Step 4: Generate upload URLs
  const urlsResult = await generateBundleUploadUrls({
    bundleId: bundleResult.value.id,
    appId,
    versionId: versionResult.value.id,
  })
  if (urlsResult.isErr()) {
    const error = urlsResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Success response
  return c.json({
    versionId: versionResult.value.id,
    appId: versionResult.value.appId,
    major: versionResult.value.major,
    minor: versionResult.value.minor,
    bundle: {
      id: bundleResult.value.id,
      clientBundleUploadUrl: urlsResult.value.urls.clientBundleUploadUrl,
      serverBundleUploadUrl: urlsResult.value.urls.serverBundleUploadUrl,
    },
  })
})

/**
 * GET /api/v1/apps/:appId/prod-versions
 * List all production versions for an app
 */
versions.get('/:appId/prod-versions', requireScope(['developer', 'apps:read']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')

  // Step 1: Verify app access
  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Step 2: Get versions
  const versionsResult = await listProdVersions({ appId })
  if (versionsResult.isErr()) {
    const error = versionsResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const formattedVersions = versionsResult.value.map((v) => ({
    major: v.major,
    minor: v.minor,
    created_at: v.createdAt.toISOString(),
    released_at: v.releasedAt?.toISOString() || null,
    is_published: v.publicationStatus === 'published',
    num_installations: v.numInstallations || 0,
    publication_status: v.publicationStatus || 'unpublished',
    review_status: v.reviewStatus || null,
  }))

  return c.json({ app_prod_versions: formattedVersions })
})

/**
 * POST /api/v1/apps/:appId/prod-versions/:versionId/bundles/:bundleId/complete
 * Complete a bundle upload for a production version
 */
versions.post(
  '/:appId/prod-versions/:versionId/bundles/:bundleId/complete',
  requireScope(['developer', 'apps:write']),
  async (c) => {
    const appId = c.req.param('appId')
    const versionId = c.req.param('versionId')
    const bundleId = c.req.param('bundleId')
    const userId = c.get('userId')

    // Parse request body
    const body = await c.req.json()
    const { bundle_sha, settings_schema } = body

    // Step 1: Verify app access
    const accessResult = await verifyAppAccess({ appId, userId })
    if (accessResult.isErr()) {
      const error = accessResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    // Step 2: Get bundle and verify ownership
    const bundleResult = await getBundleById({ bundleId })
    if (bundleResult.isErr()) {
      const error = bundleResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    if (bundleResult.value.appVersionId !== versionId) {
      return c.json(errorResponse('BAD_REQUEST', 'Bundle does not belong to this version'), 400)
    }

    // Step 3: Complete the bundle with SHA value and settings schema
    const completeResult = await completeBundle({
      bundleId,
      bundleSha: bundle_sha,
      settingsSchema: settings_schema,
      versionId,
    })
    if (completeResult.isErr()) {
      const error = completeResult.error
      const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
      return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
    }

    return c.json({ success: true })
  }
)

export default versions
