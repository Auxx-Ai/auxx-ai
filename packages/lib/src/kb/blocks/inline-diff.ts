// packages/lib/src/kb/blocks/inline-diff.ts
//
// Pure word-level inline diff for a block's visible text. Built on `fast-diff`
// (char-level Myers) but run over a token-encoded representation so the output
// lands on word boundaries instead of mid-word character runs.
//
// Must stay pure (types + `fast-diff` only) so client code in `apps/web` can
// import it without pulling server-only deps.

import fastDiff from 'fast-diff'
import type { BlockJSON } from '../markdown/types'

export interface InlineDiffSpan {
  type: 'eq' | 'ins' | 'del'
  text: string
}

/**
 * Flatten a block's inline content to its visible text. Marks and links are
 * not represented — v1 diffs visible text only. `hardBreak` becomes a newline
 * so line additions/removals are visible.
 */
export function inlineToText(content: BlockJSON['content']): string {
  if (!content) return ''
  let out = ''
  for (const node of content) {
    if (node.type === 'hardBreak') out += '\n'
    else if (typeof node.text === 'string') out += node.text
  }
  return out
}

/**
 * Word-level inline diff. Returns ordered `eq`/`ins`/`del` spans whose `text`
 * fields concatenate (per side) back to the originals.
 *
 * Returns `[]` when the visible text is identical — a marks-only change still
 * makes the block `modified` upstream, but produces no inline spans.
 */
export function diffInline(
  prev: BlockJSON['content'],
  next: BlockJSON['content']
): InlineDiffSpan[] {
  const a = inlineToText(prev)
  const b = inlineToText(next)
  if (a === b) return []

  // Token-encode each side so fast-diff's char algorithm operates on whole
  // tokens (words + whitespace runs), yielding word-level granularity.
  const tokens: string[] = []
  const codes = new Map<string, number>()
  const encode = (text: string): string => {
    let encoded = ''
    for (const token of tokenize(text)) {
      let code = codes.get(token)
      if (code === undefined) {
        code = tokens.length
        tokens.push(token)
        codes.set(token, code)
      }
      // +1 keeps us off the NUL code point.
      encoded += String.fromCharCode(code + 1)
    }
    return encoded
  }

  const raw = fastDiff(encode(a), encode(b))
  const spans: InlineDiffSpan[] = []
  for (const [op, chunk] of raw) {
    let text = ''
    for (const ch of chunk) text += tokens[ch.charCodeAt(0) - 1]
    if (!text) continue
    const type: InlineDiffSpan['type'] =
      op === fastDiff.INSERT ? 'ins' : op === fastDiff.DELETE ? 'del' : 'eq'
    const last = spans[spans.length - 1]
    if (last && last.type === type) last.text += text
    else spans.push({ type, text })
  }
  return spans
}

/** Split into word and whitespace tokens; concatenation reconstructs the input. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0)
}
