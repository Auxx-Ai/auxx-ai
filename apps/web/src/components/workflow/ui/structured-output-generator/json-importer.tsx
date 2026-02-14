// apps/web/src/components/workflow/ui/structured-output-generator/json-importer.tsx

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { X } from 'lucide-react'
import React, { type FC, useCallback, useEffect, useRef, useState } from 'react'
import CodeEditor from './code-editor'
import ErrorMessage from './error-message'
import { JSON_SCHEMA_MAX_DEPTH } from './types'
import { checkJsonDepth } from './utils'
import { useEventEmitter } from './visual-editor/context'
import { useVisualEditorStore } from './visual-editor/store'

type JsonImporterProps = {
  onSubmit: (schema: any) => void
  updateBtnWidth: (width: number) => void
}

const JsonImporter: FC<JsonImporterProps> = ({ onSubmit, updateBtnWidth }) => {
  const [open, setOpen] = useState(false)
  const [json, setJson] = useState('')
  const [parseError, setParseError] = useState<any>(null)
  const importBtnRef = useRef<HTMLButtonElement>(null)
  const advancedEditing = useVisualEditorStore((state) => state.advancedEditing)
  const isAddingNewField = useVisualEditorStore((state) => state.isAddingNewField)
  const { emit } = useEventEmitter()

  useEffect(() => {
    if (importBtnRef.current) {
      const rect = importBtnRef.current.getBoundingClientRect()
      updateBtnWidth(rect.width)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTrigger = useCallback(
    (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      e.stopPropagation()
      if (advancedEditing || isAddingNewField) emit('quitEditing', {})
      setOpen(!open)
    },
    [open, advancedEditing, isAddingNewField, emit]
  )

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleSubmit = useCallback(() => {
    try {
      const parsedJSON = JSON.parse(json)
      if (typeof parsedJSON !== 'object' || Array.isArray(parsedJSON)) {
        setParseError(new Error('Root must be an object, not an array or primitive value.'))
        return
      }
      const maxDepth = checkJsonDepth(parsedJSON)
      if (maxDepth > JSON_SCHEMA_MAX_DEPTH) {
        setParseError({
          type: 'error',
          message: `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`,
        })
        return
      }
      onSubmit(parsedJSON)
      setParseError(null)
      setOpen(false)
    } catch (e: any) {
      if (e instanceof Error) setParseError(e)
      else setParseError(new Error('Invalid JSON'))
    }
  }, [onSubmit, json])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={importBtnRef}
          variant='outline'
          size='sm'
          className={cn(open && 'bg-components-button-ghost-bg-hover')}
          onClick={handleTrigger}>
          Import
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[400px] p-0' align='end' sideOffset={4} alignOffset={16}>
        <div className='flex flex-col'>
          {/* Title */}
          <div className='relative px-3 pb-1 pt-3.5'>
            <button
              className='absolute bottom-0 right-2.5 flex h-8 w-8 items-center justify-center'
              onClick={onClose}>
              <X className='h-4 w-4' />
            </button>
            <div className='font-semibold flex pl-1 pr-8 text-primary-500'>Import</div>
          </div>
          {/* Content */}
          <div className='px-4 py-2'>
            <CodeEditor
              className='rounded-lg'
              editorWrapperClassName='h-[340px]'
              value={json}
              onUpdate={setJson}
              showFormatButton={false}
            />
            {parseError && <ErrorMessage message={parseError.message} />}
          </div>
          {/* Footer */}
          <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
            <Button variant='ghost' size='sm' onClick={onClose}>
              Cancel
            </Button>
            <Button variant='outline' size='sm' onClick={handleSubmit}>
              Submit
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default JsonImporter
