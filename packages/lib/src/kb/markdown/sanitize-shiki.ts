// packages/lib/src/kb/markdown/sanitize-shiki.ts
//
// Tiny allowlist sanitizer for the pre-rendered HTML that shiki produces
// during publish (stored on `BlockAttrs.codeHighlightedHtml`). The input is
// trusted because we generated it, but we still strip it down to a known set
// of tags so any future bug in the highlighter pipeline can't smuggle markup
// into the widget. If anything outside the allowlist appears, return null and
// let the renderer fall back to escape-only output.

const ALLOWED_TAGS = new Set(['pre', 'code', 'span'])

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
  pre: new Set(['class', 'style']),
  code: new Set(['class', 'style']),
  span: new Set(['class', 'style']),
}

// Style values are restricted to color tokens; anything with parens (url(...))
// or semicolons used for multiple declarations is acceptable as long as it
// only contains color/background-color values.
const SAFE_STYLE = /^(?:(?:color|background-color)\s*:\s*[#\w\s(),.%-]+;?\s*)+$/i
const SAFE_CLASS = /^[\w\s-]+$/

/**
 * Walk the input and emit only tags + attrs that pass the allowlist.
 * Returns `null` if anything disqualifying is found so callers can choose to
 * fall back to the unhighlighted code path.
 */
export function sanitizeShikiHtml(input: string): string | null {
  if (!input) return null
  // Reject the obvious script-y bits up front so a misconfigured highlighter
  // can't pass garbage through.
  if (/<\s*(script|iframe|object|embed|link|meta|style)\b/i.test(input)) return null
  if (/\son[a-z]+\s*=/i.test(input)) return null
  if (/javascript:/i.test(input)) return null

  let out = ''
  let i = 0
  while (i < input.length) {
    const lt = input.indexOf('<', i)
    if (lt === -1) {
      out += input.slice(i)
      break
    }
    out += input.slice(i, lt)
    const gt = input.indexOf('>', lt)
    if (gt === -1) return null
    const raw = input.slice(lt + 1, gt)
    const isClose = raw.startsWith('/')
    const body = isClose ? raw.slice(1).trim() : raw.trim()
    const spaceAt = body.search(/\s/)
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return null
    if (isClose) {
      out += `</${tag}>`
    } else {
      const attrsStr = spaceAt === -1 ? '' : body.slice(spaceAt + 1).trim()
      const attrs = attrsStr ? parseAttrs(attrsStr, tag) : ''
      if (attrs === null) return null
      out += `<${tag}${attrs}>`
    }
    i = gt + 1
  }
  return out
}

function parseAttrs(input: string, tag: string): string | null {
  const allowed = ALLOWED_ATTRS_BY_TAG[tag]
  if (!allowed) return null
  let result = ''
  const re = /([a-z-]+)\s*=\s*"([^"]*)"/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  re.lastIndex = 0
  while ((match = re.exec(input)) !== null) {
    if (input.slice(lastIndex, match.index).trim() !== '') return null
    lastIndex = re.lastIndex
    const name = (match[1] ?? '').toLowerCase()
    const value = match[2] ?? ''
    if (!allowed.has(name)) return null
    if (name === 'class' && !SAFE_CLASS.test(value)) return null
    if (name === 'style' && !SAFE_STYLE.test(value)) return null
    result += ` ${name}="${escapeAttr(value)}"`
  }
  if (input.slice(lastIndex).trim() !== '') return null
  return result
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
