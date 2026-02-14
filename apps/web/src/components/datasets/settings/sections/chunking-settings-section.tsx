// apps/web/src/components/datasets/settings/sections/chunking-settings-section.tsx
'use client'
import type { DatasetEntity as Dataset } from '@auxx/database/models'
import type { ChunkSettings } from '@auxx/database/types'
import { BaseType } from '@auxx/lib/workflow-engine/types'
import { Button } from '@auxx/ui/components/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Book, Brain, FileText, Layers, Scissors } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

interface ChunkingSettingsSectionProps {
  dataset: Dataset
  onUpdate?: (dataset: Dataset) => void
  readOnly?: boolean
}

/** Preprocessing options schema */
const preprocessingSchema = z.object({
  normalizeWhitespace: z.boolean(),
  removeUrlsAndEmails: z.boolean(),
})

/** Chunk settings form schema */
const chunkingSettingsSchema = z.object({
  strategy: z.enum(['FIXED_SIZE', 'SEMANTIC', 'SENTENCE', 'PARAGRAPH', 'DOCUMENT'] as const),
  size: z
    .number()
    .min(100, 'Chunk size must be at least 100')
    .max(5000, 'Chunk size cannot exceed 5000'),
  overlap: z.number().min(0, 'Overlap cannot be negative').max(1000, 'Overlap cannot exceed 1000'),
  delimiter: z.string().max(50).nullable().optional(),
  preprocessing: preprocessingSchema,
})

