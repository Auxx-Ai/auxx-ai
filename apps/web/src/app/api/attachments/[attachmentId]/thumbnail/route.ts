// apps/web/src/app/api/attachments/[attachmentId]/thumbnail/route.ts

import type { NextRequest } from 'next/server'
export const runtime = 'nodejs'

import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
// Lazy-load services to avoid pulling worker-only processing code into the module graph
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-attachments-thumbnail')

// Simple in-memory rate limiting for now
// TODO: Replace with Redis-based rate limiting in production
const requestCounts = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 30 // requests per minute
const WINDOW = 60000 // 1 minute in milliseconds

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const userLimit = requestCounts.get(userId)

  if (!userLimit || now > userLimit.resetTime) {
    // Reset the counter
    requestCounts.set(userId, {
      count: 1,
      resetTime: now + WINDOW,
    })
    return true
  }

  if (userLimit.count >= RATE_LIMIT) {
    return false
  }

  userLimit.count++
  return true
}

interface RouteParams {
  params: Promise<{ attachmentId: string }>
}

/**
 * GET /api/attachments/[attachmentId]/thumbnail
 * Generate and serve thumbnail for image attachments with rate limiting
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { attachmentId } = await params

    // Reuse same auth pattern as download route
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization required', { status: 400 })
    }

    // Apply simple rate limiting per user
    if (!checkRateLimit(session.user.id)) {
      logger.warn('Thumbnail rate limit exceeded', {
        userId: session.user.id,
        attachmentId,
      })
      return new Response('Too many requests', {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': '30',
          'X-RateLimit-Window': '60s',
        },
      })
    }

    // Use same service initialization as download route
    const { AttachmentService } = await import('@auxx/lib/files/server')
    const attachmentService = new AttachmentService(organizationId, session.user.id)

    // Reuse same access check logic as download route
    const attachment = await attachmentService.get(attachmentId)
    if (!attachment) {
      return new Response('Not found', { status: 404 })
    }

    // Check if thumbnail exists or queue generation
    const { ThumbnailService } = await import('@auxx/lib/files')
    const thumbnailService = new ThumbnailService(organizationId, session.user.id)

    // Generate/ensure thumbnail based on the attachment itself.
    // The ThumbnailService understands 'attachment' and resolves to the correct asset/file version.
    const thumbnailResult = await thumbnailService.ensureThumbnail(
      { type: 'attachment', attachmentId },
      { preset: 'comment-preview', queue: true } // Use queue for better performance
    )

    if (thumbnailResult.status === 'ready' || thumbnailResult.status === 'generated') {
      // Get download ref for thumbnail using StorageManager
      const { createStorageManager } = await import('@auxx/lib/files/server')
      const storageManager = createStorageManager(organizationId)
      const downloadRef = await storageManager.getDownloadRef({
        locationId: thumbnailResult.storageLocationId,
      })

      if (downloadRef.type === 'url') {
        // Simple redirect with proper cache headers
        return new Response(null, {
          status: 302,
          headers: {
            Location: downloadRef.url,
            'Cache-Control': 'public, max-age=31536000, immutable',
            Vary: 'Cookie, Authorization',
          },
        })
      }
    }

    // Return placeholder while generating
    if (thumbnailResult.status === 'queued') {
      // Return a lightweight placeholder response
      return new Response(null, {
        status: 202, // Accepted
        headers: {
          'Retry-After': '2',
          'Cache-Control': 'no-cache',
        },
      })
    }

    // Fallback to original if thumbnail generation fails or not supported
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/api/attachments/${attachmentId}/download`,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    logger.error('Thumbnail error', {
      error: error instanceof Error ? error.message : String(error),
    })
    // Fallback to download route on any error
    const { attachmentId } = await params
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/api/attachments/${attachmentId}/download`,
        'Cache-Control': 'no-cache',
      },
    })
  }
}
