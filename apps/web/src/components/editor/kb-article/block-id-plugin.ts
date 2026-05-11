// apps/web/src/components/editor/kb-article/block-id-plugin.ts

import { generateId } from '@auxx/utils'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const STAMPED_NODES: ReadonlySet<string> = new Set(['block', 'panel'])

/**
 * Auto-stamp every `block` and `panel` node with a stable id on doc init
 * and on any transaction that introduces a node without one. Ids are the
 * stable handle Kopilot tools use to address blocks; we want the
 * invariant "every persisted block has an id" to hold without callers
 * having to remember.
 */
export const blockIdPlugin = (): Plugin => {
  const pluginKey = new PluginKey('blockId')

  return new Plugin({
    key: pluginKey,
    appendTransaction: (_transactions, _oldState, newState) => {
      const seen = new Set<string>()
      const patches: Array<{ pos: number; id: string }> = []

      newState.doc.descendants((node, pos) => {
        if (!STAMPED_NODES.has(node.type.name)) return true
        const id = node.attrs.id as string | null | undefined
        if (!id || seen.has(id)) {
          patches.push({ pos, id: generateId() })
        } else {
          seen.add(id)
        }
        return true
      })

      if (patches.length === 0) return null

      const tr = newState.tr
      for (const patch of patches) {
        const node = tr.doc.nodeAt(patch.pos)
        if (!node) continue
        tr.setNodeAttribute(patch.pos, 'id', patch.id)
      }
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}
