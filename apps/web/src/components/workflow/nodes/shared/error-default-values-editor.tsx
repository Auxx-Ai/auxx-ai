// apps/web/src/components/workflow/nodes/shared/error-default-values-editor.tsx

'use client'

import type { ErrorDefaultValue } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Plus, Trash2 } from 'lucide-react'
import type React from 'react'

interface ErrorDefaultValuesEditorProps {
  defaultValues: ErrorDefaultValue[]
  onChange: (values: ErrorDefaultValue[]) => void
}

/**
 * Editor for the `{ key, type, value }` substitutes applied when a node's
 * failure policy is `default`.
 *
 * Lifted VERBATIM out of `core/crud/components/default-values-editor.tsx` when
 * the `ai` node opted in and needed the same control — it was already generic
 * over the item shape, and crud's file is now a thin typed wrapper over this.
 * Deliberately NOT redesigned: plan 24 owns the defaults editor, and it should
 * find one implementation to replace rather than two copies.
 */
export const ErrorDefaultValuesEditor: React.FC<ErrorDefaultValuesEditorProps> = ({
  defaultValues,
  onChange,
}) => {
  const addDefaultValue = () => {
    onChange([...defaultValues, { key: '', type: 'string', value: '' }])
  }

  const updateDefaultValue = (index: number, updates: Partial<ErrorDefaultValue>) => {
    onChange(defaultValues.map((value, i) => (i === index ? { ...value, ...updates } : value)))
  }

  const removeDefaultValue = (index: number) => {
    onChange(defaultValues.filter((_, i) => i !== index))
  }

  return (
    <div className='space-y-2'>
      {defaultValues.map((defaultValue, index) => (
        <div key={index} className='flex gap-2 items-end'>
          <div className='flex-1'>
            <Input
              placeholder='Key'
              value={defaultValue.key}
              onChange={(e) => updateDefaultValue(index, { key: e.target.value })}
              className='text-xs'
            />
          </div>

          <div className='w-24'>
            <Select
              value={defaultValue.type}
              onValueChange={(value: ErrorDefaultValue['type']) =>
                updateDefaultValue(index, { type: value })
              }>
              <SelectTrigger className='text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='string'>String</SelectItem>
                <SelectItem value='number'>Number</SelectItem>
                <SelectItem value='boolean'>Boolean</SelectItem>
                <SelectItem value='object'>Object</SelectItem>
                <SelectItem value='array'>Array</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className='flex-1'>
            <Input
              placeholder='Default value'
              value={defaultValue.value}
              onChange={(e) => updateDefaultValue(index, { value: e.target.value })}
              className='text-xs'
            />
          </div>

          <Button
            variant='ghost'
            size='sm'
            onClick={() => removeDefaultValue(index)}
            className='px-2'>
            <Trash2 className='h-3 w-3' />
          </Button>
        </div>
      ))}

      <Button variant='ghost' size='sm' onClick={addDefaultValue} className='w-full text-xs'>
        <Plus className='h-3 w-3 mr-1' />
        Add Default Value
      </Button>
    </div>
  )
}
