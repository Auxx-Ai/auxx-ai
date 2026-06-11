// packages/lib/src/ai/mcp/snippet/mcp-registry-client.ts
//
// Thin client for the official MCP registry (registry.modelcontextprotocol.io). Search matches
// the server NAME only, not `packages[].identifier`, so we strip the npm scope + mcp affixes,
// search that, then exact-match the pasted identifier against each candidate's packages. Returns
// the best hosted remote (streamable-http preferred, sse + sibling swap as fallback) plus name/
// description/icon enrichment lifted from the matched server.json.

import { createScopedLogger } from '@auxx/logger'
import { stripPackageAffixes } from './naming'
import { assertSafeOutboundUrl } from './ssrf'

const logger = createScopedLogger('mcp-registry')
const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io'
const TIMEOUT_MS = 5_000

export interface RegistryRemoteHit {
  url: string
  transport: 'http' | 'sse'
  /** Required, non-secret header names → become placeholders the user must fill. */
  requiredHeaders: string[]
  name?: string
  description?: string
  iconUrl?: string
  websiteUrl?: string
}

type RegistryServer = {
  name?: string
  title?: string
  description?: string
  websiteUrl?: string
  icons?: { src?: string }[]
  packages?: { identifier?: string }[]
  remotes?: {
    type?: string
    url?: string
    headers?: { name?: string; isSecret?: boolean; isRequired?: boolean }[]
  }[]
  _meta?: Record<string, { status?: string; isLatest?: boolean }>
}

/** Look up a hosted remote for a pasted stdio package id. Returns null on no match / registry down. */
export async function lookupRegistryRemote(packageId: string): Promise<RegistryRemoteHit | null> {
  const slug = stripPackageAffixes(packageId)
  const servers = await searchRegistry(slug)
  if (!servers) return null

  // Exact-match the pasted identifier against each active+latest candidate's packages.
  for (const server of servers) {
    const meta = server._meta?.['io.modelcontextprotocol.registry/official']
    if (meta && (meta.status !== 'active' || meta.isLatest === false)) continue
    const matches = server.packages?.some((p) => p.identifier === packageId)
    if (!matches) continue

    const remote = pickRemote(server.remotes)
    if (!remote) continue
    return {
      ...remote,
      name: server.title ?? server.name,
      description: server.description,
      iconUrl: server.icons?.find((i) => i.src)?.src,
      websiteUrl: server.websiteUrl,
    }
  }
  return null
}

/** Prefer a streamable-http remote; fall back to sse with the `/sse → /mcp` sibling swap. */
function pickRemote(
  remotes: RegistryServer['remotes']
): Pick<RegistryRemoteHit, 'url' | 'transport' | 'requiredHeaders'> | null {
  if (!remotes?.length) return null
  const requiredHeaders = (r: RegistryServer['remotes'][number]) =>
    (r.headers ?? []).filter((h) => h.isRequired && !h.isSecret && h.name).map((h) => h.name!)

  const http = remotes.find((r) => r.type === 'streamable-http' && r.url)
  if (http?.url) return { url: http.url, transport: 'http', requiredHeaders: requiredHeaders(http) }

  const sse = remotes.find((r) => r.type === 'sse' && r.url)
  if (sse?.url) {
    const swapped = sse.url.replace(/\/sse(\/?)$/, '/mcp$1')
    return {
      url: swapped !== sse.url ? swapped : sse.url,
      transport: 'http',
      requiredHeaders: requiredHeaders(sse),
    }
  }
  return null
}

async function searchRegistry(search: string): Promise<RegistryServer[] | null> {
  const url = `${REGISTRY_BASE}/v0.1/servers?search=${encodeURIComponent(search)}&version=latest`
  try {
    await assertSafeOutboundUrl(url)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!res.ok) return null
      const body = (await res.json()) as { servers?: RegistryServer[] }
      return body.servers ?? []
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    logger.warn('Registry search failed', {
      search,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
