// apps/web/src/components/conditions/condition-container.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import ConditionAdd from './components/condition-add'
import ConditionGroup from './components/condition-group'
import ConditionList from './components/condition-list'
import SortableConditionGroup from './components/sortable-condition-group'
import { useConditionContext } from './condition-context'

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

  // DnD sensors
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

  const activeGroup = groups.find((g) => g.id === activeGroupId)

  return (
    <div className={cn('space-y-4', className)}>
      {(title || description) && (
        <div>
          {title && <h3 className='text-sm font-medium text-foreground mb-1'>{title}</h3>}
          {description && <p className='text-xs text-muted-foreground'>{description}</p>}
        </div>
      )}

      <div className='space-y-3'>
        {useGrouping && groups.length > 0 && enableDnD && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}>
            <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
              <div className='space-y-2'>
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
                <div className='shadow-2xl opacity-90'>
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

        {useGrouping && groups.length > 0 && !enableDnD && (
          <div className='space-y-2'>
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

        {!useGrouping && conditions.length > 0 && (
          <div className='flex flex-col gap-2 p-3 pe-1'>
            <ConditionList conditions={conditions} />
          </div>
        )}

        {!hasConditions && (
          <div className='flex items-center justify-center  h-[49px] text-sm text-muted-foreground'>
            {emptyStateText}
          </div>
        )}

        {showAddButton && !readOnly && (
          <div className='flex gap-2'>
            {!useGrouping && <ConditionAdd disabled={readOnly} buttonText='Add Condition' />}

            {useGrouping && addGroup && (
              <Button
                data-field='add-group'
                size='sm'
                variant='outline'
                disabled={readOnly}
                onClick={() => addGroup()}>
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
