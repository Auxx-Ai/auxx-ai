// packages/lib/src/ai/mcp/snippet/resolve-mcp-snippet.ts
//
// Network resolution: each parsed candidate → a `ResolvedMcpSnippet`. Remote candidates are probed
// (with their pasted headers) for auth posture; stdio candidates are mapped to a hosted remote via
// the local-only list / known map / official registry, or reported as unresolvable. Every outbound
// fetch goes through the SSRF guard.

import { database as db, schema } from '@auxx/database'
import { isNull } from 'drizzle-orm'
import { discoverMcpAuth } from '../discovery'
import { knownRemote, localOnlyReason } from './known-servers'
import { lookupRegistryRemote, type RegistryRemoteHit } from './mcp-registry-client'
import { extractPackageId, prettifyName, stripPackageAffixes } from './naming'
import { parseMcpSnippet } from './parse-mcp-snippet'
import { assertSafeOutboundUrl } from './ssrf'
import type { McpSnippetCandidate, ResolvedMcpSnippet } from './types'

/** Parse + resolve a pasted snippet into one result per detected server. */
export async function resolveMcpSnippet(snippet: string): Promise<ResolvedMcpSnippet[]> {
  const candidates = parseMcpSnippet(snippet)
  if (!candidates.length) return []
  const curated = await loadCuratedEndpoints()
  return Promise.all(candidates.map((c) => resolveCandidate(c, curated)))
}

async function resolveCandidate(
  candidate: McpSnippetCandidate,
  curated: { id: string; endpoint: string }[]
): Promise<ResolvedMcpSnippet> {
  if (candidate.url) return resolveRemote(candidate, candidate.url, curated)
  return resolveStdio(candidate, curated)
}

// ── Remote candidates ─────────────────────────────────────────────────────────

async function resolveRemote(
  candidate: McpSnippetCandidate,
  rawUrl: string,
  curated: { id: string; endpoint: string }[],
  registryHit?: RegistryRemoteHit
): Promise<ResolvedMcpSnippet> {
  let url = rawUrl
  try {
    await assertSafeOutboundUrl(url)
  } catch (error) {
    return { kind: 'unresolved', name: candidate.name, reason: errMsg(error) }
  }

  // Probe with literal (placeholder-free) headers only.
  const literalHeaders = stripPlaceholderHeaders(candidate.headers)
  const attempted = [url]
  let probe = await discoverMcpAuth(url, { headers: literalHeaders })

  // Sibling-path fallback: a non-401 hard fail → retry the `/mcp ↔ /sse` sibling. Vendors that
  // serve MCP at one path usually 404 the other with an HTML page (Linear, Notion, and friends).
  if (probe.isErr() && probe.error.code === 'PROBE_FAILED') {
    const sibling = siblingEndpoint(url)
    if (sibling) {
      attempted.push(sibling)
      const retry = await discoverMcpAuth(sibling, { headers: literalHeaders })
      if (retry.isOk()) {
        url = sibling
        probe = retry
      }
    }
  }

  const hasAuthHeaders = !!candidate.headers && Object.keys(candidate.headers).length > 0
  let auth: 'none' | 'oauth'
  if (probe.isOk()) {
    auth = probe.value.kind === 'oauth' ? 'oauth' : 'none'
  } else if (hasAuthHeaders) {
    // Token-gated server we can't probe without the secret — trust the pasted header.
    auth = 'none'
  } else {
    return {
      kind: 'unresolved',
      name: candidate.name,
      reason: cleanProbeError(probe.error.message, attempted),
    }
  }

  const endpoint = url
  const curatedMatch = curated.find((c) => sameEndpoint(c.endpoint, endpoint))

  const name =
    (candidate.name && prettifyName(candidate.name)) ||
    registryHit?.name ||
    hostName(endpoint) ||
    'MCP server'

  const placeholders = mergePlaceholders(candidate.placeholders, registryHit?.requiredHeaders)
  const iconUrl =
    validateIconUrl(registryHit?.iconUrl) ?? (await resolveFavicon(endpoint).catch(() => undefined))

  return {
    kind: 'remote',
    name,
    endpoint,
    auth,
    headers: candidate.headers,
    authHeaderName: detectAuthHeaderName(candidate.headers),
    placeholders: placeholders.length ? placeholders : undefined,
    description: registryHit?.description,
    iconUrl,
    curatedServerId: curatedMatch?.id,
  }
}

// ── Stdio candidates ──────────────────────────────────────────────────────────

