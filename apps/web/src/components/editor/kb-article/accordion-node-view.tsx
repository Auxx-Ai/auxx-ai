// apps/web/src/components/editor/kb-article/accordion-node-view.tsx
'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import blockStyles from './block-node-view.module.css'
import { addPanel, collectPanels } from './container-helpers'
import styles from './container-node-view.module.css'

/**
 * Per-item drag-reorder is handled inside `panel-node-view.tsx` using
 * native HTML5 drag (see `panel-drag-state.ts`). dnd-kit can't bridge
 * across Tiptap's per-node-view React roots, so this parent view holds
 * no SortableContext.
 */
export function AccordionNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const panels = useMemo(() => collectPanels(node), [node])
  const allowMultiple = (node.attrs as { allowMultiple?: boolean }).allowMultiple !== false

  // Resolve `getPos()` lazily inside handlers — capturing it at render
  // time goes stale because Tiptap doesn't re-render this NodeView when
  // doc edits happen elsewhere (e.g. typing in another accordion shifts
  // this one's position but doesn't trigger a re-render here).
  const resolveContainerPos = useCallback((): number | null => {
    if (typeof getPos !== 'function') return null
    const p = getPos()
    return typeof p === 'number' ? p : null
  }, [getPos])

  const containerPosForRender = typeof getPos === 'function' ? getPos() : null
  const lineNumber =
    typeof containerPosForRender === 'number'
      ? editor.state.doc.resolve(containerPosForRender).index(0) + 1
      : null

  const selectThisContainer = (event: React.MouseEvent) => {
    const cp = resolveContainerPos()
    if (cp == null) return
    event.preventDefault()
    event.stopPropagation()
    editor.commands.setNodeSelection(cp)
  }

  const handleAdd = useCallback(() => {
    const cp = resolveContainerPos()
    if (cp == null) return
    const nextNumber = panels.length + 1
    addPanel(editor, cp, `Question ${nextNumber}`)
  }, [editor, resolveContainerPos, panels.length])

  return (
    <NodeViewWrapper as='div' className={blockStyles.blockWrapper} data-accordion=''>
      <div className={blockStyles.blockContainer}>
        <div
          className={blockStyles.lineGutter}
          contentEditable={false}
          draggable={true}
          data-block-drag-handle='true'
          onClick={selectThisContainer}>
          <div className={`${blockStyles.lineNumber} text-xs tabular-nums`}>{lineNumber ?? ''}</div>
        </div>

        <div
          className={`${blockStyles.blockContentWrapper} ${styles.containerContent} ${styles.accordionContainerContent}`}>
          <div className={styles.accordionToolbar} contentEditable={false}>
            <button
              type='button'
              className={styles.accordionToolbarToggle}
              aria-pressed={allowMultiple}
              onClick={() => updateAttributes({ allowMultiple: !allowMultiple })}>
              {allowMultiple ? 'Multiple open' : 'One open'}
            </button>
          </div>

          <div className={styles.accordionBodyCard}>
            <div className={styles.accordionContainer}>
              <NodeViewContent />
            </div>
          </div>

          <div className={styles.accordionFooter} contentEditable={false}>
            <button type='button' className={styles.addAccordionItemButton} onClick={handleAdd}>
              <Plus size={14} />
              <span>Add item</span>
            </button>
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  )
}
