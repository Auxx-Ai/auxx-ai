// apps/web/src/components/conditions/components/condition-group.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { Edit2, GripVertical, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useConditionContext } from '../condition-context'
import type { ConditionGroupProps } from '../types'
import ConditionAdd from './condition-add'
import ConditionList from './condition-list'

/**
 * Enhanced condition group component with naming, subtext, and sortability
 */
const ConditionGroup = ({
  group,
  showDragHandle = false,
  showRemoveButton = true,
  showNameInput = false,
  showSubtext = false,
  isDragging = false,
  className,
  onRemove,
  dragHandleAttributes,
  dragHandleListeners,
}: ConditionGroupProps) => {
  const [willDelete, setWillDelete] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [localName, setLocalName] = useState(group.metadata?.name || '')

  const {
    readOnly,
    config,
    removeGroup,
    toggleGroupLogicalOperator,
    updateGroupMetadata,
    toggleGroupCollapse,
  } = useConditionContext()

  const isCollapsed = group.metadata?.collapsed || false
  const hasConditions = group.conditions.length > 0
  const hasMultipleConditions = group.conditions.length > 1

  const handleRemove = () => {
    if (onRemove) {
      onRemove()
    } else if (removeGroup) {
      removeGroup(group.id)
    }
  }

  const handleToggleLogicalOperator = () => {
    if (toggleGroupLogicalOperator) {
      toggleGroupLogicalOperator(group.id)
    }
  }

  const handleToggleCollapse = () => {
    if (toggleGroupCollapse) {
      toggleGroupCollapse(group.id)
    }
  }

  const handleNameChange = (name: string) => {
    if (updateGroupMetadata) {
      updateGroupMetadata(group.id, { name })
    }
  }

  const handleNameBlur = () => {
    setIsEditingName(false)
    handleNameChange(localName)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameBlur()
    } else if (e.key === 'Escape') {
      setLocalName(group.metadata?.name || '')
      setIsEditingName(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'group/condition-group relative rounded-[10px] transition-all',
          isDragging && 'opacity-50',
          willDelete && 'bg-destructive/10',
          'min-h-[40px] ps-1 pe-1 py-1',
          className
        )}>
        {showDragHandle && !readOnly && (
          <button
            className='left-1 top-3 absolute cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing'
            {...dragHandleAttributes}
            {...dragHandleListeners}>
            <GripVertical className='size-3' />
          </button>
        )}

        {showNameInput ? (
          isEditingName ? (
            <Input
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              placeholder={config.groupNamePlaceholder || 'Enter group name...'}
              className='h-7 text-sm font-medium'
              autoFocus
              disabled={readOnly}
            />
          ) : (
            <button
              onClick={() => !readOnly && setIsEditingName(true)}
              className={cn(
                'absolute z-10 left-4 top-1 flex items-center gap-1 text-[13px] font-semibold leading-4 text-muted-foreground',
                readOnly ? 'cursor-default' : ''
              )}>
              <span className='truncate'>
                {group.metadata?.name || config.defaultGroupName || 'Group'}
              </span>
              {!readOnly && (
                <Edit2 className='h-3 w-3 opacity-0 transition-opacity group-hover/condition-group:opacity-100' />
              )}
            </button>
          )
        ) : (
          <div
            className={cn(
              'absolute left-4 text-[13px] font-semibold leading-4 text-muted-foreground',
              !showSubtext || group?.metadata?.subtext == '' ? 'top-2.5' : 'top-1'
            )}>
            {group.metadata?.name || config.defaultGroupName || 'Group'}
            {showSubtext && group.metadata?.subtext && (
              <div className='text-[10px] font-medium text-muted-foreground'>
                {group.metadata.subtext}
              </div>
            )}
          </div>
        )}

        {!isCollapsed && (
          <>
            {hasConditions && (
              <div className='pb-2'>
                <ConditionList conditions={group.conditions} groupId={group.id} />
              </div>
            )}

            <div className={cn('flex items-center justify-between pr-[1px]', 'pl-[70px]')}>
              <ConditionAdd groupId={group.id} disabled={readOnly} />
              {showRemoveButton && !readOnly && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='hover:bg-destructive/10 hover:text-destructive'
                  onClick={handleRemove}
                  onMouseEnter={() => setWillDelete(true)}
                  onMouseLeave={() => setWillDelete(false)}>
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <div data-field='group-divider' className='mx-3 my-2 h-[1px] bg-primary-300/30'></div>
    </>
  )
}

export default ConditionGroup
