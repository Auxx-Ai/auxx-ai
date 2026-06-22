// apps/web/src/components/global/http-request/key-value-item.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { Trash2 } from 'lucide-react'
import React, { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { useHttpRequestField } from './field-editor'
import type { KeyValue } from './types'

type Props = {
  instanceId: string
  className?: string
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
}

const KeyValueItem: FC<Props> = ({
  instanceId,
  className,
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
}) => {
  const { FieldEditor, FilePicker, keyPlaceholder, valuePlaceholder } = useHttpRequestField()

  // Falls back to the workflow variable hint; the plain connector surface
  // overrides these via the field-editor context.
  const VAR_HINT = "type '{' to insert variable..."
  const resolvedKeyPlaceholder = keyPlaceholder ?? VAR_HINT
  const resolvedValuePlaceholder = valuePlaceholder ?? VAR_HINT

  // File rows only make sense when a FilePicker is injected.
  const supportFile = isSupportFile && !!FilePicker

  // Local state for immediate UI updates
  const [localKey, setLocalKey] = useState(payload.key || '')
  const [localValue, setLocalValue] = useState(payload.value || '')
  const [localType, setLocalType] = useState(payload.type || 'text')
  const [localFile, setLocalFile] = useState(payload.file)

  // Refs to always have current values (avoids stale closures in debounced sync)
  const localKeyRef = useRef(localKey)
  const localValueRef = useRef(localValue)
  const localTypeRef = useRef(localType)
  const localFileRef = useRef(localFile)
  const payloadRef = useRef(payload)
  const onChangeRef = useRef(onChange)

  // Keep refs in sync during render
  localKeyRef.current = localKey
  localValueRef.current = localValue
  localTypeRef.current = localType
  localFileRef.current = localFile
  payloadRef.current = payload
  onChangeRef.current = onChange

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

  // Stable sync function — reads from refs so it always has current values
  const syncToParent = useCallback(() => {
    const newPayload: KeyValue = {
      ...payloadRef.current,
      key: localKeyRef.current,
      value: localValueRef.current,
      type: localTypeRef.current,
      file: localFileRef.current,
    }
    onChangeRef.current(newPayload)
  }, [])

  // Stable handler — updates local state + ref immediately, debounces parent sync
  const handleLocalChange = useCallback(
    (field: string) => {
      return (value: any) => {
        // Update both state and ref immediately
        switch (field) {
          case 'key':
            setLocalKey(value)
            localKeyRef.current = value
            break
          case 'value':
            setLocalValue(value)
            localValueRef.current = value
            break
          case 'type':
            setLocalType(value)
            localTypeRef.current = value
            break
          case 'file':
            setLocalFile(value)
            localFileRef.current = value
            break
        }

        // Debounce parent sync
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current)
        }
        syncTimerRef.current = setTimeout(syncToParent, 300)
      }
    },
    [syncToParent]
  )

  // Immediate sync for discrete changes (like type selection)
  const handleImmediateChange = useCallback(
    (field: string) => {
      return (value: any) => {
        handleLocalChange(field)(value)
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
    <div className={cn(className, 'key-value-item min-h-8 group flex border-t border-primary-200')}>
      <div
        data-kv-row={itemIndex}
        data-kv-col={0}
        className={cn(
          'shrink-0 border-r border-primary-200 ',
          supportFile ? 'w-[140px]' : 'w-1/2'
        )}>
        {!keyNotSupportVar ? (
          <FieldEditor
            value={localKey}
            onChange={handleLocalChange('key')}
            onBlur={syncToParent}
            placeholder={resolvedKeyPlaceholder}
            className='p-1 h-full focus-within:bg-primary-150/60 focus-within:hover:bg-primary-150/60 hover:bg-primary-100'
            disabled={readonly}
          />
        ) : (
          <input
            className='text-sm w-full px-3 py-1.5 appearance-none rounded-none border-none bg-transparent outline-none hover:bg-primary-100  focus:bg-primary-200 focus:ring-0'
            value={localKey}
            onChange={(e) => handleLocalChange('key')(e.target.value)}
            onBlur={syncToParent}
            placeholder='Enter key...'
            disabled={readonly}
          />
        )}
      </div>
      {supportFile && (
        <div
          data-kv-row={itemIndex}
          data-kv-col={1}
          className='w-[70px] shrink-0 border-r border-primary-200 focus-within:bg-primary-150/60 focus-within:hover:bg-primary-150/60 hover:bg-primary-100'>
          <Select
            value={localType}
            onValueChange={(value) => handleImmediateChange('type')(value)}
            disabled={readonly}>
            <SelectTrigger className='rounded-none h-7 text-primary-500 border-none focus:ring-0'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='w-[80px]'>
              <SelectItem value='text'>text</SelectItem>
              <SelectItem value='file'>file</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div
        data-kv-row={itemIndex}
        data-kv-col={supportFile ? 2 : 1}
        className={cn('relative', supportFile ? 'grow' : 'w-1/2')}>
        {supportFile && payload.type === 'file' && FilePicker ? (
          <FilePicker
            value={localFile?.[1] || ''}
            onSelect={(file) => handleImmediateChange('file')(file)}
            placeholder='Select file variable...'
            disabled={readonly}
            className='rounded-none border-none'
          />
        ) : (
          <FieldEditor
            value={localValue}
            onChange={handleLocalChange('value')}
            onBlur={syncToParent}
            placeholder={resolvedValuePlaceholder}
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
            variant='ghost'
            size='icon-sm'
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className='absolute hover:text-destructive hover:bg-destructive/10 right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity size-6'>
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  )
}

export default React.memo(KeyValueItem)
