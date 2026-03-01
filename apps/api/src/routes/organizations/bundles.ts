// apps/api/src/routes/organizations/bundles.ts

import { getInstallationDeployment } from '@auxx/services/app-installations'
import { Hono } from 'hono'
import { ERROR_STATUS_MAP, errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const bundles = new Hono<AppContext>()

// Note: Auth and organization middleware are applied at the parent router level

/**
 * GET /api/v1/organizations/:handle/apps/:appId/installations/:installationId/bundle
 * Redirect to stable, CDN-friendly client bundle URL.
 */
bundles.get('/apps/:appId/installations/:installationId/bundle', async (c) => {
  const organization = c.get('organization')
  const appId = c.req.param('appId')
  const installationId = c.req.param('installationId')

  const result = await getInstallationDeployment({
    installationId,
    organizationHandle: organization.handle!,
    appId,
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const { clientBundleSha } = result.value

  // Redirect to the stable, immutable bundle URL
  return c.redirect(`/api/v1/bundles/${appId}/client/${clientBundleSha}.js`, 302)
})

/**
 * GET /api/v1/organizations/:handle/apps/:appId/installations/:installationId/bundle/server
 * Redirect to stable server bundle URL.
 */
bundles.get('/apps/:appId/installations/:installationId/bundle/server', async (c) => {
  const organization = c.get('organization')
  const appId = c.req.param('appId')
  const installationId = c.req.param('installationId')

  const result = await getInstallationDeployment({
    installationId,
    organizationHandle: organization.handle!,
    appId,
  })

  if (result.isErr()) {
    const error = result.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const { serverBundleSha } = result.value

  // Redirect to the stable, immutable bundle URL
  return c.redirect(`/api/v1/bundles/${appId}/server/${serverBundleSha}.js`, 302)
})

export default bundles
