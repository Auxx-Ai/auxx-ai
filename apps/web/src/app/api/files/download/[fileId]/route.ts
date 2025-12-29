// apps/web/src/app/api/files/download/[fileId]/route.ts

import { NextRequest } from 'next/server'
import { createFileService, createFileDownloadResponse, parseRangeHeader } from '@auxx/lib/files/server'
import { auth } from '~/auth/server'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'

const logger = createScopedLogger('api-files-download')

export async function GET(request: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })

    // Check authentication
    if (!session || !session.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization ID is required', { status: 400 })
    }

    const { fileId } = params

    if (!fileId) {
      return new Response('File ID is required', { status: 400 })
    }

    logger.info(`Downloading file: ${fileId}`)

    // Create file service with user context for permission checking
    const fileService = createFileService(organizationId, session.user.id)

    // Get file info - this checks permissions at entity level
    const file = await fileService.get(fileId)
    if (!file) {
      return new Response('File not found', { status: 404 })
    }

    // Get file content using the service (handles storage location lookup)
    const fileContent = await fileService.getContent(fileId)

    // Parse range header for streaming support
    const range = parseRangeHeader(request.headers.get('range'))

    // Create download response with proper headers
    const downloadResponse = createFileDownloadResponse(
      fileContent,
      {
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      },
      {
        range: range || undefined,
        inline: false, // Always download as attachment
      }
    )

    return new Response(downloadResponse.buffer, {
      status: downloadResponse.status,
      headers: downloadResponse.headers,
    })
  } catch (error) {
    logger.error('Error downloading file:', error)
    return new Response('Internal server error', { status: 500 })
  }
}

// Support HEAD requests for checking file existence
export async function HEAD(request: NextRequest, { params }: { params: { fileId: string } }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session || !session.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization ID is required', { status: 400 })
    }

    const { fileId } = params

    // Create file service with user context for permission checking
    const fileService = createFileService(organizationId, session.user.id)

    // Just check if file exists and user has access
    const file = await fileService.get(fileId)
    if (!file) {
      return new Response('File not found', { status: 404 })
    }

    // Return only headers, no body
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': file.size?.toString() || '0',
        'Content-Disposition': `attachment; filename="${file.name}"`,
      },
    })
  } catch (error) {
    logger.error('Error checking file:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
