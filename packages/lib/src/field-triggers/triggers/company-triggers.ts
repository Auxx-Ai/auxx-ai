// packages/lib/src/field-triggers/triggers/company-triggers.ts

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { load } from 'cheerio'
import { createMediaAssetService } from '../../files/core/media-asset-service'
import { createStorageManager } from '../../files/storage/storage-manager'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { SystemUserService } from '../../users/system-user-service'
import type { EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-triggers:company')

const HTML_FETCH_TIMEOUT_MS = 8000
const FAVICON_FETCH_TIMEOUT_MS = 5000
const MAX_HTML_BYTES = 500_000
const MAX_FAVICON_BYTES = 1_000_000
const USER_AGENT = 'AuxxAi-Enrichment/1.0 (+https://auxx.ai/bot)'

/**
 * Enrich a company from its website on create.
 *
 * Fetches the company's homepage and extracts:
 * - Clean site name (from og:site_name or <title>) → company_name
 * - Description (from og:description or meta description) → company_notes
 * - Logo (apple-touch-icon, og:image, favicon) → company_logo
 *
 * Never overwrites user-edited values: only replaces company_name when it
 * equals the raw domain, and only fills company_notes / company_logo when empty.
 */
export const enrichCompanyOnCreate: EntityTriggerHandler = async (event) => {
  if (event.action !== 'created') return

  const domain = event.values.company_domain
  if (!domain || typeof domain !== 'string') {
    logger.debug('Skipping enrichment — no domain', { entityInstanceId: event.entityInstanceId })
    return
  }

  const { organizationId, entityInstanceId, entityDefinitionId } = event
  const recordId = toRecordId(entityDefinitionId, entityInstanceId)

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const crud = new UnifiedCrudHandler(organizationId, systemUserId)

  const currentName = typeof event.values.company_name === 'string' ? event.values.company_name : ''
  const currentNotes = event.values.company_notes
  const currentLogo = event.values.company_logo

  const websiteUrl = `https://${domain}`

  try {
    await crud.update(recordId, { company_enrichment_status: 'pending' })

    const metadata = await fetchWebsiteMetadata(websiteUrl)
    const logoAssetId = await fetchAndStoreLogo({
      organizationId,
      userId: systemUserId,
      metadata,
    })

    const updates: Record<string, unknown> = {
      company_enrichment_status: 'enriched',
      company_enriched_at: new Date(),
    }

    if (metadata.siteName && currentName === domain) {
      updates.company_name = metadata.siteName
    }
    if (metadata.description && !currentNotes) {
      updates.company_notes = metadata.description
    }
    if (logoAssetId && !currentLogo) {
      updates.company_logo = { ref: `asset:${logoAssetId}` }
    }

    await crud.update(recordId, updates)

    logger.info('Company enriched', {
      organizationId,
      companyId: entityInstanceId,
      domain,
      applied: Object.keys(updates),
    })
  } catch (err) {
    logger.error('Enrichment failed', {
      organizationId,
      companyId: entityInstanceId,
      domain,
      error: (err as Error).message,
    })
    await crud.update(recordId, {
      company_enrichment_status: 'failed',
      company_enriched_at: new Date(),
    })
  }
}

// ─── Metadata fetch ────────────────────────────────────────────────────

interface WebsiteMetadata {
  siteName: string | null
  description: string | null
  faviconUrl: string | null
  appleTouchIconUrl: string | null
  ogImageUrl: string | null
}

async function fetchWebsiteMetadata(url: string): Promise<WebsiteMetadata> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTML_FETCH_TIMEOUT_MS)

  try {
    assertPublicHost(url)

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!res.ok) {
      logger.warn('Non-OK response fetching website', { url, status: res.status })
      return emptyMetadata()
    }

    const reader = res.body?.getReader()
    if (!reader) return emptyMetadata()

    const chunks: Uint8Array[] = []
    let total = 0
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
    await reader.cancel()

    const html = new TextDecoder('utf-8', { fatal: false }).decode(
      Buffer.concat(chunks.map((c) => Buffer.from(c)))
    )

    const $ = load(html)

    const rawTitle = $('title').first().text().trim()
    const titleFirstSegment = rawTitle ? rawTitle.split(/[|\-—]/)[0]?.trim() : null

    const siteName =
      $('meta[property="og:site_name"]').attr('content')?.trim() ||
      $('meta[name="application-name"]').attr('content')?.trim() ||
      titleFirstSegment ||
      null

    const description =
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="description"]').attr('content')?.trim() ||
      null

    const faviconUrl = resolveUrl(
      url,
      $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        '/favicon.ico'
    )

    const appleTouchIconUrl = resolveUrl(url, $('link[rel="apple-touch-icon"]').attr('href'))
    const ogImageUrl = resolveUrl(url, $('meta[property="og:image"]').attr('content'))

    return {
      siteName: truncate(siteName, 120),
      description: truncate(description, 500),
      faviconUrl,
      appleTouchIconUrl,
      ogImageUrl,
    }
  } catch (err) {
    logger.warn('Fetch website metadata failed', { url, error: (err as Error).message })
    return emptyMetadata()
  } finally {
    clearTimeout(timer)
  }
}

// ─── Logo fetch + store ────────────────────────────────────────────────

async function fetchAndStoreLogo(args: {
  organizationId: string
  userId: string
  metadata: WebsiteMetadata
}): Promise<string | null> {
  // apple-touch-icon is usually the cleanest "logo-like" asset, followed by
  // og:image, then the tiny favicon as a last resort.
  const candidates = [
    args.metadata.appleTouchIconUrl,
    args.metadata.ogImageUrl,
    args.metadata.faviconUrl,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)

  for (const url of candidates) {
    try {
      assertPublicHost(url)

      const res = await fetchWithTimeout(url, FAVICON_FETCH_TIMEOUT_MS)
      if (!res.ok) continue

      const contentType = (res.headers.get('content-type') || 'image/x-icon').split(';')[0]!.trim()
      if (!contentType.startsWith('image/')) continue

      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength === 0 || buf.byteLength > MAX_FAVICON_BYTES) continue

      const storageManager = createStorageManager(args.organizationId)
      const key = `${args.organizationId}/company-logos/${Date.now()}-${cryptoRandomHex()}${extensionFor(contentType)}`

      const storageLocation = await storageManager.uploadContent({
        provider: 'S3',
        key,
        content: buf,
        mimeType: contentType,
        size: buf.byteLength,
        visibility: 'PUBLIC',
        organizationId: args.organizationId,
      })

      const mediaAssetService = createMediaAssetService(args.organizationId, args.userId)
      const { asset } = await mediaAssetService.createWithVersion(
        {
          kind: 'SYSTEM_BLOB',
          purpose: 'company-logo',
          name: 'company-logo',
          mimeType: contentType,
          size: BigInt(buf.byteLength),
          isPrivate: false,
          organizationId: args.organizationId,
          createdById: args.userId,
        },
        storageLocation.id
      )

      return asset.id
    } catch (err) {
      logger.debug('Logo candidate failed', { url, error: (err as Error).message })
    }
  }

  return null
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

// ─── Helpers ───────────────────────────────────────────────────────────

function emptyMetadata(): WebsiteMetadata {
  return {
    siteName: null,
    description: null,
    faviconUrl: null,
    appleTouchIconUrl: null,
    ogImageUrl: null,
  }
}

function resolveUrl(base: string, href: string | null | undefined): string | null {
  if (!href) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function truncate(s: string | null, max: number): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
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
 */
function assertPublicHost(urlStr: string): void {
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
