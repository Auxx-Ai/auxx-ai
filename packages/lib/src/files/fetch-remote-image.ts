// packages/lib/src/files/fetch-remote-image.ts

import { createScopedLogger } from '@auxx/logger'
import { createMediaAssetService } from './core/media-asset-service'
import { createStorageManager } from './storage/storage-manager'

/**
 * Shared "fetch a remote image URL → store it as a MediaAsset" pipeline.
 *
 * Used by the company-website enrichment trigger (homepage logo candidates)
 * and by the extension's avatar upload endpoint (LinkedIn profile / company
 * avatar URLs captured during Save to Auxx).
 *
 * Flow: SSRF-guard the URL → fetch with timeout → validate content-type + size
 * → upload bytes to S3 → create StorageLocation → create MediaAsset+Version →
 * return `asset:<id>` ref consumable by FILE fields.
 */

const logger = createScopedLogger('files:fetch-remote-image')

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5_000_000
const USER_AGENT = 'AuxxAi-Enrichment/1.0 (+https://auxx.ai/bot)'

export interface FetchRemoteImageInput {
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

  const contentType = (res.headers.get('content-type') || 'image/x-icon').split(';')[0]!.trim()
  if (!contentType.startsWith('image/')) {
    throw new Error(`Unsupported content-type: ${contentType}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0) {
    throw new Error('Empty response body')
  }
  if (buf.byteLength > maxBytes) {
    throw new Error(`Response too large: ${buf.byteLength} > ${maxBytes}`)
  }

  const storageManager = createStorageManager(organizationId)
  const key = `${organizationId}/${pathPrefix}/${Date.now()}-${cryptoRandomHex()}${extensionFor(contentType)}`

  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key,
    content: buf,
    mimeType: contentType,
    size: buf.byteLength,
    visibility: 'PUBLIC',
    organizationId,
  })

  const mediaAssetService = createMediaAssetService(organizationId, userId)
  const { asset } = await mediaAssetService.createWithVersion(
    {
      kind: 'SYSTEM_BLOB',
      purpose,
      name,
      mimeType: contentType,
      size: BigInt(buf.byteLength),
      isPrivate: false,
      organizationId,
      createdById: userId,
    },
    storageLocation.id
  )

  logger.debug('Fetched remote image', {
    organizationId,
    purpose,
    assetId: asset.id,
    mimeType: contentType,
    size: buf.byteLength,
  })

  return {
    assetId: asset.id,
    ref: `asset:${asset.id}`,
    mimeType: contentType,
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
