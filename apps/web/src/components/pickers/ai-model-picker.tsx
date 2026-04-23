// ~/components/pickers/ai-model-picker.tsx
'use client'

import { type ModelData, ModelType } from '@auxx/lib/ai/providers/types'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Bot, Check, ChevronsUpDown, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

/** Type for unified model data from the API */
export type UnifiedModelData = RouterOutputs['aiIntegration']['getUnifiedModelData']

import { Tooltip } from '~/components/global/tooltip'
import ModelIcon from '~/components/workflow/ui/model-parameter/model-icon'
import ModelName from '~/components/workflow/ui/model-parameter/model-name'

// Simplified interface using native ModelData with computed properties
export interface ModelPickerItem extends ModelData {
  id: string // "provider:model" format
  providerLabel: string
  providerConfigured: boolean
}

interface AiModelPickerProps {
  /** The selected model ID in "provider:model" format */
  value?: string | null
  /** Callback when a model is selected */
  onChange?: (selectedModel: ModelPickerItem | null) => void
  className?: string
  /** Custom trigger element */
  children?: React.ReactNode
  /** Placeholder for the search input */
  placeholder?: string
  /** Text for the setup models action */
  emptyText?: string
  /** Filter by model types */
  modelTypes?: ModelType[]
  /** Show models from unconfigured providers */
  showUnconfigured?: boolean
  /** Show provider status indicators */
  showProviderStatus?: boolean
  /** Enable provider configuration actions */
  enableProviderConfiguration?: boolean
  /** Callback when provider needs configuration */
  onProviderConfigure?: (provider: string) => void
  /** Custom trigger button */
  triggerButton?: React.ReactNode
  /** Custom className for the trigger button */
  triggerClassName?: string
  /** Trigger button variant */
  triggerVariant?: 'outline' | 'ghost' | 'transparent'
  /** Optional explicit popover open state management */
  popoverOpen?: boolean
  /** Optional explicit popover open state change handler */
  onPopoverOpenChange?: (open: boolean) => void
  /** Pre-fetched unified model data to avoid redundant API calls */
  data?: UnifiedModelData
  /** Show updating state on trigger button */
  isUpdating?: boolean
  /** Compact trigger — show only icon + model name, no badges */
  compact?: boolean
}

/**
 * Client-side model compatibility check — mirrors ProviderManager.isModelCompatible
 * so that client-side filtering on pre-fetched data matches backend behavior.
 */
function isModelCompatibleClient(model: ModelData, modelType: ModelType): boolean {
  switch (modelType) {
    case ModelType.LLM:
      return model.features.includes('chat')
    case ModelType.TEXT_EMBEDDING:
      return model.features.includes('text-embedding') || model.features.includes('embedding')
    case ModelType.VISION:
      return model.supports.vision
    case ModelType.TTS:
      return model.features.includes('tts')
    case ModelType.SPEECH2TEXT:
      return model.features.includes('speech2text')
    case ModelType.MODERATION:
      return model.features.includes('moderation')
    case ModelType.RERANK:
      return model.features.includes('rerank')
    default:
      return false
  }
}

