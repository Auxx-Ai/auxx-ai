// apps/web/src/components/editor/kb-article/tabs-node-view.tsx
'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import blockStyles from './block-node-view.module.css'
import {
  addPanel,
  collectPanels,
  focusFirstBlockInPanel,
  type PanelLite,
  removePanel,
  reorderPanels,
  setPanelAttr,
} from './container-helpers'
import styles from './container-node-view.module.css'
import { TabEditPopover } from './tab-edit-popover'

export function TabsNodeView({ node, editor, getPos }: NodeViewProps) {
  const panels = useMemo(() => collectPanels(node), [node])
  // Stable id key — change only when the panel set changes, not on every body
  // edit. SortableContext re-registers items when its `items` prop reference
  // changes; passing a derived stable array avoids re-registering on every
  // keystroke.
  const panelIdsKey = panels.map((p) => p.id).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: panelIdsKey encodes the relevant change
  const panelIds = useMemo(() => panels.map((p) => p.id), [panelIdsKey])

  const [activeId, setActiveId] = useState<string>(() => panels[0]?.id ?? '')
  const [editingId, setEditingId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Fall back to first panel if active was deleted.
  useEffect(() => {
    if (panels.length === 0) return
    if (!panels.find((p) => p.id === activeId)) {
      setActiveId(panels[0].id)
    }
  }, [panels, activeId])

  // Toggle panel body visibility. Runs only when active changes or the panel
  // SET changes — not on every keystroke inside the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: panelIdsKey covers the panel-set change
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const items = body.querySelectorAll<HTMLElement>('[data-panel][data-panel-id]')
    items.forEach((el) => {
      el.style.display = el.getAttribute('data-panel-id') === activeId ? '' : 'none'
    })
  }, [activeId, panelIdsKey])

  const containerPos = typeof getPos === 'function' ? getPos() : null

  // Line-number gutter — same logic as BlockNodeView so containers align
  // visually with the rest of the article.
  const lineNumber =
    typeof containerPos === 'number' ? editor.state.doc.resolve(containerPos).index(0) + 1 : null

  const selectThisContainer = (event: React.MouseEvent) => {
    if (typeof containerPos !== 'number') return
    event.preventDefault()
    event.stopPropagation()
    editor.commands.setNodeSelection(containerPos)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || containerPos == null) return
      const fromIndex = panels.findIndex((p) => p.id === active.id)
      const toIndex = panels.findIndex((p) => p.id === over.id)
      if (fromIndex < 0 || toIndex < 0) return
      reorderPanels(editor, containerPos, fromIndex, toIndex)
    },
    [panels, editor, containerPos]
  )

  const handleAdd = useCallback(() => {
    if (containerPos == null) return
    const nextNumber = panels.length + 1
    const newId = addPanel(editor, containerPos, `Tab ${nextNumber}`)
    if (newId) {
      setActiveId(newId)
      focusFirstBlockInPanel(editor, containerPos, newId)
    }
  }, [editor, containerPos, panels.length])

  const handleDelete = useCallback(
    (panelId: string) => {
      if (containerPos == null) return
      removePanel(editor, containerPos, panelId)
    },
    [editor, containerPos]
  )

  const handleRename = useCallback(
    (panelId: string, label: string) => {
      if (containerPos == null) return
      setPanelAttr(editor, containerPos, panelId, { label })
    },
    [editor, containerPos]
  )

  const handleSelect = useCallback(
    (panelId: string) => {
      setActiveId(panelId)
      if (containerPos != null) focusFirstBlockInPanel(editor, containerPos, panelId)
    },
    [editor, containerPos]
  )

  return (
    <NodeViewWrapper as='div' className={blockStyles.blockWrapper} data-tabs=''>
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
          className={`${blockStyles.blockContentWrapper} ${styles.containerContent} ${styles.tabsContainerContent}`}>
          <div className={styles.tabsHeader} contentEditable={false} role='tablist'>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToHorizontalAxis]}
              onDragEnd={handleDragEnd}>
              <SortableContext items={panelIds} strategy={horizontalListSortingStrategy}>
                {panels.map((panel) => (
                  <SortableTabHeader
                    key={panel.id}
                    panel={panel}
                    isActive={panel.id === activeId}
                    isEditing={editingId === panel.id}
                    onSelect={() => handleSelect(panel.id)}
                    onDelete={() => handleDelete(panel.id)}
                    onRename={(label) => handleRename(panel.id, label)}
                    onEditOpenChange={(open) => setEditingId(open ? panel.id : null)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <button
              type='button'
              className={styles.addTabButton}
              onClick={handleAdd}
              aria-label='Add tab'>
              <Plus size={14} />
              <span>Add tab</span>
            </button>
          </div>

          <div ref={bodyRef} className={styles.tabsBody}>
            <NodeViewContent />
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

interface SortableTabHeaderProps {
  panel: PanelLite
  isActive: boolean
  isEditing: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (label: string) => void
  onEditOpenChange: (open: boolean) => void
}

function SortableTabHeader({
  panel,
  isActive,
  isEditing,
  onSelect,
  onDelete,
  onRename,
  onEditOpenChange,
}: SortableTabHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: panel.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <TabEditPopover
      initialLabel={panel.label}
      open={isEditing}
      onOpenChange={onEditOpenChange}
      onChange={onRename}
      onDelete={onDelete}>
      <div
        ref={setNodeRef}
        style={style}
        className={styles.tabButton}
        role='tab'
        aria-selected={isActive}
        data-dragging={isDragging || undefined}
        data-active={isActive || undefined}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          if (e.defaultPrevented) return
          // Click an already-active tab to open the edit popover; otherwise switch.
          if (isActive) {
            onEditOpenChange(true)
            return
          }
          onSelect()
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onEditOpenChange(true)
        }}>
        <span className={styles.tabButtonLabel}>{panel.label || 'Untitled'}</span>
        <button
          type='button'
          aria-label='Remove tab'
          tabIndex={-1}
          className={styles.tabButtonClose}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}>
          <X size={11} />
        </button>
      </div>
    </TabEditPopover>
  )
}
