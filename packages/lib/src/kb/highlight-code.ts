// @auxx/lib/kb/highlight-code.ts
import { createHighlighter, type Highlighter } from 'shiki'
import type { ArticleNodeJSON, BlockJSON, InlineJSON } from './markdown/types'

export const SHIKI_LANGUAGES = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'bash',
  'sh',
  'html',
  'css',
  'py',
  'go',
  'sql',
] as const

export type ShikiLanguage = (typeof SHIKI_LANGUAGES)[number]

const LANGUAGE_SET = new Set<string>(SHIKI_LANGUAGES)

const SHIKI_THEME = 'github-light'

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighterCached(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEME],
      langs: [...SHIKI_LANGUAGES],
    })
  }
  return highlighterPromise
}

/** A top-level `codeBlock` block. Code nested inside tabs/accordions/tables is
 * not walked — those containers hold their own block lists. */
function isCodeBlock(node: ArticleNodeJSON): node is BlockJSON {
  return node?.type === 'block' && node.attrs?.blockType === 'codeBlock'
}

function nodeText(content: InlineJSON[] | undefined): string {
  if (!content) return ''
  return content.map((n) => (typeof n.text === 'string' ? n.text : '')).join('')
}

function pickLanguage(raw: unknown): ShikiLanguage | 'plaintext' {
  if (typeof raw !== 'string') return 'plaintext'
  return LANGUAGE_SET.has(raw) ? (raw as ShikiLanguage) : 'plaintext'
}

/**
 * Walk a KB article body, rebuild every codeBlock's `codeHighlightedHtml`
 * with Shiki output. Returns a new array — non-code blocks are passed
 * through unchanged.
 *
 * Returns the input untouched if the body has no codeBlock children —
 * avoids loading the highlighter for articles that don't need it.
 */
export async function enrichDocWithHighlighting(
  blocks: ArticleNodeJSON[]
): Promise<ArticleNodeJSON[]> {
  if (!Array.isArray(blocks)) return blocks

  const codeIndices: number[] = []
  blocks.forEach((node, idx) => {
    if (isCodeBlock(node)) codeIndices.push(idx)
  })
  if (codeIndices.length === 0) return blocks

  const highlighter = await getHighlighterCached()
  const nextBlocks = blocks.slice()

  for (const idx of codeIndices) {
    const block = nextBlocks[idx]
    if (!block || !isCodeBlock(block)) continue
    const code = nodeText(block.content)
    const language = pickLanguage(block.attrs.codeLanguage)
    let html: string
    try {
      html = highlighter.codeToHtml(code, { lang: language, theme: SHIKI_THEME })
    } catch {
      html = highlighter.codeToHtml(code, { lang: 'plaintext', theme: SHIKI_THEME })
    }
    nextBlocks[idx] = {
      ...block,
      attrs: {
        ...block.attrs,
        codeLanguage: language,
        codeHighlightedHtml: html,
      },
    }
  }

  return nextBlocks
}
