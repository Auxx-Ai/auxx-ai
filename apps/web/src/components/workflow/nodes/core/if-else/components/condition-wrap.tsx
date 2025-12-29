// apps/web/src/components/workflow/nodes/if-else/components/condition-wrap.tsx

'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
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
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, GripVertical } from 'lucide-react'
// SUB_VARIABLES removed - file properties are now navigable through variable picker
import ConditionList from './condition-list'
import ConditionAdd from './condition-add'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@auxx/ui/components/select'
import type { IfElseCase } from '../types'
import { useIfElseActions } from '../if-else-context'

type Props = { isSubVariable?: boolean; caseId?: string; conditionId?: string; cases: IfElseCase[] }

interface SortableItemProps {
  id: string
  children: React.ReactNode
  disabled?: boolean
}

const SortableItem: FC<SortableItemProps> = ({ id, children, disabled }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  // const transformWOyScale = { ...transform }
  // console.log('SortableItem rendered:', transformWOyScale)
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="relative">
        {!disabled && (
          <div
            {...attributes}
            {...listeners}
            className="handle absolute left-1 top-2 cursor-move text-muted-foreground z-10">
            <GripVertical className="h-3 w-3 " />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

const ConditionWrap: FC<Props> = ({ isSubVariable, caseId, conditionId, cases = [] }) => {
  const { readOnly, nodeId, addCase, removeCase, sortCases } = useIfElseActions()
  const [willDeleteCaseId, setWillDeleteCaseId] = useState('')
  const casesLength = cases.length

  const [activeItem, setActiveItem] = useState<SortableItem | undefined>(undefined)

  // Legacy sub-variable functionality - deprecated in favor of structured file variables
  // File properties are now navigable directly through the variable picker
  const subVarOptions: { name: string; value: string }[] = []

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    setActiveItem(active)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (!over) return
      const activeItem = cases.find((item) => item.case_id === active.id)
      const overItem = cases.find((item) => item.case_id === over.id)

      if (!activeItem || !overItem) {
        return
      }

      if (over && active.id !== over.id) {
        const oldIndex = cases.findIndex((item) => item.case_id === active.id)
        const newIndex = cases.findIndex((item) => item.case_id === over.id)

        const newCases = arrayMove(cases, oldIndex, newIndex)
        sortCases(newCases)
      }

      setActiveItem(undefined)
    },
    [cases, sortCases]
  )

  const handleDragCancel = useCallback(() => {
    setActiveItem(undefined)
  }, [])

  const renderCaseItem = (item: IfElseCase, index: number) => (
    <div key={item.case_id}>
      <div
        className={cn(
          'group relative rounded-[10px]',
          willDeleteCaseId === item.case_id && 'bg-destructive/10',
          !isSubVariable && 'min-h-[40px] ps-3 pe-1 py-1',
          isSubVariable && 'px-1 py-2'
        )}>
        {!isSubVariable && (
          <>
            <div
              className={cn(
                'absolute left-4 text-[13px] font-semibold leading-4 text-muted-foreground',
                casesLength === 1 ? 'top-2.5' : 'top-1'
              )}>
              {index === 0 ? 'IF' : 'ELIF'}
              {casesLength > 1 && (
                <div className="text-[10px] font-medium text-muted-foreground">
                  CASE {index + 1}
                </div>
              )}
            </div>
          </>
        )}

        {!!item.conditions.length && (
          <div className="mb-2">
            <ConditionList
              caseItem={item}
              caseId={isSubVariable ? caseId! : item.case_id}
              conditionId={conditionId}
              isSubVariable={isSubVariable}
            />
          </div>
        )}

        <div
          className={cn(
            'flex items-center justify-between pr-[1px]',
            !item.conditions.length && !isSubVariable && 'mt-0.5 LAL',
            !item.conditions.length && isSubVariable && 'mt-2',
            !isSubVariable && ' pl-[60px]'
          )}>
          {isSubVariable ? (
            <Select onValueChange={(value) => {}} value="">
              <SelectTrigger asChild>
                <Button size="sm" variant="outline" disabled={readOnly}>
                  <Plus />
                  Add Sub Variable
                </Button>
              </SelectTrigger>
              <SelectContent>
                {subVarOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <ConditionAdd disabled={readOnly} caseId={item.case_id} />
          )}

          {((index === 0 && casesLength > 1) || index > 0) && (
            <Button
              className="hover:bg-destructive/10 hover:text-destructive"
              size="sm"
              variant="ghost"
              disabled={readOnly}
              onClick={() => removeCase(item.case_id)}
              onMouseEnter={() => setWillDeleteCaseId(item.case_id)}
              onMouseLeave={() => setWillDeleteCaseId('')}>
              <Trash2 />
              Remove
            </Button>
          )}
        </div>
      </div>
      {!isSubVariable && <div className="mx-3 my-2 h-[1px] bg-primary-200"></div>}
    </div>
  )

  if (readOnly || isSubVariable) {
    return (
      <>
        {cases.map((item, index) => renderCaseItem(item, index))}
        {cases.length === 0 && !isSubVariable && (
          <Button size="sm" variant="outline" disabled={readOnly} onClick={addCase}>
            <Plus />
            Add Case
          </Button>
        )}
        {cases.length === 0 && isSubVariable && (
          <Button size="sm" variant="outline" disabled={readOnly} onClick={() => {}}>
            <Plus />
            Add Sub Variable
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 pe-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}>
        <SortableContext
          items={cases.map((item) => item.case_id)}
          strategy={verticalListSortingStrategy}>
          {cases.map((item, index) => (
            <SortableItem
              key={item.case_id}
              id={item.case_id}
              disabled={readOnly || isSubVariable || casesLength === 1}>
              {renderCaseItem(item, index)}
            </SortableItem>
          ))}
        </SortableContext>
        <DragOverlay adjustScale={false}>
          {activeItem ? <SortableItem id={activeItem.id}>LALAL</SortableItem> : null}
        </DragOverlay>
        {/* <DragOverlay adjustScale={false}></DragOverlay> */}
      </DndContext>

      {/* {cases.length === 0 && ( */}
      <Button size="sm" variant="outline" disabled={readOnly} onClick={addCase}>
        <Plus />
        Add Case
      </Button>
      {/* )} */}
    </div>
  )
}
export default React.memo(ConditionWrap)
