// apps/api/src/routes/organizations/bundles.ts

import { Hono } from 'hono'
import { errorResponse, ERROR_STATUS_MAP } from '../../lib/response'
import type { AppContext } from '../../types/context'

// Service imports
import { getInstallationBundle } from '@auxx/services/app-installations'
import { generateBundleDownloadUrls } from '../../lib/generate-bundle-download-urls'
// import { generateBundleDownloadUrls } from '@auxx/services/app-bundles'

const bundles = new Hono<AppContext>()

// Note: Auth and organization middleware are applied at the parent router level

/**
 * GET /api/v1/organizations/:handle/apps/:appId/installations/:installationId/bundle
 * Direct download of client bundle (with CDN caching)
 *
 * Default behavior: Returns client bundle
 * For server bundle, use /bundle/server endpoint
 */
bundles.get('/apps/:appId/installations/:installationId/bundle', async (c) => {
  const organization = c.get('organization')
  const organizationHandle = organization.handle
  const appId = c.req.param('appId')
  const installationId = c.req.param('installationId')

  // Organization access already verified by organizationMiddleware

  // Get installation with current version bundle
  const installationResult = await getInstallationBundle({
    installationId,
    organizationHandle: organizationHandle!,
    appId,
  })

  if (installationResult.isErr()) {
    const error = installationResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const { bundle } = installationResult.value

  // Generate download URLs
  const urlsResult = await generateBundleDownloadUrls({
    bundleId: bundle.id,
  })

  if (urlsResult.isErr()) {
    const error = urlsResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Set cache headers (1 hour cache)
  // c.header('Cache-Control', 'public, max-age=3600')
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate')

  c.header('X-Bundle-Id', bundle.id)

  // Redirect to S3 presigned URL for client bundle (CDN will cache the response)
  return c.redirect(urlsResult.value.urls.clientBundleDownloadUrl, 302)
})

/**
 * GET /api/v1/organizations/:handle/apps/:appId/installations/:installationId/bundle/server
 * Direct download of server bundle (with CDN caching)
 */
bundles.get('/apps/:appId/installations/:installationId/bundle/server', async (c) => {
  const organization = c.get('organization')
  const organizationHandle = organization.handle
  const appId = c.req.param('appId')
  const installationId = c.req.param('installationId')

  // Organization access already verified by organizationMiddleware

  // Get installation with current version bundle
  const installationResult = await getInstallationBundle({
    installationId,
    organizationHandle: organizationHandle!,
    appId,
  })

  if (installationResult.isErr()) {
    const error = installationResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const { bundle } = installationResult.value

  // Generate download URLs
  const urlsResult = await generateBundleDownloadUrls({
    bundleId: bundle.id,
  })

  if (urlsResult.isErr()) {
    const error = urlsResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Set cache headers (1 hour cache)
  c.header('Cache-Control', 'public, max-age=3600')
  c.header('X-Bundle-Id', bundle.id)

  // Redirect to S3 presigned URL for server bundle (CDN will cache the response)
  return c.redirect(urlsResult.value.urls.serverBundleDownloadUrl, 302)
})

export default bundles
