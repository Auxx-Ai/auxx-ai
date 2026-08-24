// packages/lib/src/files/fetch-remote-image.ts

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createAssetWithVersion } from './assets'
import { detectImageType } from './core/image-processing'
import { createStorageManager } from './storage/storage-manager'
import { ALLOWED_IMAGE_TYPES } from './thumbnails/presets'

/**
 * Shared "fetch a remote image URL → store it as a MediaAsset" pipeline.
 *
 * Used by the company-website enrichment trigger (homepage logo candidates)
 * and by the extension's avatar upload endpoint (LinkedIn profile / company
 * avatar URLs captured during Save to Auxx).
 *
 * Flow: SSRF-guard the URL → fetch with timeout → sniff the real image type
 * from magic bytes and enforce the thumbnailable allowlist → upload bytes to S3
 * → create StorageLocation → create MediaAsset+Version → return `asset:<id>`
 * ref consumable by FILE fields.
 */

const logger = createScopedLogger('files:fetch-remote-image')

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5_000_000
const USER_AGENT = 'AuxxAi-Enrichment/1.0 (+https://auxx.ai/bot)'

export interface FetchRemoteImageInput {
  /**
   * The client the `MediaAsset` + version write runs on.
   *
   * Required, not defaulted: this used to construct
   * `createMediaAssetService(organizationId, userId)`, whose `db` defaulted to
   * the process-wide pool, so a caller already inside a transaction wrote
   * outside it. Routers pass `ctx.db`; background triggers pass the pool
   * explicitly.
   */
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
  /** Fetch timeout. Defaults to 10 s. */
  timeoutMs?: number
}

export interface FetchRemoteImageResult {
  assetId: string
  /** `asset:<assetId>` — the ref shape FILE fields expect. */
  ref: string
  mimeType: string
  size: number
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
  } = input

  assertPublicHost(url)

  const res = await fetchWithTimeout(url, timeoutMs)
  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0) {
    throw new Error('Empty response body')
  }
  if (buf.byteLength > maxBytes) {
    throw new Error(`Response too large: ${buf.byteLength} > ${maxBytes}`)
  }

  // Determine the real image type from the bytes rather than trusting the
  // Content-Type header — many `/favicon.ico` URLs serve PNG bytes labelled
  // `image/x-icon` (and vice versa). Uses magic bytes with an SVG text-sniff
  // fallback (SVG has none). Only accept types the thumbnail pipeline can
  // render — its `normalizeImageSource` step decodes ICO and rasterizes SVG to
  // PNG, so both are in the allowlist even though sharp can't read them raw.
  const mimeType = await detectImageType(buf)
  if (
    !mimeType ||
    !ALLOWED_IMAGE_TYPES.includes(mimeType as (typeof ALLOWED_IMAGE_TYPES)[number])
  ) {
    throw new Error(`Unsupported image type: ${mimeType ?? 'undetected'}`)
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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
    })
  } finally {
    clearTimeout(timer)
  }
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

/**
 * Reject URLs that resolve to private/loopback/link-local IP addresses to
 * avoid server-side request forgery against internal services.
 * Also rejects non-http(s) protocols and bare hostnames that are explicitly
 * private (localhost, *.local, *.internal).
 *
 * Exported so other server-side fetch paths (e.g. website metadata scrapes)
 * can share the same allowlist.
 */
export function assertPublicHost(urlStr: string): void {
  const url = new URL(urlStr)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
  }

  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '0.0.0.0'
  ) {
    throw new Error(`Refusing to fetch private hostname: ${hostname}`)
  }

  // Literal IPv4 check
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224
    if (isPrivate) {
      throw new Error(`Refusing to fetch private IP: ${hostname}`)
    }
  }

  // Literal IPv6 loopback / link-local
  if (hostname.startsWith('[::1]') || hostname === '::1' || hostname.startsWith('fe80:')) {
    throw new Error(`Refusing to fetch private IPv6: ${hostname}`)
  }
}
