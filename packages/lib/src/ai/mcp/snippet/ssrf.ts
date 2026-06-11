// packages/lib/src/ai/mcp/snippet/ssrf.ts
//
// Outbound-URL guard for every fetch the resolver makes against user-controlled URLs (probe +
// registry): https only (http allowed for localhost in dev), and DNS-resolve the host to reject
// private/link-local/loopback ranges. Pasted snippets are untrusted input.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const isDev = process.env.NODE_ENV !== 'production'

/** Throws if `rawUrl` is unsafe to fetch server-side. Returns the parsed URL otherwise. */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:') {
    if (!(url.protocol === 'http:' && isDev && isLocalhost)) {
      throw new Error('Only https:// URLs are allowed')
    }
  }

  // Resolve the host (or use the literal IP) and reject private ranges. Allow localhost in dev only.
  const literal = isIP(url.hostname)
  const addresses = literal
    ? [{ address: url.hostname, family: literal }]
    : await lookup(url.hostname, { all: true }).catch(() => {
        throw new Error(`Could not resolve host: ${url.hostname}`)
      })

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      if (isDev && (address === '127.0.0.1' || address === '::1')) continue
      throw new Error(`Refusing to connect to a private address (${address})`)
    }
  }
  return url
}

/** True for loopback, private, link-local, and unique-local ranges (IPv4 + IPv6). */
function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  if (v === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fe80')) return true // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped?.[1]) return isPrivateAddress(mapped[1])
    return false
  }
  return false
}
