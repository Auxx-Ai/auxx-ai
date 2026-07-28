// apps/web/src/app/api/files/download/[fileId]/route.ts

import { AuxxError } from '@auxx/lib/errors'
import {
  createFileDownloadResponse,
  createFileService,
  parseRangeHeader,
} from '@auxx/lib/files/server'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
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
 * Session + `files.view` gate shared by GET and HEAD.
 *
 * Returns the resolved caller on success, or the `Response` to send back.
 *
 * Both handlers previously authenticated with `auth.api.getSession` alone and
 * read no capabilities: `FileService.get` scopes on organization + soft-delete
 * only, so any authenticated member of the org could stream the CONTENT of any
 * `FolderFile` or `MediaAsset` (GET), or read its name/size/mimeType (HEAD),
 * simply by knowing — or guessing — an id. The eight file reads on the tRPC
 * sibling `fileRouter` (`list`, `getById`, `search`, `getDownloadInfo`, …) all
 * sit behind `permissionProcedure(PermissionKey.filesView)`; this route is the
 * same read, so it takes the same key.
 *
 * {@link requirePermission} runs the identical pair `permissionProcedure` runs:
 * the `FeatureKey.files` plan gate, then `getCapabilities(...).assert(...)`.
 * It THROWS an {@link AuxxError} rather than returning a boolean, and an App
 * Router handler has no `auxxErrorMiddleware`/`errorFormatter` in the path — so
 * the throw is mapped to `error.statusCode` here (403 for the `ForbiddenError`
 * both gates raise). Anything that is not an `AuxxError` is rethrown, so a
 * genuine failure surfaces as the handler's 500 instead of masquerading as a
 * permission denial. Same shape as the sibling
 * `api/files/upload/sessions/route.ts`.
 *
 * The gate deliberately runs **before** {@link resolveFile}, so an unauthorized
 * caller cannot probe file existence through the 404-vs-200 difference either.
 */
async function authorize(): Promise<
  { ok: true; organizationId: string; userId: string } | { ok: false; response: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return { ok: false, response: new Response('Unauthorized', { status: 401 }) }
  }

  const organizationId = (session.user as any).defaultOrganizationId
  if (!organizationId) {
    return { ok: false, response: new Response('Organization ID is required', { status: 400 }) }
  }

  try {
    await requirePermission(session.user.id, organizationId, PermissionKey.filesView)
  } catch (error) {
    if (error instanceof AuxxError) {
      return { ok: false, response: new Response(error.message, { status: error.statusCode }) }
    }
    throw error
  }

  return { ok: true, organizationId, userId: session.user.id }
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

    if (!fileId) {
      return new Response('File ID is required', { status: 400 })
    }

    const caller = await authorize()
    if (!caller.ok) return caller.response

    logger.info(`Downloading file: ${fileId}`)

    const resolved = await resolveFile(fileId, caller.organizationId, caller.userId)
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

    if (!fileId) {
      return new Response('File ID is required', { status: 400 })
    }

    const caller = await authorize()
    if (!caller.ok) return caller.response

    const resolved = await resolveFile(fileId, caller.organizationId, caller.userId)
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
