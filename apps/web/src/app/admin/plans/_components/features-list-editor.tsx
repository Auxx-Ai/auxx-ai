// apps/web/src/app/admin/plans/_components/features-list-editor.tsx
/**
 * Component for editing list of plan features
 */
'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Plus, X } from 'lucide-react'

/**
 * Features list editor props
 */
interface FeaturesListEditorProps {
  features: string[]
  onChange: (features: string[]) => void
}

/**
 * Component for editing list of plan features
 */
export function FeaturesListEditor({ features, onChange }: FeaturesListEditorProps) {
  const [newFeature, setNewFeature] = useState('')

  /**
   * Add new feature to the list
   */
  const addFeature = () => {
    if (newFeature.trim()) {
      onChange([...features, newFeature.trim()])
      setNewFeature('')
    }
  }

  /**
   * Remove feature from the list
   */
  const removeFeature = (index: number) => {
    onChange(features.filter((_, i) => i !== index))
  }

  /**
   * Handle Enter key press
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addFeature()
    }
  }

  return (
    <div className="space-y-3">
      {/* Existing features */}
      {features.length > 0 && (
        <ul className="space-y-2">
          {features.map((feature, index) => (
            <li
              key={index}
              className="flex items-center gap-2 p-2 bg-muted rounded-md group hover:bg-muted/80">
              <span className="flex-1 text-sm">{feature}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFeature(index)}
                className="opacity-0 group-hover:opacity-100 transition-opacity">
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Add new feature */}
      <div className="flex items-center gap-2">
        <Input
          value={newFeature}
          onChange={(e) => setNewFeature(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a feature..."
        />
        <Button type="button" onClick={addFeature} size="sm">
          <Plus />
          Add
        </Button>
      </div>
    </div>
  )
}
