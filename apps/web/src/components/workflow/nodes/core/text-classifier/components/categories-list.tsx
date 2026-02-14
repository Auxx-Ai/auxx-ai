// apps/web/src/components/workflow/nodes/core/text-classifier/components/categories-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ListPlus } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import Section from '~/components/workflow/ui/section'
import { MAX_CATEGORIES } from '../constants'
import { useTextClassifierContext } from '../text-classifier-context'
import { CategoryItem } from './category-item'

/**
 * Categories list component that manages all categories
 */
export const CategoriesList: React.FC = () => {
  const {
    config,
    nodeId,
    // availableVariables,
    isReadOnly,
    addCategory,
    updateCategory,
    deleteCategory,
  } = useTextClassifierContext()

  const [isOpen, setIsOpen] = useState(true)

  const handleAdd = () => {
    // Open section if it's closed
    if (!isOpen) setIsOpen(true)
    // Add the category
    addCategory()
  }

  return (
    <Section
      title='Categories'
      description='Define the categories for classification.'
      isRequired
      open={isOpen}
      onOpenChange={setIsOpen}
      actions={
        config.categories.length < MAX_CATEGORIES &&
        !isReadOnly && (
          <Button variant='ghost' size='xs' onClick={handleAdd}>
            <ListPlus />
            Add
          </Button>
        )
      }>
      <div className='space-y-3'>
        {/* Category items */}
        {config.categories.length > 0 && (
          <div className='space-y-2'>
            {config.categories.map((category) => (
              <CategoryItem
                key={category.id}
                category={category}
                onUpdate={(updates) => updateCategory(category.id, updates)}
                onDelete={() => deleteCategory(category.id)}
                isReadOnly={isReadOnly}
                nodeId={nodeId}
                // availableVariables={availableVariables}
              />
            ))}
          </div>
        )}

        {/* Helper text */}
        {config.categories.length === 0 && (
          <p className='text-sm text-muted-foreground text-center py-4'>
            Add at least one category to classify text
          </p>
        )}
      </div>
    </Section>
  )
}