/** AiModelPicker renders a searchable list of AI models inside a popover */
export function AiModelPicker({
  value,
  onChange,
  className,
  children,
  placeholder = 'Search AI models...',
  emptyText = 'Setup models',
  modelTypes = [],
  showUnconfigured = false,
  showProviderStatus = true,
  enableProviderConfiguration = false,
  onProviderConfigure,
  triggerButton,
  triggerClassName,
  triggerVariant = 'outline',
  popoverOpen: externalOpen,
  onPopoverOpenChange: externalOnOpenChange,
  data: externalData,
  isUpdating = false,
  compact = false,
}: AiModelPickerProps) {
  /** Router instance used for navigation when no models exist */
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  // Use external state if provided, otherwise use internal state
  const isOpen = externalOpen ?? internalOpen
  const setIsOpen = externalOnOpenChange ?? setInternalOpen

  // Fetch unified model data only if external data is not provided
  const { data: fetchedData, isLoading: isFetching } =
    api.aiIntegration.getUnifiedModelData.useQuery(
      {
        includeDefaults: true,
        modelTypes: modelTypes.length > 0 ? modelTypes : undefined,
        includeUnconfigured: showUnconfigured,
      },
      {
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
        enabled: !externalData, // Disable query when external data is provided
      }
    )

  // Use provided data or fetched data
  const unifiedData = externalData ?? fetchedData
  const isLoading = !externalData && isFetching

  // Transform and filter models - apply client-side filtering when using external data
  const models = useMemo(() => {
    if (!unifiedData) return []

    return unifiedData.providers.flatMap((provider) =>
      provider.models
        // Hide retired models from picker
        .filter((model) => model.status !== 'retired')
        // Filter by modelTypes when using external data (backend filtering isn't applied)
        .filter((model) => {
          if (!externalData || modelTypes.length === 0) return true
          return modelTypes.some((type) => isModelCompatibleClient(model, type))
        })
        // Filter by unconfigured status when using external data
        .filter((model) => {
          if (!externalData) return true
          return showUnconfigured || model.status !== 'not_configured'
        })
        .map(
          (model): ModelPickerItem => ({
            ...model, // Use all native ModelData properties
            id: `${provider.provider}:${model.modelId}`,
            providerLabel: provider.label,
            providerConfigured: provider.statusInfo.configured,
          })
        )
    )
  }, [unifiedData, externalData, modelTypes, showUnconfigured])

  // Memoize the selected model object
  const selectedModel = useMemo(() => {
    if (!value) return null
    return models.find((model) => model.id === value) || null
  }, [value, models])

  /** Handles model selection and closes the popover */
  const handleSelect = (model: ModelPickerItem) => {
    onChange?.(model)
    setIsOpen(false)
    setSearchValue('')
  }

  /** Triggers provider configuration flow when requested */
  const handleProviderConfigure = (provider: string) => {
    onProviderConfigure?.(provider)
    setIsOpen(false)
  }

  /** Navigates the user to the AI model settings page */
  const handleSetupModelsNavigation = () => {
    setIsOpen(false)
    setSearchValue('')
    router.push('/app/settings/aiModels')
  }

  // Filter models based on search
  const searchFilteredModels = useMemo(() => {
    if (!searchValue) return models
    const lowerSearch = searchValue.toLowerCase()
    return models.filter((model) => {
      return (
        model.providerLabel.toLowerCase().includes(lowerSearch) ||
        model.displayName.toLowerCase().includes(lowerSearch) ||
        model.provider.toLowerCase().includes(lowerSearch) ||
        model.modelId.toLowerCase().includes(lowerSearch) ||
        model.features.some((feature) => feature.toLowerCase().includes(lowerSearch))
      )
    })
  }, [models, searchValue])

  // Group models by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelPickerItem[]> = {}
    searchFilteredModels.forEach((model) => {
      if (!groups[model.provider]) {
        groups[model.provider] = []
      }
      groups[model.provider].push(model)
    })
    return groups
  }, [searchFilteredModels])

  const formatContextSize = (contextLength: number) => {
    if (contextLength >= 1000000) {
      return `${(contextLength / 1000000).toFixed(1)}M`
    } else if (contextLength >= 1000) {
      return `${(contextLength / 1000).toFixed(0)}K`
    }
    return contextLength.toString()
  }

  const triggerLabel = selectedModel
    ? `${selectedModel.providerLabel} - ${selectedModel.displayName}`
    : 'Pick an AI model'

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {children || triggerButton || (
          <Button
            variant={triggerVariant === 'transparent' ? 'ghost' : triggerVariant}
            role='combobox'
            aria-expanded={isOpen}
            disabled={isUpdating}
            className={cn(
              'justify-between',
              !selectedModel && 'text-muted-foreground',
              triggerVariant === 'transparent' &&
                'bg-transparent border-0 hover:bg-primary-100 px-2',
              triggerClassName
            )}>
            {isUpdating ? (
              <div className='flex items-center gap-2 flex-1'>
                <Skeleton className='h-4 w-4 rounded-full' />
                <Skeleton className='h-4 w-24' />
              </div>
            ) : (
              <div className='flex items-center gap-2'>
                {selectedModel ? (
                  <>
                    <ModelIcon
                      provider={selectedModel.provider}
                      modelName={selectedModel.modelId}
                      size='sm'
                      className='flex-shrink-0'
                    />
                    <ModelName
                      modelItem={selectedModel}
                      className='truncate'
                      showMode={!compact}
                      showModelType={!compact}
                      showFeatures={!compact}
                      showCreditMultiplier
                    />
                  </>
                ) : (
                  'No model available'
                )}
              </div>
            )}
            <ChevronsUpDown className='opacity-50 flex-shrink-0' />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', className)}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={searchValue}
            onValueChange={setSearchValue}
            disabled={isLoading}
          />
          <CommandList>
            {isLoading && <CommandEmpty>Loading AI models...</CommandEmpty>}
            {!isLoading && Object.keys(groupedModels).length === 0 && (
              <CommandGroup>
                <div className='flex items-center justify-between px-2 py-1'>
                  <span className='text-sm font-medium'>No models found</span>
                </div>
                <CommandItem
                  value='setup-models'
                  onSelect={handleSetupModelsNavigation}
                  className='cursor-pointer'>
                  <div className='flex items-center gap-2'>
                    <Bot size={16} />
                    <span>{emptyText}</span>
                  </div>
                </CommandItem>
              </CommandGroup>
            )}
            {!isLoading &&
              Object.entries(groupedModels).map(([provider, providerModels]) => {
                const firstModel = providerModels[0]
                const needsConfiguration =
                  !firstModel?.providerConfigured && enableProviderConfiguration

                return (
                  <CommandGroup key={provider}>
                    <div className='flex items-center justify-between px-2 py-1'>
                      <span className='text-sm font-medium'>
                        {firstModel?.providerLabel || provider}
                      </span>
                      {enableProviderConfiguration && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => handleProviderConfigure(provider)}
                          className='h-6 w-6 p-0'>
                          <Settings className='h-3 w-3' />
                        </Button>
                      )}
                    </div>
                    {providerModels.map((model) => (
                      <CommandItem
                        key={model.id}
                        value={model.id}
                        onSelect={() => handleSelect(model)}
                        className='cursor-pointer flex items-center justify-between'
                        disabled={model.status === 'not_configured' && !showUnconfigured}>
                        <div className='flex flex-row gap-1 flex-1 min-w-0'>
                          <ModelIcon
                            provider={model.provider}
                            modelName={model.modelId}
                            size='sm'
                            className='flex-shrink-0'
                          />
                          <ModelName
                            modelItem={model}
                            className='truncate'
                            showMode
                            showModelType
                            showCreditMultiplier
                          />
                          {model.deprecated && (
                            <Tooltip
                              content={`This model is deprecated.${model.replacement ? ` Switch to ${model.replacement}` : ''}`}>
                              <Badge
                                variant='outline'
                                className='text-amber-500 border-amber-500 text-[10px] ml-1 shrink-0'>
                                Deprecated
                              </Badge>
                            </Tooltip>
                          )}
                        </div>
                        <Check
                          className={cn(
                            'size-4 shrink-0',
                            value === model.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
