// apps/web/src/components/datasets/settings/sections/search-configuration-section.tsx
'use client'
import type { DatasetEntity as Dataset } from '@auxx/database/types'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { FileText, Lightbulb, Search, Sparkles, Zap } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

interface SearchConfigurationSectionProps {
  dataset: Dataset
  onUpdate?: (dataset: Dataset) => void
  readOnly?: boolean
}
// Search configuration validation schemas
const vectorSearchSchema = z.object({
  searchType: z.literal('vector'),
  similarityThreshold: z.number().min(0).max(1).optional(),
  maxResults: z.number().min(1).max(100).optional(),
  includeMetadata: z.boolean().optional(),
  rerank: z.boolean().optional(),
  searchMode: z.enum(['similarity', 'mmr', 'similarity_score_threshold']).optional(),
  scoreCutoff: z.number().min(0).max(1).optional(),
})
const textSearchSchema = z.object({
  searchType: z.literal('text'),
  fuzzySearch: z.boolean().optional(),
  phraseSearch: z.boolean().optional(),
  booleanMode: z.boolean().optional(),
  rankingMode: z.enum(['bm25', 'tfidf']).optional(),
  minScore: z.number().min(0).max(1).optional(),
})
const hybridSearchSchema = z.object({
  searchType: z.literal('hybrid'),
  vectorWeight: z.number().min(0).max(1).optional(),
  textWeight: z.number().min(0).max(1).optional(),
  combineMethod: z.enum(['rrf', 'weighted_sum', 'linear_combination']).optional(),
  vectorOptions: z
    .object({
      similarityThreshold: z.number().min(0).max(1).optional(),
      maxResults: z.number().min(1).max(100).optional(),
    })
    .optional(),
  textOptions: z
    .object({
      fuzzySearch: z.boolean().optional(),
      rankingMode: z.enum(['bm25', 'tfidf']).optional(),
    })
    .optional(),
})
const searchConfigSchema = z.discriminatedUnion('searchType', [
  vectorSearchSchema,
  textSearchSchema,
  hybridSearchSchema,
])
type SearchConfigForm = z.infer<typeof searchConfigSchema>
const SEARCH_TYPE_INFO = {
  vector: {
    icon: Zap,
    label: 'Vector Search',
    description:
      'Semantic similarity search using embeddings. Best for finding conceptually related content.',
    badge: 'Semantic',
  },
  text: {
    icon: FileText,
    label: 'Full-Text Search',
    description: 'Keyword-based search using PostgreSQL. Best for exact keyword matches.',
    badge: 'Keywords',
  },
  hybrid: {
    icon: Sparkles,
    label: 'Hybrid Search',
    description: 'Combines vector and text search for best of both worlds.',
    badge: 'Recommended',
  },
}
export function SearchConfigurationSection({
  dataset,
  onUpdate,
  readOnly = false,
}: SearchConfigurationSectionProps) {
  const [testQuery, setTestQuery] = useState('')
  const [isTestingConfig, setIsTestingConfig] = useState(false)
  // Parse current search config from dataset
  const currentSearchConfig = (dataset.searchConfig as any) || { searchType: 'hybrid' }
  const form = useForm<SearchConfigForm>({
    resolver: standardSchemaResolver(searchConfigSchema),
    defaultValues: currentSearchConfig,
  })
  const selectedSearchType = form.watch('searchType')
  // API mutations
  const updateDataset = api.dataset.update.useMutation({
    onSuccess: (updatedDataset) => {
      toastSuccess({
        title: 'Search configuration updated',
        description: 'Changes have been saved successfully',
      })
      onUpdate?.(updatedDataset)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update search configuration',
        description: error.message,
      })
    },
  })
  const testSearchConfig = api.dataset.testSearchConfig.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toastSuccess({
          title: 'Configuration test successful',
          description: `Found ${result.metrics?.totalResults} results in ${result.metrics?.responseTime}ms`,
        })
      } else {
        toastError({
          title: 'Configuration test failed',
          description: result.error || 'Unknown error occurred',
        })
      }
    },
    onError: (error) => {
      toastError({
        title: 'Test failed',
        description: error.message,
      })
    },
  })
  const getRecommendedConfig = api.dataset.getRecommendedSearchConfig.useQuery(
    { datasetId: dataset.id },
    { enabled: false }
  )
  const onSubmit = (data: SearchConfigForm) => {
    if (readOnly) return
    updateDataset.mutate({
      id: dataset.id,
      data: {
        searchConfig: data,
      },
    })
  }
  const handleTestConfiguration = () => {
    if (!testQuery.trim()) {
      toastError({
        title: 'Test query required',
        description: 'Please enter a test query to validate the configuration',
      })
      return
    }
    setIsTestingConfig(true)
    testSearchConfig.mutate(
      {
        datasetId: dataset.id,
        testQuery: testQuery.trim(),
        searchConfig: form.getValues(),
      },
      {
        onSettled: () => setIsTestingConfig(false),
      }
    )
  }
  const handleApplyRecommendations = async () => {
    try {
      const recommendations = await getRecommendedConfig.refetch()
      if (recommendations.data) {
        form.reset(recommendations.data as SearchConfigForm)
        toastSuccess({
          title: 'Recommendations applied',
          description: 'Configuration updated based on your dataset characteristics',
        })
      }
    } catch (error) {
      toastError({
        title: 'Failed to get recommendations',
        description: 'Could not retrieve configuration recommendations',
      })
    }
  }
  /** Renders search type specific options using VarEditorField layout */
  const renderSearchTypeOptions = () => {
    switch (selectedSearchType) {
      case 'vector':
        return (
          <VarEditorField className='p-0 [&_[data-slot=field-row-label]]:w-50'>
            <VarEditorFieldRow
              title='Similarity Threshold'
              description='Minimum similarity score (0.0 - 1.0)'
              type={BaseType.NUMBER}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('similarityThreshold') ?? ''}
                onChange={(_, val) => form.setValue('similarityThreshold', val)}
                varType={BaseType.NUMBER}
                placeholder='0.7'
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Maximum Results'
              description='Maximum number of results to return'
              type={BaseType.NUMBER}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('maxResults') ?? ''}
                onChange={(_, val) => form.setValue('maxResults', val)}
                varType={BaseType.NUMBER}
                placeholder='20'
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Include Metadata'
              description='Include document metadata in results'
              type={BaseType.BOOLEAN}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('includeMetadata') ?? false}
                onChange={(_, val) => form.setValue('includeMetadata', val)}
                varType={BaseType.BOOLEAN}
                fieldOptions={{ variant: 'switch' }}
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Search Mode'
              description='Algorithm for selecting and ranking results'
              type={BaseType.ENUM}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('searchMode') ?? ''}
                onChange={(_, val) => form.setValue('searchMode', val)}
                varType={BaseType.ENUM}
                fieldOptions={{
                  enum: [
                    { label: 'Similarity', value: 'similarity' },
                    { label: 'MMR (Max Marginal Relevance)', value: 'mmr' },
                    { label: 'Score Threshold', value: 'similarity_score_threshold' },
                  ],
                }}
                placeholder='Select search mode'
                disabled={readOnly}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        )
      case 'text':
        return (
          <VarEditorField className='p-0 [&_[data-slot=field-row-label]]:w-50'>
            <VarEditorFieldRow
              title='Fuzzy Search'
              description='Enable fuzzy matching for typos and variations'
              type={BaseType.BOOLEAN}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('fuzzySearch') ?? false}
                onChange={(_, val) => form.setValue('fuzzySearch', val)}
                varType={BaseType.BOOLEAN}
                fieldOptions={{ variant: 'switch' }}
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Phrase Search'
              description='Enable exact phrase matching with quotes'
              type={BaseType.BOOLEAN}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('phraseSearch') ?? false}
                onChange={(_, val) => form.setValue('phraseSearch', val)}
                varType={BaseType.BOOLEAN}
                fieldOptions={{ variant: 'switch' }}
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Boolean Mode'
              description='Support AND, OR, NOT operators in queries'
              type={BaseType.BOOLEAN}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('booleanMode') ?? false}
                onChange={(_, val) => form.setValue('booleanMode', val)}
                varType={BaseType.BOOLEAN}
                fieldOptions={{ variant: 'switch' }}
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Ranking Algorithm'
              description='Algorithm for scoring and ranking text matches'
              type={BaseType.ENUM}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('rankingMode') ?? ''}
                onChange={(_, val) => form.setValue('rankingMode', val)}
                varType={BaseType.ENUM}
                fieldOptions={{
                  enum: [
                    { label: 'BM25 (Best Match)', value: 'bm25' },
                    { label: 'TF-IDF', value: 'tfidf' },
                  ],
                }}
                placeholder='Select ranking algorithm'
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Minimum Score'
              description='Minimum relevance score to include results'
              type={BaseType.NUMBER}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('minScore') ?? ''}
                onChange={(_, val) => form.setValue('minScore', val)}
                varType={BaseType.NUMBER}
                placeholder='0.1'
                disabled={readOnly}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        )
      case 'hybrid':
        return (
          <VarEditorField className='p-0 [&_[data-slot=field-row-label]]:w-50'>
            <VarEditorFieldRow
              title='Vector Weight'
              description='Weight for vector search results (0.0 - 1.0)'
              type={BaseType.NUMBER}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('vectorWeight') ?? ''}
                onChange={(_, val) => form.setValue('vectorWeight', val)}
                varType={BaseType.NUMBER}
                placeholder='0.6'
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Text Weight'
              description='Weight for text search results (0.0 - 1.0)'
              type={BaseType.NUMBER}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('textWeight') ?? ''}
                onChange={(_, val) => form.setValue('textWeight', val)}
                varType={BaseType.NUMBER}
                placeholder='0.4'
                disabled={readOnly}
              />
            </VarEditorFieldRow>

            <VarEditorFieldRow
              title='Combination Method'
              description='Method for combining vector and text results'
              type={BaseType.ENUM}
              showIcon={true}>
              <ConstantInputAdapter
                value={form.watch('combineMethod') ?? ''}
                onChange={(_, val) => form.setValue('combineMethod', val)}
                varType={BaseType.ENUM}
                fieldOptions={{
                  enum: [
                    { label: 'Weighted Sum', value: 'weighted_sum' },
                    { label: 'Reciprocal Rank Fusion', value: 'rrf' },
                    { label: 'Linear Combination', value: 'linear_combination' },
                  ],
                }}
                placeholder='Select combination method'
                disabled={readOnly}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        )
      default:
        return null
    }
  }
  const currentTypeInfo = SEARCH_TYPE_INFO[selectedSearchType]
  const CurrentIcon = currentTypeInfo?.icon || Search
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Two Column Layout */}
        <div className='flex flex-col lg:flex-row'>
          {/* Left Column - Search Type Selection */}
          <div className='lg:max-w-[400px] p-6 lg:pr-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <Search className='size-4' /> Search Type
              </div>
              <p className='text-sm text-muted-foreground'>
                Choose how your dataset will be searched.
              </p>
            </div>

            <FormField
              control={form.control}
              name='searchType'
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={readOnly || updateDataset.isPending}>
                      {Object.entries(SEARCH_TYPE_INFO).map(([type, info]) => {
                        const Icon = info.icon
                        return (
                          <RadioGroupItemCard
                            key={type}
                            label={info.label}
                            sublabel={info.badge}
                            value={type}
                            icon={<Icon />}
                            description={info.description}
                          />
                        )
                      })}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Right Column - Search Type Specific Options */}
          <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <CurrentIcon className='size-4' /> {currentTypeInfo?.label} Options
              </div>
              <p className='text-sm text-muted-foreground'>
                Configure settings specific to {currentTypeInfo?.label?.toLowerCase()}.
              </p>
            </div>
            {renderSearchTypeOptions()}
          </div>
        </div>

        {/* Action Buttons */}
        <div className='flex items-center justify-between border-t px-4 py-4'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={handleApplyRecommendations}
            loading={getRecommendedConfig.isFetching}
            loadingText='Getting recommendations...'>
            <Lightbulb />
            Apply Recommendations
          </Button>

          <div className='flex gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => form.reset(currentSearchConfig)}
              disabled={readOnly}>
              Reset
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              loading={updateDataset.isPending}
              loadingText='Saving...'
              disabled={readOnly}>
              Save Configuration
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
