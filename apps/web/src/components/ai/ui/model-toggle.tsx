// apps/web/src/app/(protected)/app/settings/aiModels/_components/model-toggle.tsx

'use client'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Loader2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

interface ModelToggleProps {
  provider: string
  model: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * Component for toggling model enabled/disabled state
 */
export const ModelToggle: React.FC<ModelToggleProps> = ({
  provider,
  model,
  enabled,
  onToggle,
  disabled = false,
  className,
}) => {
  // Local state for immediate UI feedback
  const [localEnabled, setLocalEnabled] = useState(enabled)
  const utils = api.useUtils()

  // Sync local state with prop changes
  useEffect(() => {
    setLocalEnabled(enabled)
  }, [enabled])

  const toggleModel = api.aiIntegration.toggleModel.useMutation({
    onSuccess: (_, variables) => {
      toastSuccess({
        title: 'Model updated',
        description: `${model} has been ${variables.enabled ? 'enabled' : 'disabled'}`,
      })
      // Invalidate to sync with server state
      utils.aiIntegration.getUnifiedModelData.invalidate()
    },
    onError: (error, variables) => {
      // Revert local state on error
      setLocalEnabled(!variables.enabled)
      toastError({ title: 'Failed to update model', description: error.message })
    },
  })

  const handleToggle = async (checked: boolean) => {
    // Update local state immediately for instant feedback
    setLocalEnabled(checked)

    try {
      await toggleModel.mutateAsync({ provider, model, enabled: checked })
      onToggle(checked)
    } catch (error) {
      // Error already handled in onError callback (reverts local state)
      console.error('Toggle error:', error)
    }
  }

  return (
    <div className={`flex items-center space-x-2 ${className || ''}`}>
      {toggleModel.isPending && <Loader2 className='h-3 w-3 animate-spin text-muted-foreground' />}
      <Switch
        checked={localEnabled}
        size='sm'
        onCheckedChange={handleToggle}
        disabled={disabled || toggleModel.isPending}
        id={`toggle-${provider}-${model}`}
      />
    </div>
  )
}
