// apps/web/src/components/datasets/settings/sections/embedding-settings-section.tsx
'use client'

import { useForm } from 'react-hook-form'
import { useMemo } from 'react'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Form, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Brain, CheckCircle, AlertTriangle, Lightbulb, Info } from 'lucide-react'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import { ModelType } from '@auxx/lib/ai/providers/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { DatasetEntity as Dataset } from '@auxx/database/models'
import { EMBEDDING_DIMENSIONS, type EmbeddingDimension } from '@auxx/lib/datasets/types'

/**
 * Props for EmbeddingSettingsSection component
 */
interface EmbeddingSettingsSectionProps {
  dataset: Dataset
  onUpdate?: (dataset: Dataset) => void
  readOnly?: boolean
}

/**
 * Schema for embedding settings form
 */
const embeddingSettingsSchema = z.object({
  embeddingModel: z.string().optional(),
  vectorDimension: z.number().optional(),
})

type EmbeddingSettingsForm = z.infer<typeof embeddingSettingsSchema>

/**
 * Component for configuring dataset embedding model
 * Uses AiModelPicker to select from configured TEXT_EMBEDDING models
 */
export function EmbeddingSettingsSection({
  dataset,
  onUpdate,
  readOnly = false,
}: EmbeddingSettingsSectionProps) {
  const form = useForm<EmbeddingSettingsForm>({
    resolver: standardSchemaResolver(embeddingSettingsSchema),
    defaultValues: {
      embeddingModel: dataset.embeddingModel ?? undefined,
      vectorDimension: dataset.vectorDimension ?? 1536,
    },
  })

  const embeddingOptions = api.dataset.getAvailableEmbeddingOptions.useQuery()

  const unifiedModelData = api.aiIntegration.getUnifiedModelData.useQuery({
    includeDefaults: true,
    modelTypes: [ModelType.TEXT_EMBEDDING],
    includeUnconfigured: false,
  })

  const updateDataset = api.dataset.update.useMutation({
    onSuccess: (updatedDataset) => {
      onUpdate?.(updatedDataset)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update embedding settings',
        description: error.message,
      })
    },
  })

  /**
   * Handle form submission
   */
  const onSubmit = (data: EmbeddingSettingsForm) => {
    if (readOnly) return
    updateDataset.mutate({
      id: dataset.id,
      data: {
        embeddingModel: data.embeddingModel,
        vectorDimension: data.vectorDimension,
      },
    })
  }

  /**
   * Handle model selection change
   */
  const handleModelChange = (model: ModelPickerItem | null) => {
    form.setValue('embeddingModel', model?.id ?? undefined)

    // Auto-select model's default dimension if available
    if (model?.parameterRules) {
      const dimensionRule = model.parameterRules.find((rule) => rule.name === 'dimensions')
      if (dimensionRule?.default) {
        const defaultDim = Number(dimensionRule.default)
        if (EMBEDDING_DIMENSIONS.includes(defaultDim as EmbeddingDimension)) {
          form.setValue('vectorDimension', defaultDim)
        }
      }
    }
  }

  /**
   * Apply system default embedding model
   */
  const applySystemDefault = () => {
    if (embeddingOptions.data?.systemDefault) {
      form.setValue('embeddingModel', embeddingOptions.data.systemDefault)
    }
  }

  const currentModelId = form.watch('embeddingModel')
  const currentDimension = form.watch('vectorDimension')
  const systemDefaultId = embeddingOptions.data?.systemDefault
  const isUsingSystemDefault = currentModelId === systemDefaultId

  // Get selected model to access its parameterRules
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

  // Extract dimension options from selected model's parameterRules
  const dimensionRule = selectedModel?.parameterRules?.find(
    (rule: { name: string }) => rule.name === 'dimensions'
  )

  // Get available options filtered to supported DB dimensions
  const availableDimensions = useMemo(() => {
    if (!dimensionRule?.options) return null

    // Filter to dimensions we support in the database
    const supported = (dimensionRule.options as (string | number)[])
      .map((opt) => (typeof opt === 'string' ? Number(opt) : opt))
      .filter((dim): dim is EmbeddingDimension =>
        EMBEDDING_DIMENSIONS.includes(dim as EmbeddingDimension)
      )

    return supported.length > 1 ? supported : null
  }, [dimensionRule])

  const defaultDimension = dimensionRule?.default ? Number(dimensionRule.default) : 1536
  const hasConfigurableDimensions = availableDimensions && availableDimensions.length > 1

  // Check if dimension change requires re-indexing
  const dimensionChanged = dataset.vectorDimension && currentDimension !== dataset.vectorDimension

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="p-6">
          {/* Header */}
          <div className="space-y-1 mb-6">
            <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
              <Brain className="size-4" /> Embedding Model
              {dataset.embeddingModel ? (
                <Badge variant="default" className="flex items-center gap-1 ml-2">
                  <CheckCircle className="size-3" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="destructive" className="flex items-center gap-1 ml-2">
                  <AlertTriangle className="size-3" />
                  Not Configured
                </Badge>
              )}
              {isUsingSystemDefault && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Info className="size-3" />
                  System Default
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Select an embedding model for vector search.
            </p>
          </div>

          {/* Model Selection */}
          <VarEditorField className="p-0 [&_[data-slot=field-row-label]]:w-60">
            <VarEditorFieldRow
              title="Embedding Model"
              description="Select a text embedding model from your configured providers">
              <FormField
                control={form.control}
                name="embeddingModel"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <AiModelPicker
                      data={unifiedModelData.data}
                      value={field.value ?? null}
                      onChange={handleModelChange}
                      modelTypes={[ModelType.TEXT_EMBEDDING]}
                      showUnconfigured={false}
                      placeholder="Select embedding model..."
                      triggerVariant="transparent"
                      triggerClassName="w-full justify-between"
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
                title="Embedding Dimensions"
                description={
                  dimensionRule?.help ||
                  'Smaller dimensions use less storage but may reduce accuracy.'
                }>
                <FormField
                  control={form.control}
                  name="vectorDimension"
                  className="space-y-0"
                  render={({ field }) => (
                    <FormItem className="flex-1 mb-0 space-y-0!">
                      <Select
                        value={field.value?.toString() ?? defaultDimension.toString()}
                        onValueChange={(v) => field.onChange(parseInt(v))}>
                        <SelectTrigger className="w-full " size="sm" variant="transparent">
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

          {/* Warning for dimension changes on existing datasets */}
          {dimensionChanged && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Changing dimensions from {dataset.vectorDimension} to {currentDimension} will
                require re-indexing all document segments in this dataset.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between border-t px-4 py-4">
          {embeddingOptions.data?.systemDefault && !isUsingSystemDefault && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={applySystemDefault}
              disabled={readOnly}>
              <Lightbulb />
              Use System Default
            </Button>
          )}

          <div className="flex gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => form.reset()}
              disabled={readOnly}>
              Reset
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={updateDataset.isPending}
              loadingText="Saving..."
              disabled={readOnly}>
              Save Configuration
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
