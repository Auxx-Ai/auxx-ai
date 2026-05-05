// apps/web/src/components/editor/kb-article/panel-node-view.tsx
'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { ChevronDown, GripVertical, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getPanelIndex, removePanel as removePanelOp, setPanelAttr } from './container-helpers'
import styles from './container-node-view.module.css'
import {
  endPanelDrag,
  getPanelDrag,
  getPanelDrop,
  startPanelDrag,
  subscribePanelDrag,
} from './panel-drag-state'

/**
 * Tiptap renders each child node-view in an independent React root, so
 * React Context from a parent NodeView (TabsNodeView / AccordionNodeView)
 * does NOT reach this component. We detect the parent's type by walking
 * the PM doc with `getPos()` instead.
 *
 * - inside `tabs`: just the body. The active tab is shown / others are
 *   hidden via TabsNodeView's display-toggle effect.
 * - inside `accordion`: a header row (drag handle, chevron, label, X) +
 *   collapsible body. Drag-reorder is coordinated by document-level
 *   listeners in `panel-drag-state.ts`; this view just starts the drag
 *   and renders the drop-edge indicator from subscribed state.
 */
export function PanelNodeView({ node, editor, getPos }: NodeViewProps) {
  const id = (node.attrs as { id?: string }).id ?? ''
  const label = (node.attrs as { label?: string }).label ?? ''

  const parentTypeName = useMemo(() => {
    if (typeof getPos !== 'function') return null
    try {
      const pos = getPos()
      if (typeof pos !== 'number') return null
      const $pos = editor.state.doc.resolve(pos)
      return $pos.parent.type.name
    } catch {
      return null
    }
  }, [editor, getPos, node])

  if (parentTypeName === 'accordion') {
    return <AccordionPanelView panelId={id} label={label} editor={editor} getPos={getPos} />
  }

  return (
    <NodeViewWrapper as='div' className={styles.panelBody} data-panel='' data-panel-id={id}>
      <NodeViewContent className={styles.panelContent} />
    </NodeViewWrapper>
  )
}

interface AccordionPanelViewProps {
  panelId: string
  label: string
  editor: NodeViewProps['editor']
  getPos: NodeViewProps['getPos']
}

function AccordionPanelView({ panelId, label, editor, getPos }: AccordionPanelViewProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [, forceTick] = useState(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)

  // Re-render this item when drag/drop state changes so the dropEdge
  // indicator + isSourceOfDrag opacity update in lockstep with the
  // module-level state.
  useEffect(() => subscribePanelDrag(() => forceTick((t) => t + 1)), [])

  const containerPos = useCallback((): number | null => {
    if (typeof getPos !== 'function') return null
    try {
      const pos = getPos()
      if (typeof pos !== 'number') return null
      const $pos = editor.state.doc.resolve(pos)
      return $pos.before($pos.depth)
    } catch {
      return null
    }
  }, [editor, getPos])

  const onRename = useCallback(
    (next: string) => {
      const cp = containerPos()
      if (cp == null) return
      setPanelAttr(editor, cp, panelId, { label: next })
    },
    [editor, panelId, containerPos]
  )

  const onDelete = useCallback(() => {
    const cp = containerPos()
    if (cp == null) return
    removePanelOp(editor, cp, panelId)
  }, [editor, panelId, containerPos])

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLSpanElement>) => {
      const cp = containerPos()
      if (cp == null) {
        console.log('[panel-drag] dragstart bailed: no containerPos', { panelId })
        return
      }
      const fromIndex = getPanelIndex(editor, cp, panelId)
      if (fromIndex < 0) {
        console.log('[panel-drag] dragstart bailed: no fromIndex', { panelId, cp })
        return
      }
      const accordionEl = wrapperRef.current?.closest<HTMLElement>('[data-accordion]')
      if (!accordionEl) {
        console.log('[panel-drag] dragstart bailed: no accordion ancestor', { panelId })
        return
      }
      console.log('[panel-drag] dragstart', { panelId, containerPos: cp, fromIndex })
      startPanelDrag({ panelId, containerPos: cp, fromIndex, editor, accordionEl })
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        // Firefox cancels drags with empty dataTransfer.
        e.dataTransfer.setData('text/plain', panelId)
        // Drag image: a clone of the header only (no body content), so
        // the preview is a tidy row regardless of how much content the
        // expanded item is rendering. Cloned offscreen and removed on
        // the next tick — same pattern as block-drag-plugin.
        const header = headerRef.current
        if (header) {
          const clone = header.cloneNode(true) as HTMLElement
          clone.style.position = 'absolute'
          clone.style.top = '-10000px'
          clone.style.left = '-10000px'
          clone.style.width = `${Math.min(header.offsetWidth, 480)}px`
          clone.style.maxWidth = '480px'
          clone.style.background = 'var(--color-background, white)'
          clone.style.border = '1px solid var(--color-border, #e5e7eb)'
          clone.style.borderRadius = '6px'
          clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
          clone.style.opacity = '0.95'
          clone.style.pointerEvents = 'none'
          document.body.appendChild(clone)
          e.dataTransfer.setDragImage(clone, 16, 16)
          setTimeout(() => clone.remove(), 0)
        }
      }
      // Don't let block-drag-plugin's view.dom-level dragstart see this.
      e.stopPropagation()
    },
    [editor, panelId, containerPos]
  )

  const handleDragEnd = useCallback(() => {
    // dragend also fires on document via panel-drag-state. This is the
    // belt-and-suspenders cleanup if the document listener missed it
    // (e.g. drag escapes to another window).
    if (getPanelDrag()?.panelId === panelId) {
      endPanelDrag()
    }
  }, [panelId])

  // Read the current drop indicator from module state.
  const dropState = getPanelDrop()
  const dragState = getPanelDrag()
  const dropEdge = dropState?.panelId === panelId ? dropState.edge : null
  const isSourceOfDrag = dragState?.panelId === panelId

  return (
    <NodeViewWrapper
      as='div'
      ref={wrapperRef}
      className={styles.accordionItem}
      style={{ opacity: isSourceOfDrag ? 0.5 : 1 }}
      data-panel=''
      data-accordion-item=''
      data-panel-id={panelId}
      data-expanded={isCollapsed ? 'false' : 'true'}
      data-drop-edge={dropEdge ?? undefined}>
      <div
        ref={headerRef}
        className={styles.accordionHeader}
        contentEditable={false}
        onClick={() => setIsCollapsed((v) => !v)}>
        <span
          className={styles.accordionDragHandle}
          aria-label='Drag item'
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}>
          <GripVertical size={14} />
        </span>
        <span className={styles.accordionChevron} aria-hidden='true'>
          <ChevronDown size={16} />
        </span>
        <span
          className={styles.accordionLabel}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.currentTarget as HTMLElement).blur()
            }
          }}
          onBlur={(e) => {
            const next = (e.currentTarget.textContent ?? '').trim()
            if (next !== label) onRename(next)
          }}>
          {label || 'Untitled'}
        </span>
        <button
          type='button'
          className={styles.accordionItemClose}
          aria-label='Remove item'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}>
          <X size={12} />
        </button>
      </div>
      <div className={styles.accordionBody}>
        <NodeViewContent className={styles.panelContent} />
      </div>
    </NodeViewWrapper>
  )
}
