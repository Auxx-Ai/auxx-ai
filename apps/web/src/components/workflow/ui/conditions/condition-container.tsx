// apps/web/src/components/workflow/ui/conditions/condition-container.tsx

'use client'

import { useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useConditionContext } from './condition-context'
import ConditionList from './components/condition-list'
import ConditionGroup from './components/condition-group'
import SortableConditionGroup from './components/sortable-condition-group'
import ConditionAdd from './components/condition-add'

interface ConditionContainerProps {
  className?: string
  title?: string
  description?: string
  emptyStateText?: string
  showAddButton?: boolean
  showGrouping?: boolean
}

/**
 * Main container component for the condition system
 * Handles both flat conditions and grouped conditions with DnD support
 */
const ConditionContainer = ({
  className,
  title,
  description,
  emptyStateText = 'No conditions added',
  showAddButton = true,
  showGrouping = false,
}: ConditionContainerProps) => {
  const { conditions, groups, config, readOnly, addGroup, reorderGroups } = useConditionContext()
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)

  const hasConditions = conditions.length > 0 || groups.length > 0
  const useGrouping = config.showGrouping && showGrouping
  const enableDnD = config.allowGroupReordering && !readOnly

  // DnD sensors (from if-else pattern)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveGroupId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (!over || !reorderGroups) {
        setActiveGroupId(null)
        return
      }

      if (active.id !== over.id) {
        const oldIndex = groups.findIndex((g) => g.id === active.id)
        const newIndex = groups.findIndex((g) => g.id === over.id)

        const reorderedGroups = arrayMove(groups, oldIndex, newIndex)
        const groupIds = reorderedGroups.map((g) => g.id)

        reorderGroups(groupIds)
      }

      setActiveGroupId(null)
    },
    [groups, reorderGroups]
  )

  const handleDragCancel = useCallback(() => {
    setActiveGroupId(null)
  }, [])

  // Get active group for drag overlay
  const activeGroup = groups.find((g) => g.id === activeGroupId)

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      {(title || description) && (
        <div>
          {title && <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}

      {/* Conditions content */}
      <div className="space-y-3">
        {/* Grouped conditions with DnD */}
        {useGrouping && groups.length > 0 && enableDnD && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}>
            <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {groups.map((group) => (
                  <SortableConditionGroup
                    key={group.id}
                    group={group}
                    showRemoveButton={groups.length > 1}
                    showNameInput={config.allowGroupNaming}
                    showDescription={config.showGroupDescription}
                    showSubtext={config.showGroupSubtext}
                    allowCollapse={config.allowGroupCollapse}
                    disabled={readOnly || groups.length === 1}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay adjustScale={false}>
              {activeGroup && (
                <div className="shadow-2xl opacity-90">
                  <ConditionGroup
                    group={activeGroup}
                    showDragHandle={false}
                    showNameInput={config.allowGroupNaming}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}

        {/* Grouped conditions without DnD */}
        {useGrouping && groups.length > 0 && !enableDnD && (
          <div className="space-y-2">
            {groups.map((group) => (
              <ConditionGroup
                key={group.id}
                group={group}
                showRemoveButton={groups.length > 1}
                showNameInput={config.allowGroupNaming}
                showDescription={config.showGroupDescription}
                showSubtext={config.showGroupSubtext}
                allowCollapse={config.allowGroupCollapse}
              />
            ))}
          </div>
        )}

        {/* Flat conditions */}
        {!useGrouping && conditions.length > 0 && (
          <div className="flex flex-col gap-2 p-3 pe-1">
            <ConditionList conditions={conditions} />
          </div>
        )}

        {/* Empty state */}
        {!hasConditions && (
          <div className="flex items-center justify-center  h-[49px] text-sm text-muted-foreground">
            {emptyStateText}
          </div>
        )}

        {/* Add controls */}
        {showAddButton && !readOnly && (
          <div className="flex gap-2">
            {/* Add condition button */}
            {!useGrouping && <ConditionAdd disabled={readOnly} buttonText="Add Condition" />}

            {/* Add group button */}
            {useGrouping && addGroup && (
              <Button size="sm" variant="outline" disabled={readOnly} onClick={() => addGroup()}>
                <Plus />
                {config.addGroupButtonText || 'Add Group'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ConditionContainer
