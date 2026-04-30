// apps/web/src/components/editor/kb-article/markdown-paste.ts

import { type Editor, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

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
]

function looksLikeMarkdown(text: string): boolean {
  if (!text) return false
  if (text.length < 3) return false
  return MARKDOWN_HEURISTIC.some((re) => re.test(text))
}

/**
 * Intercepts plain-text clipboard payloads that look like markdown and
 * replaces them with parsed BlockJSON. The converter is loaded via
 * dynamic import on first use so it stays out of the cold editor bundle.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdown-paste',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdown-paste'),
        props: {
          handlePaste: (view, event) => {
            const cd = event.clipboardData
            if (!cd) return false

            const text = cd.getData('text/plain')
            if (!text || !looksLikeMarkdown(text)) return false

            // Don't transform when pasting into a code block — code paste
            // should stay verbatim.
            const $from = view.state.selection.$from
            for (let depth = $from.depth; depth >= 0; depth--) {
              const node = $from.node(depth)
              if (node.type.name === 'block' && node.attrs.blockType === 'codeBlock') {
                return false
              }
            }

            event.preventDefault()
            void importAndInsert(editor, text)
            return true
          },
        },
      }),
    ]
  },
})

async function importAndInsert(editor: Editor, text: string): Promise<void> {
  let parsed: { content: unknown[] } | null = null
  try {
    const { mdToBlocks } = await import('@auxx/lib/kb/markdown')
    parsed = mdToBlocks(text)
  } catch (error) {
    console.error('Markdown parse failed; falling back to plain text paste', error)
    insertPlainText(editor, text)
    return
  }

  if (!parsed || !parsed.content?.length) {
    insertPlainText(editor, text)
    return
  }

  try {
    editor
      .chain()
      .focus()
      .insertContent(parsed.content as never[])
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