type ChunkingSettingsForm = z.infer<typeof chunkingSettingsSchema>
const CHUNKING_STRATEGIES = {
  FIXED_SIZE: {
    icon: Scissors,
    label: 'Fixed Size',
    description: 'Split text into chunks of fixed character length with overlap',
    badge: 'Default',
    pros: ['Consistent chunk sizes', 'Fast processing', 'Predictable behavior'],
    cons: ['May split sentences/paragraphs', 'Context boundaries ignored'],
  },
  SEMANTIC: {
    icon: Brain,
    label: 'Semantic',
    description: 'Use AI to identify semantic boundaries for more meaningful chunks',
    badge: 'AI-Powered',
    pros: ['Preserves semantic meaning', 'Natural boundaries', 'Better context'],
    cons: ['Slower processing', 'Variable chunk sizes', 'Requires AI model'],
  },
  SENTENCE: {
    icon: FileText,
    label: 'Sentence',
    description: 'Split text at sentence boundaries while respecting size limits',
    badge: 'Natural',
    pros: ['Complete sentences', 'Natural boundaries', 'Good readability'],
    cons: ['Variable chunk sizes', 'Language dependent'],
  },
  PARAGRAPH: {
    icon: Book,
    label: 'Paragraph',
    description: 'Split text at paragraph boundaries, combining paragraphs to reach size limits',
    badge: 'Structured',
    pros: ['Logical structure', 'Complete thoughts', 'Topic coherence'],
    cons: ['Very variable sizes', 'May create large chunks'],
  },
  DOCUMENT: {
    icon: FileText,
    label: 'Document',
    description: 'Keep entire documents as single chunks (for small documents)',
    badge: 'Whole',
    pros: ['Complete context', 'No fragmentation', 'Simple approach'],
    cons: ['May exceed size limits', 'Poor for large documents'],
  },
}
export function ChunkingSettingsSection({
  dataset,
  onUpdate,
  readOnly = false,
}: ChunkingSettingsSectionProps) {
  // Cast chunkSettings to ChunkSettings type
  const chunkSettings = dataset.chunkSettings as ChunkSettings | undefined

  const form = useForm<ChunkingSettingsForm>({
    resolver: standardSchemaResolver(chunkingSettingsSchema),
    defaultValues: {
      strategy: chunkSettings?.strategy ?? 'FIXED_SIZE',
      size: chunkSettings?.size ?? 1000,
      overlap: chunkSettings?.overlap ?? 200,
      delimiter: chunkSettings?.delimiter ?? '\n\n',
      preprocessing: {
        normalizeWhitespace: chunkSettings?.preprocessing?.normalizeWhitespace ?? true,
        removeUrlsAndEmails: chunkSettings?.preprocessing?.removeUrlsAndEmails ?? false,
      },
    },
  })

  const selectedStrategy = form.watch('strategy')
  const size = form.watch('size')
  const overlap = form.watch('overlap')

  const updateDataset = api.dataset.update.useMutation({
    onSuccess: (updatedDataset) => {
      onUpdate?.(updatedDataset)
    },
    onError: (error) => {
      toastError({ title: 'Failed to update chunking settings', description: error.message })
    },
  })

  const onSubmit = (data: ChunkingSettingsForm) => {
    if (readOnly) return
    updateDataset.mutate({
      id: dataset.id,
      data: {
        chunkSettings: {
          strategy: data.strategy,
          size: data.size,
          overlap: data.overlap,
          delimiter: data.delimiter || null,
          preprocessing: data.preprocessing,
        },
      },
    })
  }

  // Calculate estimated chunks per document
  const estimateChunksPerDocument = () => {
    if (!dataset.documentCount || dataset.documentCount === 0) return 'N/A'
    const avgDocSize = Number(dataset.totalSize) / dataset.documentCount
    const effectiveChunkSize = size - overlap
    const estimatedChunks = Math.ceil(avgDocSize / effectiveChunkSize)
    return estimatedChunks.toLocaleString()
  }

  const strategyInfo = CHUNKING_STRATEGIES[selectedStrategy]
  const StrategyIcon = strategyInfo?.icon || Layers
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Two Column Layout */}
        <div className='flex flex-col lg:flex-row'>
          {/* Left Column - Strategy Selection */}
          <div className='flex-1 p-6 lg:pr-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <Layers className='size-4' /> Chunking Strategy
              </div>
              <p className='text-sm text-muted-foreground'>
                Choose how your documents will be split into chunks.
              </p>
            </div>

            <FormField
              control={form.control}
              name='strategy'
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={readOnly || updateDataset.isPending}>
                      {Object.entries(CHUNKING_STRATEGIES).map(([strategy, info]) => {
                        const Icon = info.icon
                        const isImplemented = strategy === 'FIXED_SIZE'
                        return (
                          <RadioGroupItemCard
                            key={strategy}
                            label={info.label}
                            sublabel={isImplemented ? info.badge : 'Coming Soon'}
                            value={strategy}
                            icon={<Icon />}
                            description={info.description}
                            disabled={!isImplemented || readOnly || updateDataset.isPending}
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

          {/* Right Column - Strategy Specific Options */}
          <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <StrategyIcon className='size-4' /> {strategyInfo?.label} Parameters
              </div>
              <p className='text-sm text-muted-foreground'>
                Configure chunk size and overlap settings.
              </p>
            </div>

            <VarEditorField className='p-0 [&_[data-slot=field-row-label]]:w-60'>
              <VarEditorFieldRow
                title='Chunk Size'
                description='Target size for each chunk in characters (100-5000)'
                type={BaseType.NUMBER}
                showIcon={true}>
                <ConstantInputAdapter
                  value={form.watch('size') ?? ''}
                  onChange={(_, val) => form.setValue('size', val)}
                  varType={BaseType.NUMBER}
                  placeholder='1000'
                  disabled={readOnly}
                />
              </VarEditorFieldRow>

              <VarEditorFieldRow
                title='Chunk Overlap'
                description='Overlapping characters between adjacent chunks (0-1000)'
                type={BaseType.NUMBER}
                showIcon={true}>
                <ConstantInputAdapter
                  value={form.watch('overlap') ?? ''}
                  onChange={(_, val) => form.setValue('overlap', val)}
                  varType={BaseType.NUMBER}
                  placeholder='200'
                  disabled={readOnly}
                />
              </VarEditorFieldRow>

              <VarEditorFieldRow
                title='Custom Delimiter'
                description='Split text at this delimiter. Default is double newline (paragraph breaks).'
                type={BaseType.STRING}
                showIcon={true}>
                <ConstantInputAdapter
                  value={form.watch('delimiter') ?? ''}
                  onChange={(_, val) => form.setValue('delimiter', val || '\n\n')}
                  varType={BaseType.STRING}
                  placeholder='\n\n'
                  disabled={readOnly}
                />
              </VarEditorFieldRow>

              <VarEditorFieldRow
                title='Normalize Whitespace'
                description='Replace consecutive spaces, newlines, and tabs with single characters'
                type={BaseType.BOOLEAN}
                showIcon={true}>
                <ConstantInputAdapter
                  value={form.watch('preprocessing.normalizeWhitespace')}
                  onChange={(_, val) => form.setValue('preprocessing.normalizeWhitespace', val)}
                  varType={BaseType.BOOLEAN}
                  fieldOptions={{ variant: 'switch' }}
                  disabled={readOnly}
                />
              </VarEditorFieldRow>

              <VarEditorFieldRow
                title='Remove URLs & Emails'
                description='Delete all URLs and email addresses from content before chunking'
                type={BaseType.BOOLEAN}
                showIcon={true}>
                <ConstantInputAdapter
                  value={form.watch('preprocessing.removeUrlsAndEmails')}
                  onChange={(_, val) => form.setValue('preprocessing.removeUrlsAndEmails', val)}
                  varType={BaseType.BOOLEAN}
                  fieldOptions={{ variant: 'switch' }}
                  disabled={readOnly}
                />
              </VarEditorFieldRow>
            </VarEditorField>

            <div className='space-y-4 mt-4'>
              {/* Overlap validation warning */}
              {overlap >= size * 0.5 && (
                <div className='p-3 rounded-lg bg-orange-50 border border-orange-200'>
                  <div className='flex items-center gap-2 text-orange-600'>
                    <span className='text-sm font-medium'>High overlap warning</span>
                  </div>
                  <p className='text-sm text-orange-600 mt-1'>
                    Overlap is {Math.round((overlap / size) * 100)}% of chunk size. Consider
                    reducing overlap to improve efficiency.
                  </p>
                </div>
              )}

              {/* Chunking Preview */}
              <div className='space-y-2 pt-4'>
                <h4 className='text-sm font-medium'>Preview</h4>

                <div className='grid grid-cols-3 rounded-2xl border'>
                  <div className='p-3 rounded-l-2xl bg-primary-100 text-center border-r'>
                    <div className='text-xs font-medium mb-1'>Effective Size</div>
                    <div className='text-lg font-bold'>{size - overlap}</div>
                    <div className='text-xs text-muted-foreground'>chars</div>
                  </div>

                  <div className='p-3 bg-primary-100 text-center'>
                    <div className='text-xs font-medium mb-1'>Overlap</div>
                    <div className='text-lg font-bold'>{Math.round((overlap / size) * 100)}%</div>
                    <div className='text-xs text-muted-foreground'>ratio</div>
                  </div>

                  <div className='p-3 rounded-r-2xl bg-primary-100 text-center border-l'>
                    <div className='text-xs font-medium mb-1'>Est. Chunks</div>
                    <div className='text-lg font-bold'>{estimateChunksPerDocument()}</div>
                    <div className='text-xs text-muted-foreground'>per doc</div>
                  </div>
                </div>

                {/* Visual chunk representation */}
                <div className='space-y-2 pt-4'>
                  <div className='text-sm font-medium'>Visualization</div>
                  <div className='flex items-center gap-0.5'>
                    <div
                      className='bg-blue-500 h-5 rounded-l-2xl rounded-r-md flex items-center justify-center text-white text-xs font-medium'
                      style={{ width: `${Math.max(80, (size - overlap) / 25)}px` }}>
                      Chunk 1
                    </div>
                    <div
                      className='bg-purple-500 h-5 rounded-sm flex items-center justify-center text-white text-xs font-medium'
                      style={{ width: `${Math.max(16, overlap / 25)}px` }}
                    />
                    <div
                      className='bg-blue-500 h-5 rounded-r-2xl rounded-l-md flex items-center justify-center text-white text-xs font-medium'
                      style={{ width: `${Math.max(80, (size - overlap) / 25)}px` }}>
                      Chunk 2
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className='flex justify-end gap-2 border-t px-4 py-4'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => form.reset()}
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
      </form>
    </Form>
  )
}
