// packages/lib/src/files/fetch-remote-image.ts

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, BadRequestError } from '../errors'
import { safeFetch } from '../net/safe-fetch'
import { createAssetWithVersion } from './assets'
import { detectImageType } from './core/image-processing'
import { assertStorageQuota } from './lifecycle/quota-cleanup'
import { createStorageManager } from './storage/storage-manager'
import { ALLOWED_IMAGE_TYPES } from './thumbnails/presets'

// Fetch a remote image URL through the SSRF guard and store it as a PUBLIC `SYSTEM_BLOB` MediaAsset.

const logger = createScopedLogger('files:fetch-remote-image')

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5_000_000
const USER_AGENT = 'AuxxAi-Enrichment/1.0 (+https://auxx.ai/bot)'

export interface FetchRemoteImageInput {
  /** The client the `MediaAsset` + version write runs on; pass `ctx.db` inside a transaction. */
  db: Database | Transaction
  url: string
  organizationId: string
  userId: string
  /** Storage path prefix, e.g. 'company-logos' or 'contact-avatars' */
  pathPrefix: string
  /** MediaAsset.purpose (e.g. 'company-logo', 'contact-avatar') */
  purpose: string
  /** MediaAsset.name (display name on the row) */
  name: string
  /** Hard cap on fetched bytes. Defaults to 5 MB. */
  maxBytes?: number
  /** Whole-request timeout. Defaults to 10 s. */
  timeoutMs?: number
  /** SVG can carry external references, so it is refused unless the caller opts in. */
  allowSvg?: boolean
  /** For callers that already checked the storage quota once for a batch. */
  skipQuotaCheck?: boolean
}

export interface FetchRemoteImageResult {
  assetId: string
  /** `asset:<assetId>` — the ref shape FILE fields expect. */
  ref: string
  mimeType: string
  size: number
}

/**
 * Whether a `fetchAndStoreRemoteImage` failure is worth retrying: timeouts, 5xx and network
 * errors are; `AuxxError`s (blocked, too large, not an image, 4xx, quota) are not.
 */
export function isRetryableFetchError(error: unknown): boolean {
  return !(error instanceof AuxxError)
}

/** Rewrites Dropbox and Google Drive share links, which serve an HTML page, to their direct-download form. */
export function normalizeImageUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return url
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    parsed.searchParams.delete('dl')
    parsed.searchParams.set('raw', '1')
    return parsed.toString()
  }
  const driveId = host === 'drive.google.com' && parsed.pathname.match(/^\/file\/d\/([^/]+)/)?.[1]
  if (driveId) return `https://drive.google.com/uc?export=download&id=${driveId}`
  return url
}

export async function fetchAndStoreRemoteImage(
  input: FetchRemoteImageInput
): Promise<FetchRemoteImageResult> {
  const {
    db,
    url,
    organizationId,
    userId,
    pathPrefix,
    purpose,
    name,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowSvg = false,
    skipQuotaCheck = false,
  } = input

  const res = await safeFetch(normalizeImageUrl(url), {
    timeoutMs,
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT },
  })
  if (!res.ok) {
    await res.body?.cancel()
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429
    const message = `Fetch failed: HTTP ${res.status}`
    throw retryable ? new Error(message) : new BadRequestError(message)
  }

  const buf = await readCapped(res, maxBytes)
  if (buf.byteLength === 0) {
    throw new BadRequestError('Empty response body')
  }

  // Sniff the bytes rather than trusting Content-Type: favicons routinely mislabel PNG/ICO.
  const mimeType = await detectImageType(buf)
  const allowed =
    !!mimeType &&
    ALLOWED_IMAGE_TYPES.includes(mimeType as (typeof ALLOWED_IMAGE_TYPES)[number]) &&
    (allowSvg || mimeType !== 'image/svg+xml')
  if (!allowed) {
    throw new BadRequestError(`Unsupported image type: ${mimeType ?? 'undetected'}`)
  }

  if (!skipQuotaCheck) {
    await assertStorageQuota({ db, organizationId }, buf.byteLength)
  }

  const storageManager = createStorageManager(organizationId)
  const key = `${organizationId}/${pathPrefix}/${Date.now()}-${cryptoRandomHex()}${extensionFor(mimeType)}`

  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key,
    content: buf,
    mimeType,
    size: buf.byteLength,
    visibility: 'PUBLIC',
    organizationId,
  })

  const created = await db.transaction(async (tx) => {
    const result = await createAssetWithVersion(
      tx,
      { db: tx, organizationId },
      { now: () => new Date() },
      {
        kind: 'SYSTEM_BLOB',
        purpose,
        name,
        mimeType,
        size: buf.byteLength,
        isPrivate: false,
        createdById: userId,
        storageLocationId: storageLocation.id,
      }
    )
    if (result.isErr()) throw result.error
    return result.value
  })
  const { asset } = created

  logger.debug('Fetched remote image', {
    organizationId,
    purpose,
    assetId: asset.id,
    mimeType,
    size: buf.byteLength,
  })

  return {
    assetId: asset.id,
    ref: `asset:${asset.id}`,
    mimeType,
    size: buf.byteLength,
  }
}

/** Reads the body, refusing on the declared length and again once the running total passes `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => new BadRequestError(`Response too large: over ${maxBytes} bytes`)
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel()
    throw tooLarge()
  }
  if (!res.body) return Buffer.alloc(0)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/svg+xml':
      return '.svg'
    case 'image/webp':
      return '.webp'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico'
    default:
      return ''
  }
}

function cryptoRandomHex(): string {
  // 8 hex chars — plenty for per-second uniqueness inside an org.
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
}
