// apps/web/src/app/api/files/download/[fileId]/route.ts

import {
  createFileDownloadResponse,
  createFileService,
  parseRangeHeader,
} from '@auxx/lib/files/server'
import { createScopedLogger } from '@auxx/logger'
import { isFileRef, parseFileRef } from '@auxx/types/file-ref'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-files-download')

interface RouteParams {
  params: Promise<{ fileId: string }>
}

/**
 * Resolve a fileId param to a content buffer and metadata.
 * Accepts plain file IDs or FileRef strings (e.g. "asset:abc123", "file:xyz456").
 */
async function resolveFile(
  fileIdOrRef: string,
  organizationId: string,
  userId: string
): Promise<{ content: Buffer; name: string; mimeType: string | null; size: number | null } | null> {
  // Check if this is a FileRef (asset:id or file:id)
  if (isFileRef(fileIdOrRef)) {
    const { sourceType, id } = parseFileRef(fileIdOrRef)

    if (sourceType === 'asset') {
      const { MediaAssetService } = await import('@auxx/lib/files/server')
      const assetService = new MediaAssetService(organizationId, userId)
      const asset = await assetService.get(id)
      if (!asset) return null
      const content = await assetService.getContent(id)
      return { content, name: asset.name, mimeType: asset.mimeType, size: asset.size }
    }

    // sourceType === 'file' — fall through with the extracted id
    fileIdOrRef = id
  }

  const fileService = createFileService(organizationId, userId)
  const file = await fileService.get(fileIdOrRef)
  if (!file) return null
  const content = await fileService.getContent(fileIdOrRef)
  return { content, name: file.name, mimeType: file.mimeType, size: file.size }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { fileId } = await params
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization ID is required', { status: 400 })
    }

    if (!fileId) {
      return new Response('File ID is required', { status: 400 })
    }

    logger.info(`Downloading file: ${fileId}`)

    const resolved = await resolveFile(fileId, organizationId, session.user.id)
    if (!resolved) {
      return new Response('File not found', { status: 404 })
    }

    const range = parseRangeHeader(request.headers.get('range'))

    const downloadResponse = createFileDownloadResponse(
      resolved.content,
      {
        name: resolved.name,
        mimeType: resolved.mimeType,
        size: resolved.size,
      },
      {
        range: range || undefined,
        inline: false,
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

export async function HEAD(_request: NextRequest, { params }: RouteParams) {
  try {
    const { fileId } = await params
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const organizationId = (session.user as any).defaultOrganizationId
    if (!organizationId) {
      return new Response('Organization ID is required', { status: 400 })
    }

    const resolved = await resolveFile(fileId, organizationId, session.user.id)
    if (!resolved) {
      return new Response('File not found', { status: 404 })
    }

    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': resolved.mimeType || 'application/octet-stream',
        'Content-Length': resolved.size?.toString() || '0',
        'Content-Disposition': `attachment; filename="${resolved.name}"`,
      },
    })
  } catch (error) {
    logger.error('Error checking file:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
