// apps/web/src/components/conditions/components/sortable-condition-group.tsx

'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ConditionGroup as ConditionGroupType } from '../types'
import ConditionGroup from './condition-group'

interface SortableConditionGroupProps {
  group: ConditionGroupType
  showNameInput?: boolean
  showDescription?: boolean
  showSubtext?: boolean
  allowCollapse?: boolean
  showRemoveButton?: boolean
  disabled?: boolean
}

/**
 * Sortable wrapper for ConditionGroup component
 */
const SortableConditionGroup = ({
  group,
  disabled,
  ...groupProps
}: SortableConditionGroupProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    disabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div data-field='group-condition' ref={setNodeRef} style={style}>
      <ConditionGroup
        group={group}
        showDragHandle={!disabled}
        isDragging={isDragging}
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
        {...groupProps}
      />
    </div>
  )
}

export default SortableConditionGroup
