// apps/web/src/components/datasets/search/hybrid-search-options.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Slider } from '@auxx/ui/components/slider'

interface HybridSearchOptionsProps {
  semanticWeight: number // 0-100 percentage
  topK: number
  scoreThreshold: number
  onSemanticWeightChange: (value: number) => void
  onTopKChange: (value: number) => void
  onThresholdChange: (value: number) => void
  disabled?: boolean
}

/**
 * Configuration options for hybrid search
 */
export function HybridSearchOptions({
  semanticWeight,
  topK,
  scoreThreshold,
  onSemanticWeightChange,
  onTopKChange,
  onThresholdChange,
  disabled,
}: HybridSearchOptionsProps) {
  const keywordWeight = 100 - semanticWeight

  return (
    <div className='space-y-4'>
      {/* Semantic/Keyword Balance */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='balance' className='text-sm'>
            Search Balance
          </Label>
          <div className='flex items-center gap-2'>
            <Badge variant='secondary' className='text-xs'>
              {semanticWeight}% Semantic
            </Badge>
            <Badge variant='outline' className='text-xs'>
              {keywordWeight}% Keyword
            </Badge>
          </div>
        </div>
        <Slider
          value={[semanticWeight]}
          onValueChange={([value]) => onSemanticWeightChange(value)}
          min={0}
          max={100}
          step={5}
          className='w-full'
          disabled={disabled}
        />
        <div className='flex justify-between text-xs text-muted-foreground'>
          <span>← Keyword</span>
          <span>Balanced</span>
          <span>Semantic →</span>
        </div>
        <p className='text-xs text-muted-foreground'>
          Adjust the balance between semantic similarity and keyword matching
        </p>
      </div>

      {/* Top K Results */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='topk-hybrid' className='text-sm'>
            Top K Results
          </Label>
          <Input
            id='topk-hybrid'
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
      </div>

      {/* Score Threshold */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='threshold-hybrid' className='text-sm'>
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
        <p className='text-xs text-muted-foreground'>Minimum combined score for results</p>
      </div>

      {/* Balance Presets */}
      <div className='space-y-2'>
        <Label className='text-xs text-muted-foreground'>Quick Presets</Label>
        <div className='flex gap-2'>
          <button
            onClick={() => onSemanticWeightChange(0)}
            disabled={disabled}
            className='text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50'>
            Keyword Only
          </button>
          <button
            onClick={() => onSemanticWeightChange(50)}
            disabled={disabled}
            className='text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50'>
            Balanced
          </button>
          <button
            onClick={() => onSemanticWeightChange(70)}
            disabled={disabled}
            className='text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50'>
            Semantic Focus
          </button>
          <button
            onClick={() => onSemanticWeightChange(100)}
            disabled={disabled}
            className='text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-50'>
            Semantic Only
          </button>
        </div>
      </div>
    </div>
  )
}
