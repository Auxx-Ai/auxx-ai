// apps/api/src/routes/bundle-assets.ts
// Stable, CDN-friendly endpoint for serving client bundles by content hash.

import { database, schema } from '@auxx/database'
import { getBundleS3Key } from '@auxx/services/app-bundles'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getS3BucketName, getS3Client } from '../lib/s3'
import type { AppContext } from '../types/context'

const bundleAssets = new Hono<AppContext>()

/**
 * Positive-only existence cache for uploaded bundles. Content-addressed keys
 * (`appId:type:sha`) are immutable, so a confirmed row never needs re-checking;
 * misses are NOT cached (a bundle mid-publish appears on the next request). A
 * stale entry after a bundle-row delete degrades gracefully — the S3 GET 404s.
 */
const knownBundles = new Set<string>()
const KNOWN_BUNDLES_MAX = 1000

/**
 * GET /api/v1/bundles/:appId/:bundleType/:sha.js
 * Serve a bundle file by content hash. Immutable — same URL always returns same content.
 *
 * Phase 1: Streams S3 content through the API.
 * Phase 2: Returns 302 to a stable CloudFront URL.
 */
bundleAssets.get('/:appId/:bundleType/:filename', async (c) => {
  const appId = c.req.param('appId')
  const bundleType = c.req.param('bundleType')
  const filename = c.req.param('filename')

  // Extract sha from filename (e.g. "abc123.js" → "abc123")
  const sha256 = filename.replace(/\.js$/, '')

  if (!sha256 || !['client', 'server'].includes(bundleType)) {
    return c.json({ error: 'Invalid bundle path' }, 400)
  }

  // Verify bundle exists and is uploaded (cached — assets are immutable)
  const cacheKey = `${appId}:${bundleType}:${sha256}`
  if (!knownBundles.has(cacheKey)) {
    const bundle = await database.query.AppBundle.findFirst({
      where: and(
        eq(schema.AppBundle.appId, appId),
        eq(schema.AppBundle.bundleType, bundleType),
        eq(schema.AppBundle.sha256, sha256)
      ),
      columns: { id: true, uploadedAt: true },
    })

    if (!bundle || !bundle.uploadedAt) {
      return c.json({ error: 'Bundle not found' }, 404)
    }

    if (knownBundles.size >= KNOWN_BUNDLES_MAX) {
      const oldest = knownBundles.values().next().value
      if (oldest) knownBundles.delete(oldest)
    }
    knownBundles.add(cacheKey)
  }

  // Stream from S3
  const s3Key = getBundleS3Key(appId, bundleType, sha256)
  const s3Client = getS3Client()

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: getS3BucketName(),
        Key: s3Key,
      })
    )

    if (!response.Body) {
      return c.json({ error: 'Bundle content not available' }, 500)
    }

    // Content is immutable — same hash always means same content
    c.header('Content-Type', 'application/javascript')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')

    if (response.ContentLength) {
      c.header('Content-Length', String(response.ContentLength))
    }

    // Stream the S3 body
    const bodyStream = response.Body.transformToWebStream()
    return new Response(bodyStream, {
      status: 200,
      headers: c.res.headers,
    })
  } catch (error: any) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return c.json({ error: 'Bundle not found in storage' }, 404)
    }
    console.error('[bundle-assets] S3 error:', error.message)
    return c.json({ error: 'Failed to retrieve bundle' }, 500)
  }
})

export default bundleAssets
