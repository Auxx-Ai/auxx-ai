// apps/web/src/components/workflow/nodes/core/http/components/key-value-item.tsx

import React, { type FC, useCallback, useRef, useEffect, useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { InputEditor } from '~/components/workflow/ui/input-editor'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Button } from '@auxx/ui/components/button'
import { Trash2 } from 'lucide-react'
import { BaseType } from '~/components/workflow/types/variable-types'
import type { KeyValue } from '../types'

type Props = {
  instanceId: string
  className?: string
  nodeId: string
  readonly: boolean
  canRemove: boolean
  payload: KeyValue
  onChange: (newPayload: KeyValue) => void
  onRemove: () => void
  isLastItem: boolean
  onAdd: () => void
  isSupportFile?: boolean
  keyNotSupportVar?: boolean
  insertVarTipToLeft?: boolean
  itemIndex?: number
  // availableVariables: UnifiedVariable[]
  // variableGroups: VariableGroup[]
}

const KeyValueItem: FC<Props> = ({
  instanceId,
  className,
  nodeId,
  readonly,
  canRemove,
  payload,
  onChange,
  onRemove,
  isLastItem,
  onAdd,
  isSupportFile,
  keyNotSupportVar,
  insertVarTipToLeft,
  itemIndex = 0,
  // availableVariables,
  // variableGroups,
}) => {
  // Local state for immediate updates
  const [localKey, setLocalKey] = useState(payload.key || '')
  const [localValue, setLocalValue] = useState(payload.value || '')
  const [localType, setLocalType] = useState(payload.type || 'text')
  const [localFile, setLocalFile] = useState(payload.file)

  // Sync timer ref
  const syncTimerRef = useRef<NodeJS.Timeout>()

  // Update local state when payload changes from outside
  useEffect(() => {
    setLocalKey(payload.key || '')
    setLocalValue(payload.value || '')
    setLocalType(payload.type || 'text')
    setLocalFile(payload.file)
  }, [payload.key, payload.value, payload.type, payload.file])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
      }
    }
  }, [])

  // Sync local state to parent after delay
  const syncToParent = useCallback(() => {
    const newPayload: KeyValue = {
      ...payload,
      key: localKey,
      value: localValue,
      type: localType,
      file: localFile,
    }
    onChange(newPayload)
  }, [payload, localKey, localValue, localType, localFile, onChange])

  // Handle local changes with debounced sync
  const handleLocalChange = useCallback(
    (field: string) => {
      return (value: any) => {
        // Update local state immediately
        switch (field) {
          case 'key':
            setLocalKey(value)
            break
          case 'value':
            setLocalValue(value)
            break
          case 'type':
            setLocalType(value)
            break
          case 'file':
            setLocalFile(value)
            break
        }

        // Clear existing timer
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current)
        }

        // Set new timer to sync after 300ms of inactivity
        syncTimerRef.current = setTimeout(() => {
          syncToParent()
        }, 300)
      }
    },
    [syncToParent]
  )

  // Immediate sync for certain fields (like type selection)
  const handleImmediateChange = useCallback(
    (field: string) => {
      return (value: any) => {
        handleLocalChange(field)(value)
        // Force immediate sync for dropdown changes
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current)
        }
        setTimeout(syncToParent, 0)
      }
    },
    [handleLocalChange, syncToParent]
  )

  return (
    // group class name is for hover row show remove button
    <div
      className={cn(className, 'key-value-item h-min-7 group flex border-t  border-primary-200')}>
      <div
        className={cn(
          'shrink-0 border-r border-primary-200 ',
          isSupportFile ? 'w-[140px]' : 'w-1/2'
        )}>
        {!keyNotSupportVar ? (
          <InputEditor
            nodeId={nodeId}
            value={localKey}
            onChange={handleLocalChange('key')}
            onBlur={syncToParent}
            placeholder="type '{' to insert variable..."
            className="p-1 h-full focus-within:bg-primary-150/60 focus-within:hover:bg-primary-150/60 hover:bg-primary-100"
            disabled={readonly}
          />
        ) : (
          <input
            className="text-sm w-full px-3 py-1.5 appearance-none rounded-none border-none bg-transparent outline-none hover:bg-gray-50 focus:bg-gray-100 focus:ring-0"
            value={localKey}
            onChange={(e) => handleLocalChange('key')(e.target.value)}
            onBlur={syncToParent}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                const wrapper = e.currentTarget.closest('.key-value-item') as HTMLElement
                if (wrapper) {
                  const nextInput = wrapper.querySelector(
                    '.w-\\[70px\\] select, .relative input, .relative [contenteditable="true"]'
                  ) as HTMLElement
                  if (nextInput) {
                    e.preventDefault()
                    nextInput.focus()
                  }
                }
              }
            }}
            placeholder="Enter key..."
            disabled={readonly}
          />
        )}
      </div>
      {isSupportFile && (
        <div className="w-[70px] shrink-0 border-r border-primary-200 focus-within:bg-primary-150/60 focus-within:hover:bg-primary-150/60 hover:bg-primary-100">
          <Select
            value={localType}
            onValueChange={(value) => handleImmediateChange('type')(value)}
            disabled={readonly}>
            <SelectTrigger className="rounded-none h-7 text-primary-500 border-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-[80px]">
              <SelectItem value="text">text</SelectItem>
              <SelectItem value="file">file</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className={cn('relative', isSupportFile ? 'grow' : 'w-1/2')}>
        {isSupportFile && payload.type === 'file' ? (
          <VariablePicker
            nodeId={nodeId}
            value={localFile?.[1] || ''}
            onSelect={(variable) => {
              // Convert variable selection to file array format
              handleImmediateChange('file')(['sys', variable.id])
            }}
            allowedTypes={[BaseType.FILE, BaseType.ARRAY]}
            placeholder="Select file variable..."
            disabled={readonly}
            className="rounded-none border-none"
          />
        ) : (
          <InputEditor
            nodeId={nodeId}
            value={localValue}
            onChange={handleLocalChange('value')}
            onBlur={syncToParent}
            placeholder="type '{' to insert variable..."
            className={cn(
              'p-1 h-full',
              'focus-within:bg-primary-150/60',
              'focus-within:hover:bg-primary-150/60',
              'hover:bg-primary-100'
            )}
            disabled={readonly}
          />
        )}
        {/* Remove button - shows on hover if canRemove is true */}
        {canRemove && !readonly && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="absolute hover:text-destructive hover:bg-destructive/10 right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity size-6">
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  )
}

export default React.memo(KeyValueItem)
