// apps/web/src/components/workflow/ui/model-parameter/index.tsx

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowLeft } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AiModelPicker, type ModelPickerItem } from '~/components/pickers/ai-model-picker'
import { useWorkflowStore } from '../../store/workflow-store'
import { PROVIDER_WITH_PRESET_TONE, stopParameterRule, TONE_LIST } from './constants'
import ParameterItem from './parameter-item'
import PresetsParameter from './presets-parameter'
import Trigger from './trigger'
import type {
  DefaultModel,
  ModelParameterModalProps,
  ModelParameterRule,
  ParameterValue,
} from './types'

// Model ID conversion utilities
const splitModelId = (combinedId: string | null) => {
  if (!combinedId) return { provider: '', modelId: '' }
  const [provider, ...modelParts] = combinedId.split(':')
  return { provider, modelId: modelParts.join(':') }
}

const combineModelId = (provider: string, modelId: string) => {
  return provider && modelId ? `${provider}:${modelId}` : null
}

const ModelParameterModal: FC<ModelParameterModalProps> = ({
  popupClassName,
  isAdvancedMode,
  modelId,
  provider,
  setModel,
  completionParams,
  onCompletionParamsChange,
  hideDebugWithMultipleModel,
  debugWithMultipleModel,
  onDebugWithMultipleModelChange,
  renderTrigger,
  readonly,
  isInWorkflow,
}) => {
  const [open, setOpen] = useState(false)
  const [localCompletionParams, setLocalCompletionParams] = useState(completionParams)
  const [localModelValue, setLocalModelValue] = useState<string | null>(
    combineModelId(provider, modelId)
  )
  const [selectedModel, setSelectedModel] = useState<ModelPickerItem | null>(null)

  // Get unified model data from workflow store
  const modelData = useWorkflowStore((state) => state.modelData)
  const unifiedData = modelData
  const isLoading = !modelData // Loading if no model data yet

  // Get current provider and model from combined ID
  const { provider: localProvider, modelId: localModelId } = useMemo(() => {
    return splitModelId(localModelValue)
  }, [localModelValue])

  // Simplified data access - use selectedModel when available, fallback to lookup
  const currentModelData = useMemo(() => {
    // Prefer selectedModel from AI Model Picker (most up-to-date)
    if (selectedModel) return selectedModel

    // Fallback: lookup from unified data
    if (!unifiedData || !localProvider || !localModelId) return null
    const providerData = unifiedData.providers.find((p) => p.provider === localProvider)
    if (!providerData) return null
    return providerData.models.find((m) => m.modelId === localModelId) || null
  }, [selectedModel, unifiedData, localProvider, localModelId])

  const currentProvider = useMemo(() => {
    // Prefer provider from selectedModel if available
    if (selectedModel && unifiedData) {
      return unifiedData.providers.find((p) => p.provider === selectedModel.provider) || null
    }

    // Fallback: lookup by localProvider
    if (!unifiedData || !localProvider) return null
    return unifiedData.providers.find((p) => p.provider === localProvider) || null
  }, [selectedModel, unifiedData, localProvider])

  // Direct access - no more complex memoization needed
  const parameterRules: ModelParameterRule[] = currentModelData?.parameterRules || []
  const currentModel = currentModelData
  const providerConfigured = currentProvider?.statusInfo.configured || false

  const hasDeprecated = !currentProvider || !currentModel
  const modelDisabled = currentModel?.status !== 'active'
  const disabled = hasDeprecated || modelDisabled || !providerConfigured || readonly

  // Sync local state when props change (but only when modal is closed)
  useEffect(() => {
    if (!open) {
      setLocalCompletionParams(completionParams)
      setLocalModelValue(combineModelId(provider, modelId))
      // Reset selectedModel when props change
      setSelectedModel(null)
    }
  }, [completionParams, provider, modelId, open])

  // Model selection handler
  const handleModelSelection = (model: ModelPickerItem | null) => {
    console.log('Model selected:', model)
    if (model) {
      setLocalModelValue(combineModelId(model.provider, model.modelId))
      setSelectedModel(model)
    } else {
      setLocalModelValue(null)
      setSelectedModel(null)
    }
  }

  // Sync local state with props when modal opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      // Reset local state to current values when opening
      setLocalCompletionParams(completionParams)
      setLocalModelValue(combineModelId(provider, modelId))
      setSelectedModel(null) // Reset selected model
    } else {
      // Apply changes when closing
      onCompletionParamsChange(localCompletionParams)
      const { provider: newProvider, modelId: newModelId } = splitModelId(localModelValue)

      if (newProvider !== provider || newModelId !== modelId) {
        // Use selectedModel data if available, otherwise find from unified data
        const targetModel = selectedModel || currentModelData

        setModel({
          modelId: newModelId,
          provider: newProvider,
          mode: (targetModel?.modelProperties?.mode as string) || 'chat',
          features: targetModel?.features || [],
        })
      }
    }
    setOpen(newOpen)
  }

  const handleParamChange = (key: string, value: ParameterValue) => {
    setLocalCompletionParams({ ...localCompletionParams, [key]: value })
  }

  // Legacy handler - now handled by handleModelSelection
  const handleChangeModel = ({ provider, model }: DefaultModel) => {
    const combinedId = combineModelId(provider, model)
    setLocalModelValue(combinedId)
    setSelectedModel(null) // Clear cached selection
  }

  const handleSwitch = (key: string, value: boolean, assignValue: ParameterValue) => {
    if (!value) {
      const newCompletionParams = { ...localCompletionParams }
      delete newCompletionParams[key]
      setLocalCompletionParams(newCompletionParams)
    }
    if (value) {
      setLocalCompletionParams({ ...localCompletionParams, [key]: assignValue })
    }
  }

  const handleSelectPresetParameter = (toneId: number) => {
    const tone = TONE_LIST.find((tone) => tone.id === toneId)
    if (tone) {
      setLocalCompletionParams({ ...localCompletionParams, ...tone.config })
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className='relative'>
        <PopoverTrigger
          onClick={() => {
            console.log('ModelParameterModal trigger clicked')
            if (readonly) return
            handleOpenChange(!open)
          }}
          className='block w-full'>
          {renderTrigger ? (
            renderTrigger({
              open,
              disabled,
              modelDisabled,
              hasDeprecated,
              currentProvider,
              currentModel,
              providerName: localProvider,
              modelId: localModelId,
            })
          ) : (
            <Trigger
              disabled={disabled}
              isInWorkflow={isInWorkflow}
              modelDisabled={modelDisabled}
              hasDeprecated={hasDeprecated}
              currentProvider={currentProvider}
              currentModel={currentModel}
              providerName={localProvider}
              modelId={localModelId}
            />
          )}
        </PopoverTrigger>
        <PopoverContent
          className={cn('z-[60] w-[420px]')}
          align={isInWorkflow ? 'start' : 'end'}
          side={isInWorkflow ? 'left' : 'bottom'}
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className={cn(popupClassName)}>
            <div className='relative'>
              <div
                className={cn(
                  'text-sm font-semibold mb-1 flex h-6 items-center text-muted-foreground'
                )}>
                MODEL
              </div>

              {/* Model Selection with AI Model Picker */}
              <div className='space-y-2' onClick={(e) => e.stopPropagation()}>
                <AiModelPicker
                  value={localModelValue}
                  onChange={handleModelSelection}
                  showUnconfigured={false}
                  className='z-[80]'
                  triggerClassName='w-full'
                />
              </div>
            </div>

            {!!parameterRules.length && <div className='my-3 h-[1px] bg-border' />}

            {isLoading && (
              <div className='mt-5 text-center text-sm text-muted-foreground'>
                Loading parameters...
              </div>
            )}

            {!isLoading && !!parameterRules.length && (
              <div className='mb-2 flex items-center justify-between'>
                <div
                  className={cn(
                    'text-sm font-semibold flex h-6 items-center text-muted-foreground'
                  )}>
                  PARAMETERS
                </div>
                {PROVIDER_WITH_PRESET_TONE.includes(localProvider) && (
                  <PresetsParameter onSelect={handleSelectPresetParameter} />
                )}
              </div>
            )}

            {!isLoading && !!parameterRules.length && (
              <div className='space-y-2'>
                {[...parameterRules, ...(isAdvancedMode ? [stopParameterRule] : [])].map(
                  (parameter) => (
                    <ParameterItem
                      key={`${localModelValue || 'no-model'}-${parameter.name}`}
                      parameterRule={parameter}
                      disabled={disabled}
                      value={localCompletionParams?.[parameter.name]}
                      onChange={(v) => handleParamChange(parameter.name, v)}
                      onSwitch={(checked, assignValue) =>
                        handleSwitch(parameter.name, checked, assignValue)
                      }
                      isInWorkflow={isInWorkflow}
                    />
                  )
                )}
              </div>
            )}

            {!hideDebugWithMultipleModel && (
              <div
                className='bg-muted/50 text-sm flex h-[50px] cursor-pointer items-center justify-between rounded-b-xl border-t border-border px-4 text-foreground hover:bg-muted/70'
                onClick={() => onDebugWithMultipleModelChange?.()}>
                {debugWithMultipleModel ? 'Debug as Single Model' : 'Debug as Multiple Models'}
                <ArrowLeft className='h-3 w-3 rotate-180' />
              </div>
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}

export default ModelParameterModal
