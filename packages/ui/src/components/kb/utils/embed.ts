// packages/ui/src/components/kb/utils/embed.ts

export type EmbedProvider = 'youtube' | 'loom' | 'vimeo'

export interface ParsedEmbed {
  provider: EmbedProvider
  embedSrc: string
}

/**
 * Map a user-pasted URL to a sandboxed iframe `src` for one of the
 * supported providers. Returns `null` for anything else — no raw user
 * iframes are accepted.
 */
export function parseEmbedUrl(url: string): ParsedEmbed | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.searchParams.get('v')
    if (id && /^[\w-]{6,}$/.test(id)) {
      return { provider: 'youtube', embedSrc: `https://www.youtube.com/embed/${id}` }
    }
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([\w-]{6,})/)
    if (shortsMatch?.[1]) {
      return { provider: 'youtube', embedSrc: `https://www.youtube.com/embed/${shortsMatch[1]}` }
    }
    return null
  }

  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '')
    if (id && /^[\w-]{6,}$/.test(id)) {
      return { provider: 'youtube', embedSrc: `https://www.youtube.com/embed/${id}` }
    }
    return null
  }

  if (host === 'loom.com') {
    const match = parsed.pathname.match(/^\/(share|embed)\/([\w-]{8,})/)
    if (match?.[2]) {
      return { provider: 'loom', embedSrc: `https://www.loom.com/embed/${match[2]}` }
    }
    return null
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = parsed.pathname.match(/(\d{6,})/)
    if (match?.[1]) {
      return { provider: 'vimeo', embedSrc: `https://player.vimeo.com/video/${match[1]}` }
    }
    return null
  }

  return null
}
