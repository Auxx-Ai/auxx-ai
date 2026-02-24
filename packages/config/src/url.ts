// packages/config/src/url.ts

/**
 * APP_REGISTRY — Single source of truth for all app URLs, ports, and subdomains.
 *
 * Resolution order:
 *   1. Explicit URL env var (APP_URL, API_URL, etc.)
 *   2. DOMAIN env var + subdomain pattern
 *   3. localhost:${PORT_ENV || defaultPort}
 */

const APP_REGISTRY = {
  web: {
    defaultPort: 3000,
    portEnv: 'WEB_PORT',
    subdomain: 'app',
    urlEnv: 'APP_URL',
    visibility: 'public',
  },
  homepage: {
    defaultPort: 3001,
    portEnv: 'HOMEPAGE_PORT',
    subdomain: null,
    urlEnv: 'HOMEPAGE_URL',
    visibility: 'public',
  },
  kb: {
    defaultPort: 3002,
    portEnv: 'KB_PORT',
    subdomain: 'kb',
    urlEnv: 'KB_URL',
    visibility: 'public',
  },
  docs: {
    defaultPort: 3004,
    portEnv: 'DOCS_PORT',
    subdomain: 'docs',
    urlEnv: 'DOCS_URL',
    visibility: 'public',
  },
  worker: {
    defaultPort: 3005,
    portEnv: 'WORKER_PORT',
    subdomain: 'worker',
    urlEnv: null,
    visibility: 'internal',
  },
  build: {
    defaultPort: 3006,
    portEnv: 'BUILD_PORT',
    subdomain: 'build',
    urlEnv: 'DEV_PORTAL_URL',
    visibility: 'public',
  },
  api: {
    defaultPort: 3007,
    portEnv: 'API_PORT',
    subdomain: 'api',
    urlEnv: 'API_URL',
    visibility: 'public',
  },
  lambda: {
    defaultPort: 3008,
    portEnv: 'LAMBDA_PORT',
    subdomain: 'lambda',
    urlEnv: 'LAMBDA_EXECUTOR_URL',
    visibility: 'internal',
  },
} as const

type AppName = keyof typeof APP_REGISTRY

// ─── Internal helpers ────────────────────────────────────

