// apps/web/src/components/datasets/search/advanced-search-options.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { Separator } from '@auxx/ui/components/separator'
import { ChevronDown, ChevronRight, ChevronUp, RotateCcw, Settings2 } from 'lucide-react'
import { HybridSearchOptions } from './hybrid-search-options'
import { SearchMethodSelector, type SearchType } from './search-method-selector'
import { TextSearchOptions } from './text-search-options'
import { VectorSearchOptions } from './vector-search-options'

export interface SearchConfiguration {
  searchType: SearchType
  topK: number
  scoreThreshold: number
  semanticWeight: number // 0-100 percentage
}

interface AdvancedSearchOptionsProps {
  config: SearchConfiguration
  onConfigChange: (config: Partial<SearchConfiguration>) => void
  isOpen: boolean
  onToggle: () => void
  disabled?: boolean
}

// Default configurations for each search type
const DEFAULT_CONFIGS: Record<SearchType, Partial<SearchConfiguration>> = {
  vector: {
    topK: 10,
    scoreThreshold: 0.3,
  },
  text: {
    topK: 10,
  },
  hybrid: {
    topK: 10,
    scoreThreshold: 0.3,
    semanticWeight: 60,
  },
}

/**
 * Container component for advanced search configuration options
 */
export function AdvancedSearchOptions({
  config,
  onConfigChange,
  isOpen,
  onToggle,
  disabled,
}: AdvancedSearchOptionsProps) {
  const handleSearchTypeChange = (searchType: SearchType) => {
    // When switching search types, apply default values for that type
    onConfigChange({
      searchType,
      ...DEFAULT_CONFIGS[searchType],
    })
  }

  const handleResetToDefaults = () => {
    onConfigChange({
      ...DEFAULT_CONFIGS[config.searchType],
    })
  }

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-between hover:bg-muted/50'
          disabled={disabled}>
          <span className='flex items-center gap-2'>
            <Settings2 className='size-4' />
            Advanced Search Options
          </span>
          {isOpen ? <ChevronDown /> : <ChevronRight />}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className='space-y-4 pt-4'>
        {/* Search Method Selection */}
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h4 className='text-sm font-medium'>Retrieval Method</h4>
            <Button
              variant='ghost'
              size='xs'
              onClick={handleResetToDefaults}
              disabled={disabled}
              className='h-6 text-xs'>
              <RotateCcw className='size-3 mr-1' />
              Reset
            </Button>
          </div>
          <SearchMethodSelector
            value={config.searchType}
            onChange={handleSearchTypeChange}
            disabled={disabled}
          />
        </div>

        <Separator />

        {/* Dynamic Options Based on Search Type */}
        <div className='space-y-3'>
          <h4 className='text-sm font-medium'>Configuration</h4>

          {config.searchType === 'vector' && (
            <VectorSearchOptions
              topK={config.topK}
              scoreThreshold={config.scoreThreshold}
              onTopKChange={(topK) => onConfigChange({ topK })}
              onThresholdChange={(scoreThreshold) => onConfigChange({ scoreThreshold })}
              disabled={disabled}
            />
          )}

          {config.searchType === 'text' && (
            <TextSearchOptions
              topK={config.topK}
              onTopKChange={(topK) => onConfigChange({ topK })}
              disabled={disabled}
            />
          )}

          {config.searchType === 'hybrid' && (
            <HybridSearchOptions
              semanticWeight={config.semanticWeight}
              topK={config.topK}
              scoreThreshold={config.scoreThreshold}
              onSemanticWeightChange={(semanticWeight) => onConfigChange({ semanticWeight })}
              onTopKChange={(topK) => onConfigChange({ topK })}
              onThresholdChange={(scoreThreshold) => onConfigChange({ scoreThreshold })}
              disabled={disabled}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
