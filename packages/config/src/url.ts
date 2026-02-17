// packages/config/src/url.ts

/** Default marketing homepage URL for local development. */
const DEFAULT_HOMEPAGE_URL = 'http://localhost:3001'

/** Default authenticated app URL for local development. */
// const DEFAULT_AUTH_APP_URL = 'https://app.dev.auxx.ai' //'http://localhost:3000'
const DEFAULT_AUTH_APP_URL = 'http://localhost:3000'

/** Default developer portal URL for local development. */
const DEFAULT_DEV_PORTAL_URL = 'http://localhost:3006'

/** Default docs URL for local development. */
const DEFAULT_DOCS_URL = 'http://localhost:3004'

/** Default dedicated API server URL for local development (apps/api). */
const DEFAULT_API_SERVER_URL = 'http://localhost:3007'

/** Default Lambda executor URL for local development (apps/lambda). */
const DEFAULT_LAMBDA_EXECUTOR_URL = 'http://localhost:3008'

/**
 * Normalizes an incoming path by ensuring a single leading slash when a value is provided.
 */
function normalizePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Builds a URL given a base and optional path component.
 */
function buildUrl(base: string, path: string): string {
  const sanitizedBase = base.replace(/\/+$/, '')
  return `${sanitizedBase}${normalizePath(path)}`
}

function readEnv(key: string): string | undefined {
  const value = process.env[key]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function sanitizeUrl(value?: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pickUrl(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return undefined
}

// const fallbackHostedUrls = [
//   sanitizeUrl(
//     process.env.NEXT_PUBLIC_VERCEL_URL && `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
//   ),
//   sanitizeUrl(process.env.RAILWAY_STATIC_URL && `https://${process.env.RAILWAY_STATIC_URL}`),
//   sanitizeUrl(
//     process.env.HEROKU_APP_NAME && `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`
//   ),
//   sanitizeUrl(process.env.RENDER_EXTERNAL_URL),
// ]

/**
 * Base public URL for the authenticated web application.
 */
// export const WEBAPP_URL =
//   pickUrl(readEnv('NEXT_PUBLIC_BASE_URL'), ...fallbackHostedUrls, DEFAULT_AUTH_APP_URL) ??
//   DEFAULT_AUTH_APP_URL
export const WEBAPP_URL = process.env.NEXT_PUBLIC_BASE_URL
  ? process.env.NEXT_PUBLIC_BASE_URL
  : process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : process.env.RAILWAY_STATIC_URL
      ? `https://${process.env.RAILWAY_STATIC_URL}`
      : process.env.HEROKU_APP_NAME
        ? `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`
        : DEFAULT_AUTH_APP_URL

export const HOMEPAGE_URL = process.env.NEXT_PUBLIC_HOMEPAGE_URL
  ? process.env.NEXT_PUBLIC_HOMEPAGE_URL
  : DEFAULT_HOMEPAGE_URL

/**
 * Base public URL for the documentation site.
 */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL
  ? process.env.NEXT_PUBLIC_DOCS_URL
  : DEFAULT_DOCS_URL

/**
 * Base public URL for the developer portal.
 */
export const DEV_PORTAL_URL = process.env.NEXT_PUBLIC_DEV_PORTAL_URL
  ? process.env.NEXT_PUBLIC_DEV_PORTAL_URL
  : process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://build-${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : DEFAULT_DEV_PORTAL_URL

/**
 * Base public URL for the dedicated API server (apps/api).
 * This is a dedicated API server for SDK and external API calls.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL
  : process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://api-${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : DEFAULT_API_SERVER_URL

/**
 * Base URL for the Lambda server function executor (apps/lambda).
 * This is used by the API to invoke server functions from extensions.
 */
export const SERVER_FUNCTION_EXECUTOR_URL = process.env.SERVER_FUNCTION_EXECUTOR_URL
  ? process.env.SERVER_FUNCTION_EXECUTOR_URL
  : process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://lambda-${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : DEFAULT_LAMBDA_EXECUTOR_URL

/**
 * API URL that Lambda should use to call back to the platform API.
 * In development (Docker on macOS), this uses host.docker.internal to access the host.
 * In production, this is the same as API_URL.
 */
export const LAMBDA_API_URL = process.env.LAMBDA_API_URL
  ? process.env.LAMBDA_API_URL
  : process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://api-${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'http://host.docker.internal:3007'

/**
 * Returns the marketing homepage URL, optionally appending a path segment.
 */
export function getHomepageUrl(path = ''): string {
  const homepageBase = readEnv('NEXT_PUBLIC_HOMEPAGE_URL')
  const base = pickUrl(homepageBase, DEFAULT_HOMEPAGE_URL) ?? DEFAULT_HOMEPAGE_URL
  return buildUrl(base, path)
}

/**
 * Returns the API server URL, optionally appending a path segment.
 */
export function getApiUrl(path = ''): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || API_URL
  return buildUrl(apiBase, path)
}

/**
 * Returns the Lambda executor URL, optionally appending a path segment.
 */
export function getLambdaExecutorUrl(path = ''): string {
  const base = process.env.SERVER_FUNCTION_EXECUTOR_URL || SERVER_FUNCTION_EXECUTOR_URL
  return buildUrl(base, path)
}

// ============= Domain Helpers for Self-Hosted =============

/**
 * Extracts hostname from WEBAPP_URL (e.g. "app.example.com")
 */
export function getAppHostname(): string {
  try {
    return new URL(WEBAPP_URL).hostname
  } catch {
    return 'localhost'
  }
}

/**
 * Returns cookie domain with leading dot (e.g. ".example.com") or undefined for localhost.
 * Uses DOMAIN env var when available (ccTLD-safe), otherwise derives from WEBAPP_URL.
 */
export function getCookieDomain(): string | undefined {
  const domain = readEnv('DOMAIN')
  if (domain) return `.${domain}`

  const hostname = getAppHostname()
  if (hostname === 'localhost' || hostname === '127.0.0.1') return undefined

  // Strip the first subdomain (e.g. "app.example.com" → ".example.com")
  const parts = hostname.split('.')
  if (parts.length >= 2) {
    return `.${parts.slice(1).join('.')}`
  }

  return undefined
}

/**
 * Returns all trusted hostnames for auth validation (app, api, build subdomains).
 */
export function getTrustedHostnames(): string[] {
  const hostnames = new Set<string>()
  hostnames.add('localhost')

  for (const url of [WEBAPP_URL, DEV_PORTAL_URL, API_URL]) {
    try {
      hostnames.add(new URL(url).hostname)
    } catch {
      // skip invalid URLs
    }
  }

  const domain = readEnv('DOMAIN')
  if (domain) hostnames.add(domain)

  return Array.from(hostnames)
}

/**
 * Returns all trusted origins for CORS/auth (full URLs with protocol).
 */
export function getTrustedOrigins(): string[] {
  return [WEBAPP_URL, DEV_PORTAL_URL, API_URL].filter(Boolean)
}

/**
 * Checks if a hostname is trusted by matching against trusted hostnames.
 * Supports exact match and subdomain match (e.g. "app.example.com" matches "example.com").
 */
export function isTrustedHostname(hostname: string): boolean {
  const trusted = getTrustedHostnames()
  return trusted.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}
