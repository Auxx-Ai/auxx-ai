// apps/web/src/app/api/attachments/[attachmentId]/content/route.ts

import type { NextRequest } from 'next/server'
export const runtime = 'nodejs'

import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-attachments-content')

interface RouteParams {
  params: Promise<{ attachmentId: string }>
}

/** MIME types safe for inline rendering. All others redirect to download. */
const SAFE_INLINE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * GET /api/attachments/[attachmentId]/content
 * Redirects to a signed URL for inline viewing of an attachment.
 * Only allows safe MIME types inline; unsafe types redirect to the download route.
 * Used by img src after cid: rewriting in inbound email HTML.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { attachmentId } = await params
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization required', { status: 403 })
    }

    const { InboundAttachmentAccessService } = await import('@auxx/lib/email')
    const attachmentAccessService = new InboundAttachmentAccessService()

    const downloadRef = await attachmentAccessService.getInlineViewUrl({
      attachmentId,
      organizationId,
    })

    // Reject unsafe MIME types for inline rendering — redirect to download instead
    if (downloadRef.mimeType && !SAFE_INLINE_MIME_TYPES.has(downloadRef.mimeType)) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/api/attachments/${attachmentId}/download`,
          'Cache-Control': 'no-cache',
        },
      })
    }

    if (downloadRef.type === 'url' && downloadRef.url) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: downloadRef.url,
          'Cache-Control': 'private, max-age=600',
        },
      })
    }

    return new Response('Content not available', { status: 404 })
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.name === 'NotFoundError') {
      return new Response('Not found', { status: 404 })
    }
    logger.error('Attachment content error:', error)
    return new Response('Internal error', { status: 500 })
  }
}
