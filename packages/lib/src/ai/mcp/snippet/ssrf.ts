// packages/lib/src/ai/mcp/snippet/ssrf.ts

const LOCALHOST = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Parses a pasted URL, requiring https (http only for localhost outside production); throws otherwise. */
export function assertHttpsUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol === 'https:') return url
  const isDev = process.env.NODE_ENV !== 'production'
  if (url.protocol === 'http:' && isDev && LOCALHOST.has(url.hostname)) return url
  throw new Error('Only https:// URLs are allowed')
}
