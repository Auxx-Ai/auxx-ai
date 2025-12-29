// apps/web/src/components/workflow/nodes/core/crud/components/default-values-editor.tsx

'use client'

import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { CrudDefaultValue } from '../types'

interface DefaultValuesEditorProps {
  defaultValues: CrudDefaultValue[]
  onChange: (values: CrudDefaultValue[]) => void
}

/**
 * Component for editing default values in CRUD nodes
 * Used when error strategy is set to 'default'
 */
export const DefaultValuesEditor: React.FC<DefaultValuesEditorProps> = ({
  defaultValues,
  onChange,
}) => {
  const addDefaultValue = () => {
    const newValue: CrudDefaultValue = {
      key: '',
      type: 'string',
      value: '',
    }
    onChange([...defaultValues, newValue])
  }

  const updateDefaultValue = (index: number, updates: Partial<CrudDefaultValue>) => {
    const updated = defaultValues.map((value, i) =>
      i === index ? { ...value, ...updates } : value
    )
    onChange(updated)
  }

  const removeDefaultValue = (index: number) => {
    onChange(defaultValues.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {defaultValues.map((defaultValue, index) => (
        <div key={index} className="flex gap-2 items-end">
          <div className="flex-1">
            <Input
              placeholder="Key"
              value={defaultValue.key}
              onChange={(e) => updateDefaultValue(index, { key: e.target.value })}
              className="text-xs"
            />
          </div>

          <div className="w-24">
            <Select
              value={defaultValue.type}
              onValueChange={(value: CrudDefaultValue['type']) =>
                updateDefaultValue(index, { type: value })
              }>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">String</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="boolean">Boolean</SelectItem>
                <SelectItem value="object">Object</SelectItem>
                <SelectItem value="array">Array</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1">
            <Input
              placeholder="Default value"
              value={defaultValue.value}
              onChange={(e) => updateDefaultValue(index, { value: e.target.value })}
              className="text-xs"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeDefaultValue(index)}
            className="px-2">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}

      <Button variant="ghost" size="sm" onClick={addDefaultValue} className="w-full text-xs">
        <Plus className="h-3 w-3 mr-1" />
        Add Default Value
      </Button>
    </div>
  )
}
