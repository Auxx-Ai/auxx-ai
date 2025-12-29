// apps/web/src/components/workflow/nodes/shared/node-inputs/array-input.tsx

import React from 'react'
import { Button } from '@auxx/ui/components/button'
import { InputGroup, InputGroupInput, InputGroupAddon } from '@auxx/ui/components/input-group'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { createNodeInput, type NodeInputProps } from './base-node-input'
import { cn } from '@auxx/ui/lib/utils'

interface ArrayInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Item type */
  itemType?: 'string' | 'number' | 'object'
  /** Placeholder for new items */
  placeholder?: string
  /** Minimum number of items */
  minItems?: number
  /** Maximum number of items */
  maxItems?: number
  /** Render function for complex items */
  renderItem?: (item: any, index: number, onChange: (value: any) => void) => React.ReactNode
}

/**
 * Array input component for managing lists
 */
export const ArrayInput = createNodeInput<ArrayInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    itemType = 'string',
    placeholder = 'Add item',
    minItems = 0,
    maxItems,
    renderItem,
  }) => {
    let items = inputs[name] || []
    if (!Array.isArray(items)) {
      items = []
    }

    const handleAddItem = () => {
      const newItem = itemType === 'object' ? {} : itemType === 'number' ? 0 : ''
      const newItems = [...items, newItem]

      if (maxItems && newItems.length > maxItems) {
        onError(name, `Maximum ${maxItems} items allowed`)
        return
      }

      onError(name, null)
      onChange(name, newItems)
    }

    const handleRemoveItem = (index: number) => {
      const newItems = items.filter((_: any, i: number) => i !== index)

      if (minItems && newItems.length < minItems) {
        onError(name, `Minimum ${minItems} items required`)
        return
      }

      onError(name, null)
      onChange(name, newItems)
    }

    const handleUpdateItem = (index: number, value: any) => {
      const newItems = [...items]
      newItems[index] = value
      onChange(name, newItems)
    }

    // Return just the array input UI without wrappers or error displays
    return (
      <div className={cn('w-full min-h-7', items.length > 0 && 'space-y-2')}>
        <div className="flex items-center justify-between">
          <div className="pt-0.5">
            <Button
              type="button"
              variant="outline"
              className=""
              size="xs"
              onClick={handleAddItem}
              disabled={isLoading || (maxItems !== undefined && items.length >= maxItems)}>
              <Plus />
              Add Item
            </Button>
          </div>
          <span className="text-sm text-muted-foreground pe-1">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className={cn('space-y-2 -ml-6 w-[calc(100%+2.5rem)] pb-1')}>
          {items.map((item: any, index: number) => (
            <div key={index} className="flex items-center">
              <GripVertical className="size-4 text-muted-foreground cursor-move" />

              {renderItem ? (
                <div className="flex-1">
                  {renderItem(item, index, (value) => handleUpdateItem(index, value))}
                </div>
              ) : (
                <InputGroup className="flex-1">
                  <InputGroupInput
                    type={itemType === 'number' ? 'number' : 'text'}
                    value={item}
                    onChange={(e) =>
                      handleUpdateItem(
                        index,
                        itemType === 'number' ? Number(e.target.value) : e.target.value
                      )
                    }
                    placeholder={placeholder}
                    disabled={isLoading}
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="icon-xs"
                      variant="destructive-hover"
                      onClick={() => handleRemoveItem(index)}
                      disabled={isLoading || (minItems !== undefined && items.length <= minItems)}>
                      <Trash2 />
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }
)
