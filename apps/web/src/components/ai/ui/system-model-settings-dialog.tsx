// apps/web/src/components/ai/ui/system-model-settings-dialog.tsx
'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Settings2 } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'

/**
 * Model type configuration with labels and descriptions
 */
const MODEL_TYPE_CONFIG: Array<{
  type: ModelType
  label: string
  description: string
}> = [
  {
    type: ModelType.LLM,
    label: 'Language Model',
    description: 'Default model for text generation, chat, and completions',
  },
  {
    type: ModelType.TEXT_EMBEDDING,
    label: 'Text Embedding',
    description: 'Default model for creating vector embeddings',
  },
  {
    type: ModelType.RERANK,
    label: 'Rerank',
    description: 'Default model for reranking search results',
  },
  {
    type: ModelType.TTS,
    label: 'Text-to-Speech',
    description: 'Default model for voice synthesis',
  },
  {
    type: ModelType.SPEECH2TEXT,
    label: 'Speech-to-Text',
    description: 'Default model for transcription',
  },
  {
    type: ModelType.MODERATION,
    label: 'Moderation',
    description: 'Default model for content moderation',
  },
  {
    type: ModelType.VISION,
    label: 'Vision',
    description: 'Default model for image analysis',
  },
]

interface SystemModelSettingsDialogProps {
  trigger?: React.ReactNode
  triggerClassName?: string
}

/**
 * Dialog for configuring system-wide default models per ModelType
 * Uses VarEditorField pattern similar to entity-instance-dialog.tsx
 */
export function SystemModelSettingsDialog({
  trigger,
  triggerClassName,
}: SystemModelSettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [pendingModelType, setPendingModelType] = useState<ModelType | null>(null)
  const utils = api.useUtils()

  // Single query for all unified model data - shared across all pickers
  const { data: unifiedModelData } = api.aiIntegration.getUnifiedModelData.useQuery(
    { includeDefaults: true, includeUnconfigured: false },
    { enabled: open, staleTime: 5 * 60 * 1000 }
  )

  // Fetch current defaults
  const { data: defaults, isLoading: isLoadingDefaults } =
    api.aiIntegration.getSystemModelDefaults.useQuery(undefined, { enabled: open })

  // Set default mutation
  const setDefault = api.aiIntegration.setSystemModelDefault.useMutation()

  // Remove default mutation
  const removeDefault = api.aiIntegration.removeSystemModelDefault.useMutation()

  /**
   * Get current default value for a model type
   */
  const getCurrentValue = (modelType: ModelType): string | null => {
    const defaultSetting = defaults?.find((d) => d.modelType === modelType)
    return defaultSetting ? `${defaultSetting.provider}:${defaultSetting.model}` : null
  }

  /**
   * Handle model selection for a model type
   */
  const handleModelChange = async (modelType: ModelType, model: ModelPickerItem | null) => {
    setPendingModelType(modelType)
    try {
      if (model) {
        await setDefault.mutateAsync({
          modelType,
          provider: model.provider,
          model: model.modelId,
        })
      } else {
        await removeDefault.mutateAsync({ modelType })
      }
      utils.aiIntegration.getSystemModelDefaults.invalidate()
    } catch (error) {
      toastError({
        title: 'Failed to update',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setPendingModelType(null)
    }
  }

  const isPending = pendingModelType !== null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant='outline' size='sm' className={triggerClassName}>
            <Settings2 />
            <span className='hidden @sm:inline'>System Model Settings</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size='md' position='tc'>
        <DialogHeader>
          <DialogTitle>System Model Settings</DialogTitle>
          <DialogDescription>
            Configure default AI models for your organization. These models will be used when no
            specific model is provided.
          </DialogDescription>
        </DialogHeader>

        <VarEditorField className='p-0'>
          {MODEL_TYPE_CONFIG.map(({ type, label, description }) => (
            <VarEditorFieldRow key={type} title={label} description={description}>
              {unifiedModelData ? (
                <AiModelPicker
                  data={unifiedModelData}
                  value={getCurrentValue(type)}
                  onChange={(model) => handleModelChange(type, model)}
                  modelTypes={[type]}
                  showUnconfigured={false}
                  placeholder={`Select ${label.toLowerCase()}...`}
                  triggerVariant='transparent'
                  triggerClassName='w-full justify-between flex-1'
                  isUpdating={pendingModelType === type}
                />
              ) : (
                <Skeleton className='mt-2 h-5 w-25' />
              )}
            </VarEditorFieldRow>
          ))}
        </VarEditorField>

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => setOpen(false)} disabled={isPending}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
