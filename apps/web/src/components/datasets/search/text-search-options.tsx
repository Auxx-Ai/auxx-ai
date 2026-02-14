// apps/web/src/components/datasets/search/text-search-options.tsx

'use client'

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Slider } from '@auxx/ui/components/slider'

interface TextSearchOptionsProps {
  topK: number
  onTopKChange: (value: number) => void
  disabled?: boolean
}

/**
 * Configuration options for full-text search
 */
export function TextSearchOptions({ topK, onTopKChange, disabled }: TextSearchOptionsProps) {
  return (
    <div className='space-y-4'>
      {/* Top K Results */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='topk-text' className='text-sm'>
            Top K Results
          </Label>
          <Input
            id='topk-text'
            type='number'
            value={topK}
            onChange={(e) => {
              const value = Math.max(1, Math.min(50, parseInt(e.target.value) || 1))
              onTopKChange(value)
            }}
            className='w-16 h-7 text-xs text-center'
            min={1}
            max={50}
            disabled={disabled}
          />
        </div>
        <Slider
          value={[topK]}
          onValueChange={([value]) => onTopKChange(value)}
          min={1}
          max={50}
          step={1}
          className='w-full'
          disabled={disabled}
        />
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>1</span>
          <span>25</span>
          <span>50</span>
        </div>
        <p className='text-xs text-muted-foreground'>
          Maximum number of results to return from keyword matching
        </p>
      </div>

      {/* Info about text search */}
      <div className='rounded-xl bg-primary-100 p-3'>
        <p className='text-xs text-muted-foreground'>
          Full-text search uses PostgreSQL's text search capabilities to find documents containing
          your keywords. Results are ranked by relevance based on term frequency and document
          structure.
        </p>
      </div>
    </div>
  )
}
