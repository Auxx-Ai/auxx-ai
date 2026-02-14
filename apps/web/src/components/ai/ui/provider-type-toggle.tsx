// apps/web/src/components/ai/ui/provider-type-toggle.tsx
'use client'

import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Building2, Key } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

interface ProviderTypeToggleProps {
  /** Provider name (e.g., 'openai', 'anthropic') */
  provider: string
  /** Current provider type being used */
  currentType: 'system' | 'custom'
  /** Whether the user has configured custom credentials */
  hasCustomCredentials: boolean
  /** Whether system credentials are available for this provider */
  hasSystemAccess: boolean
  /** Callback when provider type is changed */
  onTypeChange?: (newType: 'system' | 'custom') => void
}

/**
 * ProviderTypeToggle - Toggle between system (platform-provided) and custom (user-provided) credentials
 *
 * System credentials use platform-provided API keys with quota limits.
 * Custom credentials use the user's own API keys with no platform limits.
 */
export function ProviderTypeToggle({
  provider,
  currentType,
  hasCustomCredentials,
  hasSystemAccess,
  onTypeChange,
}: ProviderTypeToggleProps) {
  const [localType, setLocalType] = useState(currentType)

  // Sync local state when prop changes (e.g., from server refetch)
  useEffect(() => {
    setLocalType(currentType)
  }, [currentType])

  const utils = api.useUtils()
  const switchType = api.aiIntegration.switchProviderType.useMutation({
    onSuccess: () => {
      utils.aiIntegration.getUnifiedModelData.invalidate()
    },
    onError: (error, variables) => {
      // Revert on error
      setLocalType(variables.providerType === 'system' ? 'custom' : 'system')
      toastError({
        title: 'Failed to switch provider type',
        description: error.message,
      })
    },
  })

  const handleToggle = (newType: string) => {
    if (newType === 'system' && !hasSystemAccess) return
    if (newType === 'custom' && !hasCustomCredentials) return

    const typedNewType = newType as 'system' | 'custom'

    // Update local state immediately for instant UI feedback
    setLocalType(typedNewType)
    onTypeChange?.(typedNewType)

    // Fire backend call without awaiting
    switchType.mutate({
      provider,
      providerType: typedNewType,
    })
  }

  return (
    <RadioTab
      value={localType}
      onValueChange={handleToggle}
      size='sm'
      radioGroupClassName={cn(
        localType == 'system'
          ? 'after:bg-violet-500/40 dark:after:bg-violet-500/50!'
          : 'after:bg-amber-500/40 dark:after:bg-amber-500/50!'
      )}
      className='border h-6 border-primary-200 flex ml-auto '>
      <RadioTabItem
        value='system'
        className={cn(
          'min-w-5 px-1',
          localType === 'system' && 'text-violet-600 dark:text-violet-300'
        )}
        size='sm'
        disabled={!hasSystemAccess}
        tooltip={!hasSystemAccess ? 'No credits available' : 'Prioritize using credits'}>
        <Building2 />
      </RadioTabItem>
      <RadioTabItem
        value='custom'
        className={cn(
          'min-w-5 px-1',
          localType === 'custom' && 'text-amber-600 dark:text-amber-300'
        )}
        size='sm'
        disabled={!hasCustomCredentials}
        tooltip={
          !hasCustomCredentials
            ? 'Configure your API key first'
            : 'Prioritize using your own API key'
        }>
        <Key />
      </RadioTabItem>
    </RadioTab>
  )
}

export default ProviderTypeToggle
