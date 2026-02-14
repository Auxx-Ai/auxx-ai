// apps/web/src/components/workflow/ui/model-parameter/model-icon.tsx

import type { ModelData, ProviderData } from '@auxx/lib/ai/providers/types'
import { PROVIDER_ICON_LETTERS, PROVIDER_THEMES } from '@auxx/lib/constants/provider-icons'
import { cn } from '@auxx/ui/lib/utils'
import { Bot } from 'lucide-react'
import { PROVIDER_ICONS } from '~/constants/icons'

type ModelIconProps = {
  provider?: string | { provider: string } | ProviderData
  modelName?: string
  modelData?: ModelData // Use ModelData directly when available
  className?: string
  isDeprecated?: boolean
  size?: 'sm' | 'md' | 'lg'
  variant?: 'icon' | 'letter' | 'auto'
  theme?: 'light' | 'dark'
}

const ModelIcon = ({
  provider,
  className,
  modelName,
  modelData,
  isDeprecated = false,
  size = 'md',
  variant = 'auto',
  theme = 'light',
}: ModelIconProps) => {
  const providerName = typeof provider === 'string' ? provider : provider?.provider

  if (!providerName) {
    return <Bot className='h-3 w-3 text-muted-foreground' />
  }

  const providerTheme = PROVIDER_THEMES[providerName]
  const dark = theme === 'dark'
  // Use ModelData if available, otherwise fall back to theme/provider defaults
  const iconName = modelData?.icon || providerName

  const displayName =
    modelData?.displayName ||
    (typeof provider === 'object' && 'label' in provider ? provider.label : providerName)

  // Size classes
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' }

  const textSizeClasses = { sm: 'text-xs', md: 'text-xs', lg: 'text-sm' }

  // Try to render SVG icon first
  if (variant === 'icon' || variant === 'auto') {
    const IconComponent = PROVIDER_ICONS[iconName]
    if (IconComponent) {
      return (
        <div
          className={cn(
            'flex items-center justify-center rounded',
            sizeClasses[size],
            isDeprecated && 'opacity-50',
            className
          )}>
          <IconComponent className={sizeClasses[size]} dark={dark} />
        </div>
      )
    }
  }

  // Fallback to letter-based icon
  if (variant === 'letter' || variant === 'auto') {
    const letter =
      PROVIDER_ICON_LETTERS[providerName] ||
      displayName?.charAt(0).toUpperCase() ||
      providerName.charAt(0).toUpperCase()

    const bgColorClass = providerTheme?.bgColor || 'bg-gray-500'

    return (
      <div
        className={cn(
          'flex items-center justify-center rounded font-bold',
          sizeClasses[size],
          textSizeClasses[size],
          bgColorClass,
          'text-white',
          isDeprecated && 'opacity-50',
          className
        )}>
        {letter}
      </div>
    )
  }

  // Final fallback
  return <Bot className={cn(sizeClasses[size], 'text-muted-foreground')} />
}

export default ModelIcon
