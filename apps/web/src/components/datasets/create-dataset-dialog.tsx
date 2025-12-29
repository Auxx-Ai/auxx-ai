// apps/web/src/components/datasets/create-dataset-dialog.tsx

'use client'

import { useState, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import { ModelType } from '@auxx/lib/ai/providers/types'
import { EMBEDDING_DIMENSIONS, type EmbeddingDimension } from '@auxx/lib/datasets/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'

const createDatasetSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be less than 255 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
  embeddingModel: z.string().optional(),
  vectorDimension: z.number().optional(),
})

type CreateDatasetForm = z.infer<typeof createDatasetSchema>

interface CreateDatasetDialogProps {
  trigger?: React.ReactNode
  onSuccess?: (dataset: any) => void
}

/**
 * Dialog for creating a new dataset
 * Provides form with name, description, and embedding model selection
 */
export function CreateDatasetDialog({ trigger, onSuccess }: CreateDatasetDialogProps) {
  const [open, setOpen] = useState(false)

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

  const unifiedModelData = api.aiIntegration.getUnifiedModelData.useQuery({
    includeDefaults: true,
    modelTypes: [ModelType.TEXT_EMBEDDING],
    includeUnconfigured: false,
  })

  const createDataset = api.dataset.create.useMutation({
    onSuccess: (dataset) => {
      // Reset form and close dialog
      form.reset()
      setOpen(false)

      // Invalidate datasets list to refresh UI
      utils.dataset.list.invalidate()
      utils.dataset.getOrganizationStats.invalidate()

      // Call success callback
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

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      form.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus />
            Create Dataset
          </Button>
        )}
      </DialogTrigger>
      <DialogContent position="tc" size="sm">
        <DialogHeader>
          <DialogTitle>Create New Dataset</DialogTitle>
          <DialogDescription>
            Create a new dataset to organize and manage your documents.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dataset Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter dataset name..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe what this dataset will contain..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <VarEditorField className="p-0 [&_[data-slot=field-row-label]]:w-30">
              <VarEditorFieldRow
                title="Model"
                description="Select a text embedding model from your configured providers">
                <FormField
                  control={form.control}
                  name="embeddingModel"
                  render={({ field }) => (
                    <FormItem className="flex-1 space-y-0! mb-0">
                      <AiModelPicker
                        data={unifiedModelData.data}
                        value={field.value ?? null}
                        onChange={handleModelChange}
                        modelTypes={[ModelType.TEXT_EMBEDDING]}
                        showUnconfigured={false}
                        placeholder="Select embedding model..."
                        triggerVariant="transparent"
                        triggerClassName="w-full justify-between h-6"
                        isUpdating={unifiedModelData.isLoading}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </VarEditorFieldRow>

              {/* Dimension selector - only show if model supports configurable dimensions */}
              {hasConfigurableDimensions && (
                <VarEditorFieldRow
                  title="Dimensions"
                  description={
                    dimensionRule?.help ||
                    'Smaller dimensions use less storage but may reduce accuracy.'
                  }>
                  <FormField
                    control={form.control}
                    name="vectorDimension"
                    render={({ field }) => (
                      <FormItem className="flex-1 mb-0 space-y-0!">
                        <Select
                          value={field.value?.toString() ?? defaultDimension.toString()}
                          onValueChange={(v) => field.onChange(parseInt(v))}>
                          <SelectTrigger className="w-full" size="sm" variant="transparent">
                            <SelectValue placeholder="Select dimension" />
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
                </VarEditorFieldRow>
              )}
            </VarEditorField>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={createDataset.isPending}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="submit"
                loading={createDataset.isPending}
                loadingText="Creating...">
                Create Dataset
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
