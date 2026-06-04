// apps/web/src/components/editor/kb-article/block-id-plugin.ts

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { createDocBlockIdAllocator } from './block-id'

const STAMPED_NODES: ReadonlySet<string> = new Set(['block', 'panel', 'tabs', 'accordion', 'table'])

/**
 * Auto-stamp every addressable node (`block`, `panel`, and the
 * top-level containers `tabs` / `accordion` / `table`) with a stable id
 * on doc init and on any transaction that introduces a node without
 * one. Ids are the stable handle Kopilot tools use to address blocks
 * and containers; we want the invariant "every persisted block or
 * container has an id" to hold without callers having to remember.
 *
 * New ids are short sequential `b<n>` values allocated above the doc's
 * current max — existing ids (including legacy random ones) are preserved,
 * never renumbered, so the version/turn diff stays stable.
 */
export const blockIdPlugin = (): Plugin => {
  const pluginKey = new PluginKey('blockId')

  return new Plugin({
    key: pluginKey,
    appendTransaction: (_transactions, _oldState, newState) => {
      const seen = new Set<string>()
      const positions: number[] = []

      newState.doc.descendants((node, pos) => {
        if (!STAMPED_NODES.has(node.type.name)) return true
        const id = node.attrs.id as string | null | undefined
        if (!id || seen.has(id)) {
          positions.push(pos)
        } else {
          seen.add(id)
        }
        return true
      })

      if (positions.length === 0) return null

      // Allocate sequential ids above the doc's current max so the new ones
      // can't collide with what we just preserved.
      const nextId = createDocBlockIdAllocator(newState.doc)
      const patches = positions.map((pos) => ({ pos, id: nextId() }))

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
