// apps/web/src/components/editor/kb-article/markdown-paste.ts

import { type Editor, Extension, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { coerceBlocks, DEFAULT_BLOCKS, type EditorBlock } from '../blocks/allowed-blocks'

// Blocks whose shape forbids "lift out and insert N new blocks" semantics.
// Pasting markdown inside one of these falls through to PM's plain-text
// paste so the caret stays inside the existing block. `text` (the default
// flowing paragraph) is intentionally absent — that's the one place full
// markdown auto-format makes sense.
const PLAINTEXT_BLOCK_TYPES = new Set([
  'codeBlock',
  'heading',
  'callout',
  'quote',
  'bulletListItem',
  'orderedListItem',
  'todoListItem',
])

const MARKDOWN_HEURISTIC = [
  /^#{1,6}\s/m,
  /^\s*[-*]\s/m,
  /^\s*\d+\.\s/m,
  /^>\s/m,
  /^---\s*$/m,
  /^```/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^\]\n]+\]\([^\s)]+\)/,
  /^:::\w+/m,
  // GFM pipe table — strict separator row (`|---|---|`, `|:--|--:|`, …).
  // High-confidence signal that a real table was pasted.
  /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/m,
  // Loose fallback: any line that opens and closes with `|`. Catches
  // tables that paste without trailing pipes, single-row matrices, etc.
  /^\|.*\|\s*$/m,
]

function looksLikeMarkdown(text: string): boolean {
  if (!text) return false
  if (text.length < 3) return false
  return MARKDOWN_HEURISTIC.some((re) => re.test(text))
}

export interface MarkdownPasteOptions {
  /**
   * Block kinds this editor allows. Parsed markdown is run through
   * `coerceBlocks` against this set, so a disallowed heading/list collapses to
   * `text` and a disallowed table/container is dropped — paste follows the
   * same allowlist as every other entry point.
   */
  allowed: EditorBlock[]
}

/**
 * Intercepts plain-text clipboard payloads that look like markdown and
 * replaces them with parsed BlockJSON. The converter is loaded via
 * dynamic import on first use so it stays out of the cold editor bundle.
 */
export const MarkdownPaste = Extension.create<MarkdownPasteOptions>({
  name: 'markdown-paste',

  addOptions() {
    return { allowed: DEFAULT_BLOCKS }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const allowed = this.options.allowed
    return [
      new Plugin({
        key: new PluginKey('markdown-paste'),
        props: {
          handlePaste: (view, event) => {
            const cd = event.clipboardData
            if (!cd) return false

            const text = cd.getData('text/plain')
            if (!text) return false

            // Find the closest enclosing `block` ancestor so we can route on
            // its `blockType` (codeBlock vs heading vs callout vs other).
            const $from = view.state.selection.$from
            let blockType: string | null = null
            for (let depth = $from.depth; depth >= 0; depth--) {
              const node = $from.node(depth)
              if (node.type.name === 'block') {
                blockType = (node.attrs.blockType as string | undefined) ?? null
                break
              }
            }

            // Plaintext-only blocks (codeBlock, heading, callout, list item,
            // quote): force-insert text/plain verbatim. PM's default paste
            // reads text/html (e.g. `<pre><code>…</code></pre>` from an IDE,
            // or `<p>…</p>` from a webpage), parses it via the schema, and
            // lifts out of the wrapping block when the resulting slice
            // doesn't fit `inline*` — which deletes the block and leaves
            // plain text behind. Force-plaintext keeps the caret inside.
            if (blockType && PLAINTEXT_BLOCK_TYPES.has(blockType)) {
              event.preventDefault()
              view.dispatch(view.state.tr.insertText(text))
              return true
            }

            if (!looksLikeMarkdown(text)) return false

            event.preventDefault()
            void importAndInsert(editor, text, allowed)
            return true
          },
        },
      }),
    ]
  },
})

async function importAndInsert(
  editor: Editor,
  text: string,
  allowed: EditorBlock[]
): Promise<void> {
  let parsed: JSONContent[] | null = null
  try {
    const { mdToBlocks } = await import('@auxx/lib/kb/markdown')
    parsed = mdToBlocks(text) as JSONContent[]
  } catch (error) {
    console.error('Markdown parse failed; falling back to plain text paste', error)
    insertPlainText(editor, text)
    return
  }

  // Coerce the parsed blocks to fit the surface's allowed set — disallowed
  // headings/lists collapse to text, disallowed tables/containers drop out.
  const blocks = coerceBlocks(parsed, allowed)

  if (blocks.length === 0) {
    insertPlainText(editor, text)
    return
  }

  try {
    editor
      .chain()
      .focus()
      .insertContent(blocks as never[])
      .run()
  } catch (error) {
    console.error('Markdown insert failed; falling back to plain text paste', error)
    insertPlainText(editor, text)
  }
}

function insertPlainText(editor: Editor, text: string): void {
  try {
    editor.chain().focus().insertContent(text).run()
  } catch (error) {
    console.error('Plain text fallback paste failed', error)
  }
}
