// apps/api/src/routes/bundles.ts
// New bundle management routes for content-addressed storage

import { database, schema } from '@auxx/database'
import { getBundleS3Key } from '@auxx/services/app-bundles'
import { verifyAppAccess } from '@auxx/services/developer-accounts'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type ErrorStatusCode, errorResponse } from '../lib/response'
import { generatePresignedUploadUrl, getS3BucketName, getS3Client } from '../lib/s3'
import { authMiddleware } from '../middleware/auth'
import { requireScope } from '../middleware/scope'
import type { AppContext } from '../types/context'

const bundles = new Hono<AppContext>()

bundles.use('/*', authMiddleware)

const ERROR_STATUS_MAP: Record<string, ErrorStatusCode> = {
  APP_NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  DATABASE_ERROR: 500,
  S3_ERROR: 500,
}

/**
 * POST /api/v1/apps/:appId/bundles/check
 * Register hashes and return presigned URLs for missing bundles.
 * Uses ON CONFLICT DO NOTHING + select to handle concurrent registrations.
 */
bundles.post('/:appId/bundles/check', requireScope(['developer', 'apps:write']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const { clientSha, serverSha } = body

  if (!clientSha || !serverSha) {
    return c.json(errorResponse('BAD_REQUEST', 'clientSha and serverSha are required'), 400)
  }

  // Verify app access
  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  // Register both hashes (findOrCreate pattern)
  const results: Record<string, { exists: boolean; bundleId: string; uploadUrl: string | null }> =
    {}

  for (const [bundleType, sha256] of [
    ['client', clientSha],
    ['server', serverSha],
  ] as const) {
    // Insert with ON CONFLICT DO NOTHING
    await database
      .insert(schema.AppBundle)
      .values({ appId, bundleType, sha256 })
      .onConflictDoNothing({
        target: [schema.AppBundle.appId, schema.AppBundle.bundleType, schema.AppBundle.sha256],
      })

    // Always select
    const bundle = await database.query.AppBundle.findFirst({
      where: and(
        eq(schema.AppBundle.appId, appId),
        eq(schema.AppBundle.bundleType, bundleType),
        eq(schema.AppBundle.sha256, sha256)
      ),
    })

    if (!bundle) {
      return c.json(errorResponse('INTERNAL_ERROR', `Failed to register ${bundleType} bundle`), 500)
    }

    const exists = bundle.uploadedAt !== null
    let uploadUrl: string | null = null

    if (!exists) {
      // Generate presigned upload URL
      const s3Key = getBundleS3Key(appId, bundleType, sha256)
      const urlResult = await generatePresignedUploadUrl(s3Key, 5 * 60) // 5 minute TTL

      if (urlResult.isErr()) {
        return c.json(
          errorResponse('S3_ERROR', `Failed to generate upload URL for ${bundleType}`),
          500
        )
      }

      uploadUrl = urlResult.value
    }

    results[bundleType] = { exists, bundleId: bundle.id, uploadUrl }
  }

  return c.json(results)
})

/**
 * POST /api/v1/apps/:appId/bundles/confirm
 * Verify upload via HeadObject, set uploadedAt and sizeBytes.
 */
bundles.post('/:appId/bundles/confirm', requireScope(['developer', 'apps:write']), async (c) => {
  const appId = c.req.param('appId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const { clientSha, serverSha } = body

  if (!clientSha || !serverSha) {
    return c.json(errorResponse('BAD_REQUEST', 'clientSha and serverSha are required'), 400)
  }

  // Verify app access
  const accessResult = await verifyAppAccess({ appId, userId })
  if (accessResult.isErr()) {
    const error = accessResult.error
    const statusCode = ERROR_STATUS_MAP[error.code] ?? 500
    return c.json(errorResponse('INTERNAL_ERROR', error.message), statusCode)
  }

  const s3Client = getS3Client()
  const bucketName = getS3BucketName()

  // Verify each bundle exists in S3 and update DB
  for (const [bundleType, sha256] of [
    ['client', clientSha],
    ['server', serverSha],
  ] as const) {
    const s3Key = getBundleS3Key(appId, bundleType, sha256)

    try {
      // HeadObject to verify existence and get size
      const headResult = await s3Client.send(
        new HeadObjectCommand({ Bucket: bucketName, Key: s3Key })
      )

      const sizeBytes = headResult.ContentLength ?? null

      // Update bundle row
      await database
        .update(schema.AppBundle)
        .set({
          uploadedAt: new Date(),
          sizeBytes,
        })
        .where(
          and(
            eq(schema.AppBundle.appId, appId),
            eq(schema.AppBundle.bundleType, bundleType),
            eq(schema.AppBundle.sha256, sha256)
          )
        )
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return c.json(
          errorResponse('BUNDLE_NOT_UPLOADED', `${bundleType} bundle not found in S3: ${sha256}`),
          400
        )
      }
      return c.json(
        errorResponse('S3_ERROR', `Failed to verify ${bundleType} bundle: ${error.message}`),
        500
      )
    }
  }

  return c.json({ success: true })
})

export default bundles
