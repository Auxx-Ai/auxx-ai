// apps/web/src/app/(protected)/app/settings/aiModels/_components/model-row.tsx

'use client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Settings } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { ModelToggle } from '~/components/ai/ui/model-toggle'
import ModelIcon from '~/components/workflow/ui/model-parameter/model-icon'
import { CredentialConfigurationDialog } from './credential-configuration-dialog'
import { FeatureBadges } from './feature-badges'
import { FetchFrom, type ModelData, type ProviderConfiguration } from './utils'

interface ModelRowProps {
  model: ModelData // Now using the clean ModelData type from ProviderManager
  provider: ProviderConfiguration
  onRemove?: (modelId: string) => void
  isProcessing?: boolean
  className?: string
  /** All providers for passing to dialogs */
  providers: ProviderConfiguration[]
}

/**
 * Individual model row component with features and actions
 */
export const ModelRow: React.FC<ModelRowProps> = ({
  model,
  provider,
  // onRemove,
  isProcessing = false,
  className,
  providers,
}) => {
  const [parameterDialogOpen, setParameterDialogOpen] = useState(false)
  const [configureDialogOpen, setConfigureDialogOpen] = useState(false)
  const [shouldRenderDialog, setShouldRenderDialog] = useState(false)

  const isModelDisabled = model.status === 'not_configured'

  return (
    <div
      className={cn(
        'group/model flex items-center justify-between px-3 py-1.5  border-muted/30',
        'hover:bg-primary-100/50 transition-all duration-150 ease-in-out',
        'animate-in slide-in-from-left-2 fade-in duration-300',
        className
      )}>
      {/* Model info section */}
      <div className='flex items-center gap-3 flex-1 min-w-0'>
        {/* Model icon */}
        <ModelIcon
          provider={model.provider}
          modelName={model.modelId}
          size='sm'
          className='flex-shrink-0'
        />

        {/* Model name and features */}
        <div className='flex-1 min-w-0 flex items-center gap-1'>
          <span className='text-sm truncate'>{model.displayName}</span>
          {model.fetchFrom == FetchFrom.CUSTOMIZABLE_MODEL && (
            <span className='bg-primary-150 size-4 text-xs ring-1 ring-primary-300 flex items-center justify-center rounded-md'>
              C
            </span>
          )}
          {/* Feature badges */}
          <FeatureBadges
            features={model.features}
            contextLength={model.contextLength}
            maxVisible={4}
            className='gap-1 hidden @lg:flex'
          />
        </div>
      </div>

      {/* Status and actions section */}
      <div className='flex items-center gap-3'>
        {/* Model Toggle - only show for configured providers */}

        {/* Action buttons */}
        <div className='flex items-center gap-2'>
          {/* Configure button - only show for custom models */}
          {model.fetchFrom === FetchFrom.CUSTOMIZABLE_MODEL && (
            <Button
              variant='outline'
              size='xs'
              onClick={() => {
                setShouldRenderDialog(true)
                setConfigureDialogOpen(true)
              }}
              disabled={isProcessing}
              className='duration-100 transition-all opacity-0 group-hover/model:opacity-100'
              title='Configure custom model'>
              <Settings />
              Configure
            </Button>
          )}

          {/* Remove button - only if handler exists */}
          {/* {onRemove && (
            <Button variant="outline" size="xs" onClick={handleRemove} disabled={isProcessing}>
              <Trash2 />
            </Button>
          )} */}

          {/* Show appropriate message for models without actions */}
          {/* {!provider.statusInfo.configured && (
            <span className="text-xs text-muted-foreground px-2 py-1">Configure provider</span>
          )} */}

          {/* {provider.statusInfo.configured && ( */}
          <ModelToggle
            provider={model.provider}
            disabled={isModelDisabled || isProcessing}
            model={model.modelId}
            enabled={!isModelDisabled && model.enabled}
            onToggle={(enabled) => {
              // Handle toggle - refresh UI is handled by ModelToggle component
            }}
            className='shrink-0'
          />
          {/* )} */}
        </div>
      </div>

      {/* Credential Configuration Dialog for custom models - only render when needed */}
      {shouldRenderDialog && (
        <CredentialConfigurationDialog
          mode='custom-model'
          provider={model.provider}
          modelId={model.modelId}
          operation='edit'
          open={configureDialogOpen}
          onOpenChange={setConfigureDialogOpen}
          providers={providers}
          onModelCreated={() => {
            // Refresh data will be handled by parent component invalidation
            setConfigureDialogOpen(false)
          }}
        />
      )}
    </div>
  )
}

/* 
    <ModelParameterDialog
      provider={model.provider}
      model={model.modelId}
      open={parameterDialogOpen}
      onOpenChange={setParameterDialogOpen}
    />
    */
