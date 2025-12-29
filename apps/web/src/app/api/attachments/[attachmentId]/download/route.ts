// apps/web/src/app/api/attachments/[attachmentId]/download/route.ts

import { NextRequest } from 'next/server'
export const runtime = 'nodejs'
import { auth } from '~/auth/server'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'

const logger = createScopedLogger('api-attachments-download')

interface RouteParams {
  params: Promise<{ attachmentId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { attachmentId } = await params
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization required', { status: 400 })
    }

    // Use AttachmentService to get download ref (lazy import to avoid bundling sharp unnecessarily)
    const { AttachmentService } = await import('@auxx/lib/files/server')
    const attachmentService = new AttachmentService(organizationId, session.user.id)

    // Check if attachment exists and user has access
    const attachment = await attachmentService.get(attachmentId)
    if (!attachment) {
      return new Response('Not found', { status: 404 })
    }

    // Get download reference (handles both files and assets)
    const downloadRef = await attachmentService.getDownloadRef(attachmentId)

    // Handle based on download ref type
    if (downloadRef.type === 'url') {
      // Redirect to presigned URL
      return Response.redirect(downloadRef.url, 302)
    }

    // For stream type (future-proofing)
    if (downloadRef.type === 'stream' && downloadRef.stream) {
      const buffer = await streamToBuffer(downloadRef.stream)

      return new Response(buffer, {
        headers: {
          'Content-Type': downloadRef.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${downloadRef.filename}"`,
          'Content-Length': buffer.length.toString(),
        },
      })
    }

    return new Response('Download not available', { status: 500 })
  } catch (error) {
    logger.error('Download error:', error)
    return new Response('Internal error', { status: 500 })
  }
}

// Helper to convert stream to buffer if needed
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
