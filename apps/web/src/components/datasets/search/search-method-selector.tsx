// apps/web/src/components/datasets/search/search-method-selector.tsx

'use client'

import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Label } from '@auxx/ui/components/label'
import { Search, FileText, Layers } from 'lucide-react'

export type SearchType = 'vector' | 'text' | 'hybrid'

interface SearchMethodSelectorProps {
  value: SearchType
  onChange: (value: SearchType) => void
  disabled?: boolean
}

/**
 * Component for selecting the search method (vector, text, or hybrid)
 */
export function SearchMethodSelector({ value, onChange, disabled }: SearchMethodSelectorProps) {
  return (
    <RadioGroup value={value} onValueChange={onChange} disabled={disabled}>
      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-start space-x-2">
          <RadioGroupItem value="vector" id="vector" className="mt-1" />
          <Label htmlFor="vector" className="flex flex-col cursor-pointer">
            <span className="flex items-center gap-2 font-medium">
              <Search className="size-3" />
              Vector Search
            </span>
            <span className="text-xs text-muted-foreground">
              Semantic similarity using embeddings
            </span>
          </Label>
        </div>

        <div className="flex items-start space-x-2">
          <RadioGroupItem value="text" id="text" className="mt-1" />
          <Label htmlFor="text" className="flex flex-col cursor-pointer">
            <span className="flex items-center gap-2 font-medium">
              <FileText className="size-3" />
              Full-text Search
            </span>
            <span className="text-xs text-muted-foreground">Keyword matching with ranking</span>
          </Label>
        </div>

        <div className="flex items-start space-x-2">
          <RadioGroupItem value="hybrid" id="hybrid" className="mt-1" />
          <Label htmlFor="hybrid" className="flex flex-col cursor-pointer">
            <span className="flex items-center gap-2 font-medium">
              <Layers className="size-3" />
              Hybrid Search
            </span>
            <span className="text-xs text-muted-foreground">
              Combines semantic and keyword search
            </span>
          </Label>
        </div>
      </div>
    </RadioGroup>
  )
}
