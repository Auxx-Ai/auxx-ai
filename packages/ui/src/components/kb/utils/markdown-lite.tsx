// packages/ui/src/components/kb/utils/markdown-lite.tsx
//
// Tiny dependency-free renderer for the inline markdown subset used inside
// `cards` block descriptions: `*bold*`, `_italic_`, `` `code` ``, and
// `[label](url)`. Anything that doesn't tokenize falls through as plain text.

import type { ReactNode } from 'react'

interface RenderOpts {
  /** Map an `auxx://kb/article/{id}` URL inside the description to the href
   * the renderer should emit. Defaults to `/r/{id}`. */
  resolveAuxxHref?: (articleId: string) => string
}

const AUXX_KB_PREFIX = 'auxx://kb/article/'

const defaultResolveAuxxHref = (id: string) => `/r/${id}`

export function renderMarkdownLite(source: string | undefined, opts: RenderOpts = {}): ReactNode {
  if (!source) return null
  const resolver = opts.resolveAuxxHref ?? defaultResolveAuxxHref
  const tokens = tokenize(source)
  return tokens.map((tok, i) => {
    switch (tok.kind) {
      case 'text':
        // biome-ignore lint/suspicious/noArrayIndexKey: token order is stable per render
        return <span key={i}>{tok.value}</span>
      case 'bold':
        // biome-ignore lint/suspicious/noArrayIndexKey: token order is stable per render
        return <strong key={i}>{tok.value}</strong>
      case 'italic':
        // biome-ignore lint/suspicious/noArrayIndexKey: token order is stable per render
        return <em key={i}>{tok.value}</em>
      case 'code':
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: token order is stable per render
          <code key={i} className='kb-inline-code'>
            {tok.value}
          </code>
        )
      case 'link': {
        const href = tok.url.startsWith(AUXX_KB_PREFIX)
          ? resolver(tok.url.slice(AUXX_KB_PREFIX.length))
          : tok.url
        const isExternal = !href.startsWith('/')
        return (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: token order is stable per render
            key={i}
            href={href}
            className='kb-link'
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}>
            {tok.label}
          </a>
        )
      }
    }
  })
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'link'; label: string; url: string }

const RE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*]+\*)|(_[^_]+_)/g

function tokenize(input: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of input.matchAll(RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ kind: 'text', value: input.slice(last, idx) })
    const raw = m[0]
    if (raw.startsWith('`')) {
      out.push({ kind: 'code', value: raw.slice(1, -1) })
    } else if (raw.startsWith('[')) {
      const close = raw.indexOf('](')
      const label = raw.slice(1, close)
      const url = raw.slice(close + 2, -1)
      out.push({ kind: 'link', label, url })
    } else if (raw.startsWith('*')) {
      out.push({ kind: 'bold', value: raw.slice(1, -1) })
    } else {
      out.push({ kind: 'italic', value: raw.slice(1, -1) })
    }
    last = idx + raw.length
  }
  if (last < input.length) out.push({ kind: 'text', value: input.slice(last) })
  return out
}
