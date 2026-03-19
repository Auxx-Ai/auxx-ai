// apps/web/src/components/workflow/nodes/core/http/components/key-value-list.tsx

import { cn } from '@auxx/ui/lib/utils'
import { produce } from 'immer'
import React, { type FC, useCallback, useRef } from 'react'
import { useKeyValueNavigation } from '../hooks/use-key-value-navigation'
import type { KeyValue } from '../types'
import KeyValueItem from './key-value-item'

type Props = {
  readonly: boolean
  nodeId?: string
  list: KeyValue[]
  onChange: (newList: KeyValue[]) => void
  onAdd: () => void
  isSupportFile?: boolean
  keyNotSupportVar?: boolean
  insertVarTipToLeft?: boolean
}

const KeyValueList: FC<Props> = ({
  readonly,
  nodeId,
  list,
  onChange,
  onAdd,
  isSupportFile = false,
  keyNotSupportVar,
  insertVarTipToLeft,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const colCount = isSupportFile ? 3 : 2

  useKeyValueNavigation({
    containerRef,
    rowCount: list.length,
    colCount,
    onAddRow: onAdd,
    readonly,
  })

  // Refs for stable callbacks — updated synchronously during render
  const listRef = React.useRef(list)
  const onChangeRef = React.useRef(onChange)
  listRef.current = list
  onChangeRef.current = onChange

  // Stable callback that doesn't recreate on every render
  const handleChange = useCallback((index: number, newItem: KeyValue) => {
    const newList = produce(listRef.current, (draft: any) => {
      draft[index] = newItem
    })
    onChangeRef.current(newList)
  }, [])

  // Stable callback for remove
  const handleRemove = useCallback((index: number) => {
    const newList = produce(listRef.current, (draft: any) => {
      draft.splice(index, 1)
    })
    onChangeRef.current(newList)
  }, [])

  if (!Array.isArray(list)) return null

  return (
    <div ref={containerRef} className='overflow-hidden rounded-lg border border-primary-200'>
      <div
        className={cn(
          'text-xs font-medium uppercase flex h-7 items-center leading-7 text-muted-foreground'
        )}>
        <div
          className={cn(
            'h-full border-r border-primary-200 pl-3',
            isSupportFile ? 'w-[140px]' : 'w-1/2'
          )}>
          Key
        </div>
        {isSupportFile && (
          <div className='h-full w-[70px] shrink-0 border-r border-primary-200 pl-3'>Type</div>
        )}
        <div
          className={cn(
            'h-full items-center justify-between pl-3 pr-1',
            isSupportFile ? 'grow' : 'w-1/2'
          )}>
          Value
        </div>
      </div>
      {list.map((item, index) => (
        <KeyValueItem
          key={item.id}
          instanceId={item.id!}
          nodeId={nodeId}
          payload={item}
          onChange={(newItem) => handleChange(index, newItem)}
          onRemove={() => handleRemove(index)}
          isLastItem={index === list.length - 1}
          onAdd={onAdd}
          readonly={readonly}
          canRemove={list.length > 1}
          isSupportFile={isSupportFile}
          keyNotSupportVar={keyNotSupportVar}
          insertVarTipToLeft={insertVarTipToLeft}
          itemIndex={index}
        />
      ))}
    </div>
  )
}

export default React.memo(KeyValueList)
