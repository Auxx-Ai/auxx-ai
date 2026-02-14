// apps/web/src/components/ui/provider-icon.tsx

import type { ProviderData } from '@auxx/lib/ai/providers/types' //~/components/app/(protected)/app/settings/aiModels/_components'
import { cn } from '@auxx/ui/lib/utils'
import type { FC } from 'react'
import { PROVIDER_ICONS } from '~/constants/icons'

interface ProviderIconProps {
  provider: ProviderData
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showLabel?: boolean
  variant?: 'icon' | 'badge' | 'card'
  description?: string
  theme?: 'light' | 'dark'
}

const ProviderIcon: FC<ProviderIconProps> = ({
  provider,
  size = 'md',
  className,
  showLabel = false,
  variant = 'icon',
  description,
  theme = 'light',
}) => {
  const IconComponent = PROVIDER_ICONS[provider.icon]

  const parentSizeClasses = { sm: 'size-6', md: 'size-7', lg: 'size-8', xl: 'size-9' }
  const sizeClasses = { sm: 'size-4', md: 'size-5', lg: 'size-6', xl: 'size-8' }

  const textSizeClasses = { sm: 'text-xs', md: 'text-sm', lg: 'text-base', xl: 'text-lg' }

  if (variant === 'icon') {
    return (
      <div
        className={cn(
          'rounded-md justify-center border flex items-center gap-2',
          parentSizeClasses[size],
          className
        )}
        style={{ borderColor: provider.color }}>
        {IconComponent ? (
          <IconComponent className={sizeClasses[size]} dark={theme === 'dark'} />
        ) : (
          <div
            className={cn(
              'rounded flex items-center justify-center font-bold text-white',
              sizeClasses[size],
              'text-xs'
            )}
            style={{ backgroundColor: provider.color }}>
            {provider.displayName.charAt(0)}
          </div>
        )}
        {showLabel && <span className={textSizeClasses[size]}>{provider.displayName}</span>}
      </div>
    )
  }

  if (variant === 'badge') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 px-2 py-1 rounded-md border',
          textSizeClasses[size],
          className
        )}
        style={{ borderColor: provider.color + '20', backgroundColor: provider.color + '10' }}>
        {IconComponent ? (
          <IconComponent className={sizeClasses[size]} style={{ color: provider.color }} />
        ) : (
          <div
            className={cn(
              'rounded flex items-center justify-center font-bold text-white text-xs',
              sizeClasses[size]
            )}
            style={{ backgroundColor: provider.color }}>
            {provider.displayName.charAt(0)}
          </div>
        )}
        <span style={{ color: provider.color }}>{provider.displayName}</span>
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-lg border-2 transition-colors',
          className
        )}
        style={{ borderColor: provider.color + '20' }}>
        {IconComponent ? (
          <IconComponent className='h-8 w-8' style={{ color: provider.color }} />
        ) : (
          <div
            className='h-8 w-8 rounded flex items-center justify-center font-bold text-white'
            style={{ backgroundColor: provider.color }}>
            {provider.displayName.charAt(0)}
          </div>
        )}
        <div>
          <h3 className='font-medium' style={{ color: provider.color }}>
            {provider.displayName}
          </h3>
          {description && <p className='text-xs text-muted-foreground mt-1'>{description}</p>}
        </div>
      </div>
    )
  }

  return null
}

export { ProviderIcon }
