// apps/web/src/app/api/files/download/[fileId]/route.ts

import { database } from '@auxx/database'
import { AuxxError, NotFoundError } from '@auxx/lib/errors'
import type { FilesCtx } from '@auxx/lib/files/server'
import {
  createFileDownloadResponse,
  createStorageManager,
  getAsset,
  getAssetCurrentVersion,
  getFolderFile,
  getFolderFileCurrentVersion,
  parseRangeHeader,
} from '@auxx/lib/files/server'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { isFileRef, parseFileRef } from '@auxx/types/file-ref'
import type { Result } from 'neverthrow'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-files-download')

/**
 * Unwrap a `files/` `Result` into this handler's throw-based flow.
 *
 * The error is always an `AuxxError` subclass, and the outer `catch` in each
 * handler maps anything it does not recognise to a 500 — same shape the
 * `FileService` facade produced when it threw.
 */
function unwrap<V>(result: Result<V, Error>): V {
  if (result.isErr()) throw result.error
  return result.value
}

interface RouteParams {
  params: Promise<{ fileId: string }>
}

/**
 * Session + `files.view` gate shared by GET and HEAD.
 *
 * Returns the resolved caller on success, or the `Response` to send back.
 *
 * Both handlers previously authenticated with `auth.api.getSession` alone and
 * read no capabilities: the file read scopes on organization + soft-delete
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
  { ok: true; organizationId: string } | { ok: false; response: Response }
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

  // No `userId` on the way out: `files/` functions take no actor
  // (`files/ctx.ts`), and the only reader was the service constructor.
  return { ok: true, organizationId }
}

/**
 * Read the current bytes behind a `FolderFile` or a `MediaAsset`.
 *
 * Content still goes through `StorageManager`, and the old reason recorded here
 * — "neither library has a content-read function" — is **out of date**:
 * `getAssetContent` and `getFolderFileContent` both landed in #1859, and both
 * take an entity id rather than a location id.
 *
 * What actually keeps this handler on `StorageManager` is its *shape*. It
 * resolves the row and its current version first (for `name` / `mimeType` /
 * `size`, which the response headers need), and then reads the bytes off the
 * version's `storageLocationId`. Moving to `getAssetContent(ctx, deps, id)`
 * would re-resolve the asset and the version a second time. Collapsing the two
 * halves properly belongs with the rest of this handler, not with the facade
 * deletion — see PR Y's retro.
 */
async function readCurrentContent(
  storageLocationId: string | null | undefined,
  entityId: string,
  organizationId: string
): Promise<Buffer> {
  if (!storageLocationId) {
    throw new NotFoundError(`No storage location found for ${entityId}`)
  }
  return createStorageManager(organizationId).getContent(storageLocationId)
}

/**
 * Resolve a fileId param to a content buffer and metadata.
 * Accepts plain file IDs or FileRef strings (e.g. "asset:abc123", "file:xyz456").
 */
async function resolveFile(
  fileIdOrRef: string,
  organizationId: string
): Promise<{ content: Buffer; name: string; mimeType: string | null; size: number | null } | null> {
  // `organizationId` is REQUIRED on a `FilesCtx`. Both services took an optional
  // one and `BaseService.buildBaseWhereClause` guarded its organization filter
  // with `if (this.organizationId)` — a service built without one read across
  // every tenant. The handler cannot express that now.
  const ctx: FilesCtx = { db: database, organizationId }

  // Check if this is a FileRef (asset:id or file:id)
  if (isFileRef(fileIdOrRef)) {
    const { sourceType, id } = parseFileRef(fileIdOrRef)

    if (sourceType === 'asset') {
      const asset = unwrap(await getAsset(ctx, id))
      if (!asset) return null
      const version = unwrap(await getAssetCurrentVersion(ctx, id))
      const content = await readCurrentContent(version?.storageLocationId, id, organizationId)
      return { content, name: asset.name ?? id, mimeType: asset.mimeType, size: asset.size }
    }

    // sourceType === 'file' — fall through with the extracted id
    fileIdOrRef = id
  }

  const file = unwrap(await getFolderFile(ctx, fileIdOrRef))
  if (!file) return null
  const version = unwrap(await getFolderFileCurrentVersion(ctx, fileIdOrRef))
  const content = await readCurrentContent(version?.storageLocationId, fileIdOrRef, organizationId)
  return { content, name: file.name, mimeType: file.mimeType, size: file.size }
}

