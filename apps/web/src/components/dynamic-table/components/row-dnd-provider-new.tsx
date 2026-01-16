// apps/web/src/components/dynamic-table/components/row-dnd-provider-new.tsx

'use client'

import { useCallback } from 'react'
import {
  DndContext,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDndMonitor,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { DndDebugOverlay } from './dnd-debug-overlay'
import { useTableInstance } from '../context/table-instance-context'
import { useTableConfig } from '../context/table-config-context'
import { useViewMetadata } from '../context/view-metadata-context'

interface RowDndProviderProps<TData> {
  children: React.ReactNode
}

/**
 * DndContext specifically for row drag-and-drop functionality
 * Supports both standalone and monitor modes for external contexts
 *
 * Migrated to use split contexts instead of monolithic TableContext
 */
export function RowDndProvider<TData>({ children }: RowDndProviderProps<TData>) {
  const { table } = useTableInstance<TData>()
  const { dragDropConfig, debug } = useTableConfig<TData>()
  const { activeDragItems, setActiveDragItems } = useViewMetadata<TData>()

  const external = !!dragDropConfig?.externalDnd

  // Row-specific sensors with larger activation distance for better UX (only used when NOT external)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  // Handle row drag start
  const handleRowDragStart = useCallback(
    (event: DragStartEvent) => {
      // Only handle table row drag events
      if (!event.active.data.current?.sourceRow) return

      const activeId = event.active.data.current.sourceRow.id
      const selectedRowIds = Object.keys(table.getState().rowSelection).filter(
        (id) => table.getState().rowSelection[id]
      )

      let itemsToDrag = selectedRowIds.map((id) => table.getRow(id))
      if (!selectedRowIds.includes(activeId)) {
        itemsToDrag.push(table.getRow(activeId))
      }

      setActiveDragItems(itemsToDrag)
      dragDropConfig?.onDragStart?.(itemsToDrag.map((r) => r.original))
    },
    [table, setActiveDragItems, dragDropConfig]
  )

  // Handle row drag end
  const handleRowDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      const dragged = (activeDragItems ?? []).map((r) => r.original)

      if (!over) {
        dragDropConfig?.onDragCancel?.()
        setActiveDragItems(null)
        dragDropConfig?.onDragEnd?.({ items: dragged })
        return
      }

      const overType = over.data.current?.type

      // Row-to-row drop
      if (active.data.current?.type === 'table-row' && overType === 'table-row-drop') {
        const targetRow = over.data.current?.targetRow as TData
        if (dragDropConfig?.onDrop && activeDragItems && targetRow) {
          try {
            await dragDropConfig.onDrop(dragged, targetRow, 'inside')
          } catch (error) {
            console.error('Drop operation failed:', error)
          }
        }
        dragDropConfig?.onDragEnd?.({ items: dragged, over: { type: 'row', item: targetRow } })
      } else if (dragDropConfig?.onDropExternal) {
        // External target (e.g., breadcrumb)
        const mapped = dragDropConfig.getExternalTargetData?.(over)
        if (mapped) {
          try {
            await dragDropConfig.onDropExternal(dragged, mapped)
          } catch (error) {
            console.error('External drop operation failed:', error)
          }
          dragDropConfig?.onDragEnd?.({ items: dragged, over: mapped })
        } else {
          dragDropConfig?.onDragEnd?.({ items: dragged })
        }
      }

      setActiveDragItems(null)
    },
    [activeDragItems, dragDropConfig, setActiveDragItems]
  )

  // Handle row drag cancel
  const handleRowDragCancel = useCallback(() => {
    setActiveDragItems(null)
    dragDropConfig?.onDragCancel?.()
  }, [setActiveDragItems, dragDropConfig])

  // Don't render anything if drag-drop is disabled
  if (!dragDropConfig?.enabled) {
    return <>{children}</>
  }

  // Monitor mode for external DnD contexts
  if (external) {
    useDndMonitor({
      onDragStart: handleRowDragStart,
      onDragEnd: handleRowDragEnd,
      onDragCancel: handleRowDragCancel,
    })

    return (
      <>
        {children}

        {/* Row drag overlay - still render in monitor mode */}
        <DragOverlay
          dropAnimation={null}
          adjustScale={false}
          modifiers={[snapCenterToCursor]}
          style={{ width: 'auto' }}
          className="w-auto">
          {activeDragItems && dragDropConfig?.dragPreview ? (
            <dragDropConfig.dragPreview items={activeDragItems} isDragging={true} />
          ) : activeDragItems ? (
            <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-48 flex items-center gap-2">
              <span className="text-sm font-medium">
                {activeDragItems.length === 1 ? `1 item` : `${activeDragItems.length} items`}
              </span>
            </div>
          ) : null}
        </DragOverlay>

        {/* Debug overlay */}
        <DndDebugOverlay
          enabled={debug?.enabled ?? false}
          showRects={debug?.showRects ?? true}
          showCenters={debug?.showCenters ?? false}
          showDistances={debug?.showDistances ?? false}
        />
      </>
    )
  }

  // Legacy standalone mode
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleRowDragStart}
      onDragEnd={handleRowDragEnd}
      onDragCancel={handleRowDragCancel}>
      {children}

      {/* Row drag overlay */}
      <DragOverlay
        dropAnimation={null}
        adjustScale={false}
        modifiers={[snapCenterToCursor]}
        style={{ width: 'auto' }}
        className="w-auto">
        {activeDragItems && dragDropConfig?.dragPreview ? (
          <dragDropConfig.dragPreview items={activeDragItems} isDragging={true} />
        ) : activeDragItems ? (
          <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-48 flex items-center gap-2">
            <span className="text-sm font-medium">
              {activeDragItems.length === 1 ? `1 item` : `${activeDragItems.length} items`}
            </span>
          </div>
        ) : null}
      </DragOverlay>

      {/* Debug overlay */}
      <DndDebugOverlay
        enabled={debug?.enabled ?? false}
        showRects={debug?.showRects ?? true}
        showCenters={debug?.showCenters ?? false}
        showDistances={debug?.showDistances ?? false}
      />
    </DndContext>
  )
}
