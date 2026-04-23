// apps/web/src/app/(protected)/app/settings/aiModels/_components/provider-row.tsx

'use client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'

import type React from 'react'
import { ProviderIcon } from '~/components/ai/ui/provider-icon'
import type { ProviderConfiguration, ProviderStatusInfo } from '~/components/ai/ui/utils'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { ProviderActions } from './provider-actions'
import { ProviderCapabilities } from './provider-capabilities'
import { ProviderTypeToggle } from './provider-type-toggle'

/**
 * Get provider status info based on configuration status
 */
const getProviderStatus = (statusInfo: ProviderStatusInfo) => {
  if (!statusInfo.configured) {
    return { color: 'bg-gray-400', text: 'Not Setup' }
  }

  if (statusInfo.status === 'custom_configured' || statusInfo.status === 'system_configured') {
    return { color: 'bg-green-500', text: 'Valid Connection' }
  }

  return { color: 'bg-red-500', text: 'Invalid Connection' }
}

interface ProviderRowProps {
  provider: ProviderConfiguration
  isExpanded: boolean
  onToggle: () => void
  onSetup?: (provider: string) => void
  onEdit?: (provider: string) => void
  onCreateCustomModel?: (provider: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Expandable provider row component
 */
export const ProviderRow: React.FC<ProviderRowProps> = ({
  provider,
  isExpanded,
  onToggle,
  onSetup,
  onEdit,
  onCreateCustomModel,
  disabled = false,
  className,
}) => {
  const utils = api.useUtils()

  // Mutations
  const setDefaultProvider = api.aiIntegration.setDefaultProvider.useMutation()
  const testCredentials = api.aiIntegration.testProviderCredentials.useMutation()
  const removeProvider = api.aiIntegration.deleteProviderConfiguration.useMutation()

  const [confirm, ConfirmDialog] = useConfirm()

  // Handler functions
  const handleMakeDefault = async (providerName: string) => {
    try {
      await setDefaultProvider.mutateAsync({ provider: providerName })
      await utils.aiIntegration.getUnifiedModelData.invalidate()
      toastSuccess({
        title: 'Default provider updated',
        description: `${providerName} is now the default provider`,
      })
    } catch (error) {
      toastError({
        title: 'Failed to set default provider',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleTestConnection = async (providerName: string) => {
    try {
      const result = await testCredentials.mutateAsync({ provider: providerName })
      if (result.success) {
        toastSuccess({ title: result.status, description: 'Connection test passed' })
      } else {
        toastError({ title: result.status, description: result.error || 'Connection test failed' })
      }
      await utils.aiIntegration.getUnifiedModelData.invalidate()
    } catch (error) {
      toastError({
        title: 'Test Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleRemoveProvider = async (providerName: string) => {
    const confirmed = await confirm({
      title: 'Remove Provider?',
      description:
        'This will remove all configuration and models for this provider. This action cannot be undone.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await removeProvider.mutateAsync({ provider: providerName })
        await utils.aiIntegration.getUnifiedModelData.invalidate()
        toastSuccess({ title: 'Provider removed', description: `${providerName} has been removed` })
      } catch (error) {
        toastError({
          title: 'Failed to remove provider',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  const isProcessing =
    setDefaultProvider.isPending || testCredentials.isPending || removeProvider.isPending
  const statusInfo = getProviderStatus(provider.statusInfo)
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-border/50',
        // 'hover:bg-muted/30 transition-all duration-200 ease-in-out',
        'cursor-pointer',
        isExpanded && 'border-primary-300 bg-primary-100',
        className
      )}>
      {/* Left side - expandable content */}
      <button
        onClick={onToggle}
        disabled={disabled}
        className='flex items-center gap-3 ps-3 py-2 h-auto hover:bg-transparent flex-1 justify-start focus:outline-none'>
        {/* Provider icon */}
        <ProviderIcon provider={provider} size='sm' variant='icon' className='flex-shrink-0' />

        {/* Provider info */}
        <div className='flex-1 text-left min-w-0'>
          <div className='flex items-center gap-2'>
            <h3 className='text-sm'>{provider.label}</h3>
            {provider.isDefaultProvider && (
              <span className='text-xs text-green-600 font-medium px-2 py-0.5 bg-green-50 rounded-full'>
                Default
              </span>
            )}
            {/* Capabilities summary */}
            <ProviderCapabilities
              capabilities={provider.supportedModelTypes}
              modelCount={provider.models.length}
              className='text-xs hidden @xl:flex'
            />
          </div>
        </div>
      </button>

      {/* Right side - action buttons and status */}
      <div className='flex items-center gap-2 flex-shrink-0 pe-3'>
        {/* Provider type toggle — shown whenever either credential source exists,
            so users can still switch to their own key when system credits run out. */}
        {(provider.systemConfiguration?.enabled ||
          !!provider.customConfiguration?.provider?.credentials) && (
          <ProviderTypeToggle
            provider={provider.provider}
            currentType={provider.statusInfo.usingProviderType === 'SYSTEM' ? 'system' : 'custom'}
            hasCustomCredentials={!!provider.customConfiguration?.provider?.credentials}
            hasSystemAccess={provider.systemConfiguration?.enabled ?? false}
            onRequestCustomSetup={() => onSetup?.(provider.provider)}
          />
        )}

        <ProviderActions
          provider={provider.provider}
          configured={provider.statusInfo.configured}
          configStatus={provider.statusInfo.status}
          hasCustomCredentials={!!provider.customConfiguration?.provider?.credentials}
          onSetup={onSetup}
          onEdit={onEdit}
          onMakeDefault={handleMakeDefault}
          onTestConnection={handleTestConnection}
          onRemoveProvider={handleRemoveProvider}
          onCreateCustomModel={onCreateCustomModel}
          disabled={disabled || isProcessing}
        />

        {/* Status indicator */}
        <Tooltip content={statusInfo.text}>
          <div className={cn('size-2 rounded-full', statusInfo.color)} />
        </Tooltip>
      </div>
      <ConfirmDialog />
    </div>
  )
}

interface ProviderHeaderProps {
  provider: ProviderConfiguration
  isExpanded: boolean
  onToggle: () => void
  onSetup?: (provider: string) => void
  onEdit?: (provider: string) => void
  disabled?: boolean
}

/**
 * Simplified provider header for use in layouts
 */
export const ProviderHeader: React.FC<ProviderHeaderProps> = (props) => {
  return <ProviderRow {...props} className='border-0 hover:bg-muted/20' />
}
