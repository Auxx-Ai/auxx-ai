// apps/web/src/components/datasets/search/vector-search-options.tsx

'use client'

import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Slider } from '@auxx/ui/components/slider'

interface VectorSearchOptionsProps {
  topK: number
  scoreThreshold: number
  onTopKChange: (value: number) => void
  onThresholdChange: (value: number) => void
  disabled?: boolean
}

/**
 * Configuration options for vector search
 */
export function VectorSearchOptions({
  topK,
  scoreThreshold,
  onTopKChange,
  onThresholdChange,
  disabled,
}: VectorSearchOptionsProps) {
  return (
    <div className='space-y-4'>
      {/* Top K Results */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='topk' className='text-sm'>
            Top K Results
          </Label>
          <Input
            id='topk'
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
      </div>

      {/* Score Threshold */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='threshold' className='text-sm'>
            Score Threshold
          </Label>
          <span className='text-sm font-medium'>{(scoreThreshold * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[scoreThreshold * 100]}
          onValueChange={([value]) => onThresholdChange(value / 100)}
          min={0}
          max={100}
          step={5}
          className='w-full'
          disabled={disabled}
        />
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        <p className='text-xs text-muted-foreground'>
          Only return results with similarity score above this threshold
        </p>
      </div>
    </div>
  )
}
