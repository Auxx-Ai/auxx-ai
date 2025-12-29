// apps/web/src/components/workflow/nodes/core/text-classifier/components/category-item.tsx

'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Trash2 } from 'lucide-react'
import { type Category } from '../types'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'

/**
 * Props for CategoryItem component
 */
interface CategoryItemProps {
  category: Category
  onUpdate: (updates: Partial<Category>) => void
  onDelete: () => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Individual category item component with name and description editor
 */
export const CategoryItem: React.FC<CategoryItemProps> = ({
  category,
  onUpdate,
  onDelete,
  isReadOnly,
  nodeId,
}) => {
  // const { preprocessPrompt } = useTextClassifierContext()
  const [localName, setLocalName] = useState(category.name)

  // Sync local state when category name changes from outside
  useEffect(() => {
    setLocalName(category.name)
  }, [category.name])

  // Handle name change - no callback needed
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalName(e.target.value)
  }

  // Handle name blur - only update if value changed
  const handleNameBlur = () => {
    if (localName !== category.name) {
      onUpdate({ name: localName })
    }
  }

  // Handle description change from editor - no callback needed
  const handleDescriptionChange = (value: string) => {
    onUpdate({ description: value })
  }

  return (
    <div className="space-y-2">
      <InputGroup>
        <InputGroupInput
          variant="transparent"
          size="sm"
          value={localName}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          placeholder="Category name"
          className="flex-1 font-medium"
          disabled={isReadOnly}
        />
        <InputGroupAddon align="inline-end">
          <Button
            variant="destructive-hover"
            size="icon-xs"
            onClick={onDelete}
            disabled={isReadOnly}>
            <Trash2 />
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <Editor
        title={<h3 className="text-sm font-medium">{category.name}</h3>}
        value={category.description || ''}
        onChange={handleDescriptionChange}
        placeholder="Describe this category..."
        nodeId={nodeId}
        readOnly={isReadOnly}
        minHeight={60}
      />
    </div>
  )
}