/** Media the browser paints in place rather than saving to disk. */
const INLINE_MIME_PREFIXES = ['image/', 'video/', 'audio/']

/**
 * Whether to answer with `Content-Disposition: inline`.
 *
 * This route is the ONLY URL the app has for a FILE field's content — every
 * `<img src>` that shows an attached photo points here (`file-picker`,
 * `display-file`, `line-photo-popover`, and the stable avatar URL a just-saved
 * FILE field resolves to). It used to hard-code `inline: false`, so each of those
 * requests answered `Content-Disposition: attachment`, which no browser paints
 * into an `<img>`: the request succeeded, logged, and returned bytes, and the
 * image silently rendered as nothing. For an avatar that meant `AvatarImage`
 * failing and Radix showing `AvatarFallback` — the record's own icon — which
 * reads exactly like the upload never happened.
 *
 * `video/` and `audio/` join images because the range-request branch in
 * `createFileDownloadResponse` only means anything to a `<video>`/`<audio>`
 * element, and those never load from an attachment either.
 *
 * Everything else (PDFs, archives, documents) keeps saving to disk, and
 * `?download=1` forces that for any type. `<a download>` already overrides
 * disposition for same-origin links, so the existing download buttons are
 * unaffected either way.
 *
 * `image/svg+xml` is the one image type deliberately EXCLUDED. An SVG is an XML
 * document that can carry `<script>`, and FILE custom fields accept any mime by
 * default — served inline, an uploaded SVG navigated to directly would execute
 * with the viewer's session on the app origin (`nosniff` is no help when the
 * declared type IS svg; `ArticleProcessor` documents the same hazard).
 * Attachment disposition is what prevented that before this route learned
 * inline, so SVGs keep it — an inline SVG preview is not worth a stored XSS.
 */
function shouldRenderInline(mimeType: string | null, request: NextRequest): boolean {
  if (request.nextUrl.searchParams.get('download') === '1') return false
  if (!mimeType) return false
  if (mimeType === 'image/svg+xml') return false
  return INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
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

    const resolved = await resolveFile(fileId, caller.organizationId)
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
        inline: shouldRenderInline(resolved.mimeType, request),
      }
    )

    return new Response(new Uint8Array(downloadResponse.buffer), {
      status: downloadResponse.status,
      headers: downloadResponse.headers,
    })
  } catch (error) {
    logger.error('Error downloading file:', error)
    return new Response('Internal server error', { status: 500 })
  }
}

export async function HEAD(request: NextRequest, { params }: RouteParams) {
  try {
    const { fileId } = await params

    if (!fileId) {
      return new Response('File ID is required', { status: 400 })
    }

    const caller = await authorize()
    if (!caller.ok) return caller.response

    const resolved = await resolveFile(fileId, caller.organizationId)
    if (!resolved) {
      return new Response('File not found', { status: 404 })
    }

    // Same header construction as GET, body omitted. HEAD used to hand-roll its
    // own headers — hard-coded `attachment`, no `?download=1`, no Accept-Ranges,
    // no Cache-Control — so a client preflighting with HEAD (a video player
    // probing range support, a link-preview service checking disposition) was
    // told the resource is a non-rangeable attachment that the subsequent GET
    // then serves inline. Per RFC 9110 the two methods must agree.
    const downloadResponse = createFileDownloadResponse(
      resolved.content,
      {
        name: resolved.name,
        mimeType: resolved.mimeType,
        size: resolved.size,
      },
      { inline: shouldRenderInline(resolved.mimeType, request) }
    )

    return new Response(null, {
      status: downloadResponse.status,
      headers: downloadResponse.headers,
    })
  } catch (error) {
    logger.error('Error checking file:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