async function resolveStdio(
  candidate: McpSnippetCandidate,
  curated: { id: string; endpoint: string }[]
): Promise<ResolvedMcpSnippet> {
  const packageId = extractPackageId(candidate.command, candidate.args)
  if (!packageId) {
    return {
      kind: 'unresolved',
      name: candidate.name,
      reason: 'Could not identify the package to run.',
    }
  }
  const slug = stripPackageAffixes(packageId)

  const localReason = localOnlyReason(slug)
  if (localReason) {
    return {
      kind: 'local-only',
      name: candidate.name ? prettifyName(candidate.name) : prettifyName(packageId),
      packageId,
      reason: `This server ${localReason} — it can't run in the cloud.`,
    }
  }

  const known = knownRemote(slug)
  if (known) {
    return resolveRemote(
      { ...candidate, url: known.url, command: undefined, args: undefined },
      known.url,
      curated
    )
  }

  const registry = await lookupRegistryRemote(packageId)
  if (registry) {
    return resolveRemote(
      {
        name: candidate.name ?? registry.name,
        url: registry.url,
        transportHint: registry.transport,
      },
      registry.url,
      curated,
      registry
    )
  }

  return {
    kind: 'unresolved',
    name: candidate.name ? prettifyName(candidate.name) : prettifyName(packageId),
    packageId,
    reason: 'This is a stdio-only server and no hosted remote was found.',
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadCuratedEndpoints(): Promise<{ id: string; endpoint: string }[]> {
  const rows = await db.query.McpServer.findMany({
    where: isNull(schema.McpServer.organizationId),
    columns: { id: true, endpoint: true },
  })
  return rows.map((r) => ({ id: r.id, endpoint: r.endpoint }))
}

/** Compare endpoints by origin + path (ignore query/trailing slash). */
function sameEndpoint(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    const norm = (u: URL) => `${u.origin}${u.pathname.replace(/\/$/, '')}`
    return norm(ua) === norm(ub)
  } catch {
    return false
  }
}

/** Drop headers whose value still contains a `${…}` placeholder (we don't have the secret yet). */
function stripPlaceholderHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!/\$\{.+\}/.test(v)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Single non-`Authorization` header → its name (the dialog sets `authHeaderName` from this). */
function detectAuthHeaderName(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined
  const keys = Object.keys(headers)
  if (keys.length !== 1) return undefined
  const [key] = keys
  return key && key.toLowerCase() !== 'authorization' ? key : undefined
}

function mergePlaceholders(a?: string[], b?: string[]): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])]
}

function hostName(url: string): string | undefined {
  try {
    return prettifyName(apexDomain(new URL(url).hostname))
  } catch {
    return undefined
  }
}

/** Validate a registry/serverInfo icon URL before we'd store + render it. */
function validateIconUrl(src?: string): string | undefined {
  if (!src) return undefined
  if (src.startsWith('data:image/')) return src
  try {
    const u = new URL(src)
    return u.protocol === 'https:' ? src : undefined
  } catch {
    return undefined
  }
}

/** Best-effort favicon: walk subdomains toward the apex, return the first that serves an image. */
async function resolveFavicon(endpoint: string): Promise<string | undefined> {
  let host: string
  try {
    host = new URL(endpoint).hostname
  } catch {
    return undefined
  }
  for (const candidate of subdomainChain(host)) {
    const faviconUrl = `https://${candidate}/favicon.ico`
    try {
      await assertSafeOutboundUrl(faviconUrl)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3_000)
      try {
        const res = await fetch(faviconUrl, { signal: controller.signal })
        if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/'))
          return faviconUrl
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // try the next host up the chain
    }
  }
  return undefined
}

/** `mcp.linear.app` → ['mcp.linear.app', 'linear.app'] (stop at the registrable apex, best-effort). */
function subdomainChain(host: string): string[] {
  const labels = host.split('.')
  const chain: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) {
    chain.push(labels.slice(i).join('.'))
    if (labels.length - i <= 2) break
  }
  return chain
}

function apexDomain(host: string): string {
  const labels = host.split('.')
  return labels.length <= 2 ? host : labels.slice(-2).join('.')
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The `/mcp ↔ /sse` sibling of an endpoint path, or null when it ends in neither. */
function siblingEndpoint(url: string): string | null {
  if (/\/sse\/?$/.test(url)) return url.replace(/\/sse(\/?)$/, '/mcp$1')
  if (/\/mcp\/?$/.test(url)) return url.replace(/\/mcp(\/?)$/, '/sse$1')
  return null
}

/**
 * Turn a raw transport/probe error into a short, honest one — never dump an HTML error page —
 * and append the endpoint path(s) we tried so the user can see what was probed.
 */
function cleanProbeError(raw: string, attempted: string[]): string {
  const tried = attemptedPaths(attempted)
  const msg = raw.replace(/\s+/g, ' ').trim()
  if (/<!doctype|<html|cannot (post|get)|cloudflare/i.test(msg)) {
    return `This URL didn't respond as a Streamable HTTP MCP server${tried} — double-check the endpoint path.`
  }
  const base = msg.length > 160 ? `${msg.slice(0, 160)}…` : msg
  return tried ? `${base}${tried}.` : base
}

/** `" (tried /mcp and /sse)"` from the probed URLs, or `''` when there's nothing useful to add. */
function attemptedPaths(attempted: string[]): string {
  const paths = [...new Set(attempted.map((u) => safePath(u)).filter(Boolean))]
  return paths.length ? ` (tried ${paths.join(' and ')})` : ''
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}
