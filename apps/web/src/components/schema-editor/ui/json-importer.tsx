// apps/web/src/components/schema-editor/ui/json-importer.tsx

import { inferJsonSchema } from '@auxx/lib/json-schema/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, X } from 'lucide-react'
import { type MouseEvent, useCallback, useState } from 'react'
import { checkJsonSchemaDepth, JSON_SCHEMA_MAX_DEPTH } from '../validation'
import { CodeEditor } from './code-editor'

interface JsonImporterProps {
  /** Receives the JSON Schema inferred from the pasted sample value. */
  onImport: (schema: Record<string, unknown>) => void
}

/**
 * "Import from sample JSON" — paste a concrete result value and infer a schema
 * from it via {@link inferJsonSchema}. Replaces the old SOG `jsonToSchema`
 * importer; the inference policy (no `required`, no `additionalProperties`) now
 * matches the rest of the editor.
 */
export function JsonImporter({ onImport }: JsonImporterProps) {
  const [open, setOpen] = useState(false)
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => setOpen(false), [])

  const handleSubmit = useCallback(() => {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      setError('Invalid JSON')
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('Paste a sample object, not an array or primitive value.')
      return
    }
    const schema = inferJsonSchema(parsed)
    if (checkJsonSchemaDepth(schema) > JSON_SCHEMA_MAX_DEPTH) {
      setError(`Sample nests deeper than the maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
      return
    }
    onImport(schema)
    setError(null)
    setOpen(false)
  }, [json, onImport])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className={cn(open && 'bg-components-button-ghost-bg-hover')}
          onClick={(e: MouseEvent) => e.stopPropagation()}>
          Import
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[400px] p-0' align='end' sideOffset={4} alignOffset={16}>
        <div className='flex flex-col'>
          <div className='relative px-3 pb-1 pt-3.5'>
            <button
              type='button'
              className='absolute bottom-0 right-2.5 flex h-8 w-8 items-center justify-center'
              onClick={close}>
              <X className='h-4 w-4' />
            </button>
            <div className='font-semibold flex pl-1 pr-8 text-primary-500'>Import from sample</div>
          </div>
          <div className='px-4 py-2'>
            <CodeEditor
              className='rounded-lg flex-1 h-[340px]'
              editorWrapperClassName='h-[340px]'
              value={json}
              onUpdate={setJson}
              showFormatButton={false}
            />
            {error && (
              <div className='mt-1 flex gap-x-1 rounded-lg border-[0.5px] p-2'>
                <AlertTriangle className='size-4 shrink-0 text-bad-500' />
                <div className='system-xs-medium grow break-words'>{error}</div>
              </div>
            )}
          </div>
          <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
            <Button variant='ghost' size='sm' onClick={close}>
              Cancel
            </Button>
            <Button variant='outline' size='sm' onClick={handleSubmit}>
              Import
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
