// apps/web/src/components/editor/kb-article/container-helpers.ts
//
// PM transaction helpers for `tabs` / `accordion` containers.
// Reorder, add, and remove `panel` children of a container node.

import { generateId } from '@auxx/utils'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

export interface PanelLite {
  id: string
  label: string
  iconId?: string
}

export function collectPanels(container: PMNode): PanelLite[] {
  const out: PanelLite[] = []
  container.forEach((child) => {
    if (child.type.name !== 'panel') return
    const attrs = child.attrs as { id?: string; label?: string; iconId?: string }
    out.push({
      id: attrs.id ?? '',
      label: attrs.label ?? '',
      iconId: attrs.iconId,
    })
  })
  return out
}

function makeEmptyPanel(editor: Editor, label: string, id: string): PMNode {
  const panelType = editor.schema.nodes.panel
  const blockType = editor.schema.nodes.block
  if (!panelType || !blockType) {
    throw new Error('Editor schema is missing `panel` or `block` node types.')
  }
  const emptyBlock = blockType.create({ blockType: 'text' })
  return panelType.create({ id, label }, emptyBlock)
}

export function addPanel(editor: Editor, containerPos: number, label: string): string | null {
  const container = editor.state.doc.nodeAt(containerPos)
  if (!container) return null
  const id = generateId()
  const panel = makeEmptyPanel(editor, label, id)
  // Insert at the end of the container (just before its closing token).
  // No `scrollIntoView()` — that scrolls the doc to the new node, which
  // jumps the page when the accordion is far above the current viewport.
  const insertPos = containerPos + container.nodeSize - 1
  editor.view.dispatch(editor.state.tr.insert(insertPos, panel))
  return id
}

export function removePanel(editor: Editor, containerPos: number, panelId: string): void {
  const container = editor.state.doc.nodeAt(containerPos)
  if (!container) return
  // If this is the last panel, remove the whole container.
  if (container.childCount <= 1) {
    editor.view.dispatch(editor.state.tr.delete(containerPos, containerPos + container.nodeSize))
    return
  }
  const panel = findPanelByIdInContainer(container, panelId)
  if (!panel) return
  // Position of the panel inside the doc = containerPos + 1 (open token) + offset
  let offset = 1
  let found = false
  container.forEach((child) => {
    if (found) return
    if (child === panel.node) {
      found = true
      return
    }
    offset += child.nodeSize
  })
  if (!found) return
  const from = containerPos + offset
  editor.view.dispatch(editor.state.tr.delete(from, from + panel.node.nodeSize))
}

export function reorderPanels(
  editor: Editor,
  containerPos: number,
  fromIndex: number,
  toIndex: number
): void {
  if (fromIndex === toIndex) return
  const container = editor.state.doc.nodeAt(containerPos)
  if (!container) return

  const children: PMNode[] = []
  container.forEach((child) => children.push(child))
  if (fromIndex < 0 || fromIndex >= children.length) return
  if (toIndex < 0 || toIndex >= children.length) return

  const [moved] = children.splice(fromIndex, 1)
  children.splice(toIndex, 0, moved)

  // Rebuild the container with the same attrs and reordered children.
  const newContainer = container.type.create(container.attrs, children, container.marks)
  editor.view.dispatch(
    editor.state.tr.replaceWith(containerPos, containerPos + container.nodeSize, newContainer)
  )
}

export function setPanelAttr(
  editor: Editor,
  containerPos: number,
  panelId: string,
  attrPatch: Record<string, unknown>
): void {
  const container = editor.state.doc.nodeAt(containerPos)
  if (!container) return
  const panel = findPanelByIdInContainer(container, panelId)
  if (!panel) return
  // Resolve the panel's absolute position in the doc.
  let offset = 1
  let found = false
  container.forEach((child) => {
    if (found) return
    if (child === panel.node) {
      found = true
      return
    }
    offset += child.nodeSize
  })
  if (!found) return
  const panelPos = containerPos + offset
  const tr = editor.state.tr
  for (const [k, v] of Object.entries(attrPatch)) {
    tr.setNodeAttribute(panelPos, k, v)
  }
  editor.view.dispatch(tr)
}

interface FoundPanel {
  node: PMNode
  index: number
}

function findPanelByIdInContainer(container: PMNode, panelId: string): FoundPanel | null {
  let result: FoundPanel | null = null
  let index = 0
  container.forEach((child) => {
    if (result) {
      index++
      return
    }
    if (child.type.name === 'panel' && (child.attrs as { id?: string }).id === panelId) {
      result = { node: child, index }
    }
    index++
  })
  return result
}

export function getPanelIndex(editor: Editor, containerPos: number, panelId: string): number {
  const container = editor.state.doc.nodeAt(containerPos)
  if (!container) return -1
  let idx = -1
  let i = 0
  container.forEach((child) => {
    if (idx >= 0) return
    if (child.type.name === 'panel' && (child.attrs as { id?: string }).id === panelId) {
      idx = i
    }
    i++
  })
  return idx
}

export function focusFirstBlockInPanel(
  editor: Editor,
  containerPos: number,
  panelId: string
): void {
  const container = editor.state.doc.nodeAt(containerPos)
  if (!container) return
  const panel = findPanelByIdInContainer(container, panelId)
  if (!panel) return
  let offset = 1
  let found = false
  container.forEach((child) => {
    if (found) return
    if (child === panel.node) {
      found = true
      return
    }
    offset += child.nodeSize
  })
  if (!found) return
  // Position 1 inside the panel = inside its first block. Add 1 to enter the
  // panel, then 1 to enter the first block.
  const focusPos = containerPos + offset + 2
  try {
    editor.commands.focus(focusPos)
  } catch {
    /* no-op — best effort */
  }
}