function readEnv(key: string): string | undefined {
  const value = process.env[key]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function buildUrl(base: string, path: string): string {
  const sanitizedBase = base.replace(/\/+$/, '')
  return `${sanitizedBase}${normalizePath(path)}`
}

// ─── Core resolution ─────────────────────────────────────

/** Get the effective dev port for an app (supports override via env var). */
export function getDevPort(app: AppName): number {
  const entry = APP_REGISTRY[app]
  const override = process.env[entry.portEnv]
  return override ? Number.parseInt(override, 10) : entry.defaultPort
}

/** Resolve the full URL for any app in any environment. */
function resolveAppUrl(app: AppName): string {
  const entry = APP_REGISTRY[app]

  // 1. Explicit URL env var always wins
  if (entry.urlEnv) {
    const override = readEnv(entry.urlEnv)
    if (override) return override
  }

  // 2. DOMAIN env var → derive from subdomain pattern
  const domain = readEnv('DOMAIN')
  if (domain) {
    return entry.subdomain ? `https://${entry.subdomain}.${domain}` : `https://${domain}`
  }

  // 3. Fallback: localhost with (overridable) port
  return `http://localhost:${getDevPort(app)}`
}

// ─── Hostname & domain helpers ───────────────────────────

/** Hostname of a given app (e.g. "app.dev.auxx.ai" or "localhost"). */
function getHostname(app: AppName = 'web'): string {
  try {
    return new URL(resolveAppUrl(app)).hostname
  } catch {
    return 'localhost'
  }
}

/**
 * Root domain for cookie scoping.
 * ".dev.auxx.ai" in dev stage, ".auxx.ai" in prod, undefined for localhost.
 */
export function getCookieDomain(): string | undefined {
  const domain = readEnv('DOMAIN')
  if (domain) return `.${domain}`

  const hostname = getHostname('web')
  if (hostname === 'localhost' || hostname === '127.0.0.1') return undefined

  const parts = hostname.split('.')
  return parts.length >= 2 ? `.${parts.slice(1).join('.')}` : undefined
}

/**
 * Passkey relying party ID (bare hostname).
 * "localhost" in dev, "app.dev.auxx.ai" in dev stage, "app.auxx.ai" in prod.
 */
export function getPasskeyRpId(): string {
  const hostname = getHostname('web')
  return hostname === '127.0.0.1' ? 'localhost' : hostname
}

/**
 * Extracts hostname from WEBAPP_URL (e.g. "app.example.com").
 * Kept for backward compatibility — prefer getHostname('web').
 */
export function getAppHostname(): string {
  return getHostname('web')
}

// ─── Trusted origins & hostnames ─────────────────────────

/** All public trusted origins (full URLs with protocol). For CORS and auth. */
export function getTrustedOrigins(): string[] {
  return (Object.keys(APP_REGISTRY) as AppName[])
    .filter((app) => APP_REGISTRY[app].visibility === 'public')
    .map(resolveAppUrl)
}

/** All trusted hostnames (bare). For redirect validation. */
export function getTrustedHostnames(): string[] {
  const hostnames = new Set<string>(['localhost'])
  for (const app of Object.keys(APP_REGISTRY) as AppName[]) {
    if (APP_REGISTRY[app].visibility === 'public') {
      hostnames.add(getHostname(app))
    }
  }
  const domain = readEnv('DOMAIN')
  if (domain) hostnames.add(domain)
  return Array.from(hostnames)
}

/**
 * Checks if a hostname is trusted by matching against trusted hostnames.
 * Supports exact match and subdomain match.
 *
 * NOTE: Uses process.env (dynamic access) — only works server-side.
 * For client-side code, use {@link isTrustedHostnameFromUrls} with env from useEnv().
 */
export function isTrustedHostname(hostname: string): boolean {
  const trusted = getTrustedHostnames()
  return trusted.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * Client-safe version of isTrustedHostname.
 * Accepts the DehydratedEnvironment object (from useEnv()) to derive trusted hostnames.
 */
export function isTrustedHostnameFromUrls(
  hostname: string,
  env: {
    domain: string
    appUrl: string
    apiUrl: string
    homepageUrl: string
    docsUrl: string
    devPortalUrl: string
  }
): boolean {
  const trusted = new Set<string>(['localhost'])
  if (env.domain) trusted.add(env.domain)
  for (const url of [env.appUrl, env.apiUrl, env.homepageUrl, env.docsUrl, env.devPortalUrl]) {
    if (!url) continue
    try {
      trusted.add(new URL(url).hostname)
    } catch {}
  }
  return [...trusted].some((d) => hostname === d || hostname.endsWith(`.${d}`))
}

// ─── Stable exports (zero consumer changes) ─────────────

export const WEBAPP_URL = resolveAppUrl('web')
export const HOMEPAGE_URL = resolveAppUrl('homepage')
export const DOCS_URL = resolveAppUrl('docs')
export const DEV_PORTAL_URL = resolveAppUrl('build')
export const API_URL = resolveAppUrl('api')
export const SERVER_FUNCTION_EXECUTOR_URL = resolveAppUrl('lambda')

/** API URL that Lambda should use to call back to the platform API. */
export const LAMBDA_API_URL =
  readEnv('LAMBDA_API_URL') || readEnv('API_URL') || resolveAppUrl('api')

// ─── URL builder helpers ─────────────────────────────────

/** Returns the marketing homepage URL, optionally appending a path segment. */
export function getHomepageUrl(path = ''): string {
  return buildUrl(HOMEPAGE_URL, path)
}

/** Returns the API server URL, optionally appending a path segment. */
export function getApiUrl(path = ''): string {
  return buildUrl(API_URL, path)
}

/** Returns the Lambda executor URL, optionally appending a path segment. */
export function getLambdaExecutorUrl(path = ''): string {
  return buildUrl(SERVER_FUNCTION_EXECUTOR_URL, path)
}
