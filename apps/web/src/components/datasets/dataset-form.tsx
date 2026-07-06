// apps/web/src/components/datasets/dataset-form.tsx
'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import { EMBEDDING_DIMENSIONS, type EmbeddingDimension } from '@auxx/lib/datasets/types'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'

const createDatasetSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be less than 255 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
  embeddingModel: z.string().optional(),
  vectorDimension: z.number().optional(),
})

type CreateDatasetForm = z.infer<typeof createDatasetSchema>

/** Props for the shell-free dataset create form core. */
export interface DatasetFormProps {
  /** Called after a successful create (for auto-select / list refresh hooks). */
  onSuccess?: (dataset: unknown) => void
  /** Dismiss after a successful save (dialog closes; palette closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it to root. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it. */
  header?: (ctx: { title: string }) => ReactNode
}

/**
 * Shell-free dataset create form: all hooks/state, the field body, and the footer
 * (Cancel / Create). `create-dataset-dialog.tsx` wraps this in a `Dialog`; the
 * command palette hosts it as a page. Owns its own mutation + cache invalidation.
 */
export function DatasetForm({ onSuccess, onClose, onCancel, header }: DatasetFormProps) {
  const cancel = onCancel ?? onClose
  const form = useForm<CreateDatasetForm>({
    resolver: standardSchemaResolver(createDatasetSchema),
    defaultValues: {
      name: '',
      description: '',
      embeddingModel: undefined,
      vectorDimension: undefined,
    },
  })

  const utils = api.useUtils()

  const unifiedModelData = api.aiIntegration.getUnifiedModelData.useQuery(
    {
      includeDefaults: true,
      modelTypes: [ModelType.TEXT_EMBEDDING],
      includeUnconfigured: false,
    },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  const createDataset = api.dataset.create.useMutation({
    onSuccess: (dataset) => {
      form.reset()
      onClose()
      utils.dataset.list.invalidate()
      utils.dataset.getOrganizationStats.invalidate()
      onSuccess?.(dataset)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create dataset',
        description: error.message,
      })
    },
  })

  const currentModelId = form.watch('embeddingModel')

  /** Get selected model to access its parameterRules */
  const selectedModel = useMemo(() => {
    if (!currentModelId || !unifiedModelData.data) return null
    for (const provider of unifiedModelData.data.providers) {
      const model = provider.models.find(
        (m: { modelId: string }) => `${provider.provider}:${m.modelId}` === currentModelId
      )
      if (model) return model
    }
    return null
  }, [currentModelId, unifiedModelData.data])

  /** Extract dimension options from selected model's parameterRules */
  const dimensionRule = selectedModel?.parameterRules?.find(
    (rule: { name: string }) => rule.name === 'dimensions'
  )

  /** Get available options filtered to supported DB dimensions */
  const availableDimensions = useMemo(() => {
    if (!dimensionRule?.options) return null
    const supported = (dimensionRule.options as (string | number)[])
      .map((opt) => (typeof opt === 'string' ? Number(opt) : opt))
      .filter((dim): dim is EmbeddingDimension =>
        EMBEDDING_DIMENSIONS.includes(dim as EmbeddingDimension)
      )
    return supported.length > 1 ? supported : null
  }, [dimensionRule])

  const defaultDimension = dimensionRule?.default ? Number(dimensionRule.default) : 1536
  const hasConfigurableDimensions = availableDimensions && availableDimensions.length > 1

  /** Handle model selection change */
  const handleModelChange = (model: ModelPickerItem | null) => {
    form.setValue('embeddingModel', model?.id ?? undefined)

    // Auto-select model's default dimension if available
    if (model?.parameterRules) {
      const dimRule = model.parameterRules.find((rule) => rule.name === 'dimensions')
      if (dimRule?.default) {
        const defaultDim = Number(dimRule.default)
        if (EMBEDDING_DIMENSIONS.includes(defaultDim as EmbeddingDimension)) {
          form.setValue('vectorDimension', defaultDim)
        }
      }
    }
  }

  const onSubmit = (data: CreateDatasetForm) => {
    createDataset.mutate({
      name: data.name,
      description: data.description || undefined,
      embeddingModel: data.embeddingModel,
      vectorDimension: data.vectorDimension,
    })
  }

  return (
    <>
      {header?.({ title: 'Create New Dataset' })}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dataset Name *</FormLabel>
                <FormControl>
                  <Input placeholder='Enter dataset name...' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder='Describe what this dataset will contain...'
                    className='resize-none'
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FieldPanel
            className='p-0'
            resizeId='dataset-form'
            defaultLabelWidth={120}
            breakpoint='md'>
            <FieldPanelRow
              title='Model'
              description='Select a text embedding model from your configured providers'>
              <FormField
                control={form.control}
                name='embeddingModel'
                render={({ field }) => (
                  <FormItem className='flex-1 items-center space-y-0! mb-0'>
                    <AiModelPicker
                      data={unifiedModelData.data}
                      value={field.value ?? null}
                      onChange={handleModelChange}
                      modelTypes={[ModelType.TEXT_EMBEDDING]}
                      showUnconfigured={false}
                      placeholder='Select embedding model...'
                      triggerVariant='transparent'
                      triggerClassName='w-full justify-between h-8'
                      isUpdating={unifiedModelData.isLoading}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FieldPanelRow>

            {/* Dimension selector - only show if model supports configurable dimensions */}
            {hasConfigurableDimensions && (
              <FieldPanelRow
                title='Dimensions'
                description={
                  dimensionRule?.help ||
                  'Smaller dimensions use less storage but may reduce accuracy.'
                }>
                <FormField
                  control={form.control}
                  name='vectorDimension'
                  render={({ field }) => (
                    <FormItem className='flex-1 mb-0 space-y-0!'>
                      <Select
                        value={field.value?.toString() ?? defaultDimension.toString()}
                        onValueChange={(v) => field.onChange(parseInt(v, 10))}>
                        <SelectTrigger className='w-full' size='sm' variant='transparent'>
                          <SelectValue placeholder='Select dimension' />
                        </SelectTrigger>
                        <SelectContent>
                          {availableDimensions.map((dim) => (
                            <SelectItem key={dim} value={dim.toString()}>
                              {dim} dimensions {dim === defaultDimension && '(default)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FieldPanelRow>
            )}
          </FieldPanel>

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={cancel}
              disabled={createDataset.isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              type='submit'
              loading={createDataset.isPending}
              loadingText='Creating...'>
              Create Dataset <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
