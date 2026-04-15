// apps/web/src/components/workflow/nodes/core/answer/components/auto-resolve-badge.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { useCallback } from 'react'

interface AutoResolveBadgeProps {
  isAuto: boolean
  onChange: (isAuto: boolean) => void
}

const MODE_CONFIG = {
  auto: {
    letter: 'A',
    label: 'Auto',
    className: 'bg-purple-500/15 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  },
  manual: {
    letter: 'M',
    label: 'Manual',
    className: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  },
}

/**
 * Inline badge button that shows whether a field is auto-resolved or manually set.
 * Same visual pattern as RelationUpdateModeButton from the CRUD node.
 * Click toggles between auto and manual mode.
 */
const AutoResolveBadge: React.FC<AutoResolveBadgeProps> = ({ isAuto, onChange }) => {
  const config = isAuto ? MODE_CONFIG.auto : MODE_CONFIG.manual

  const handleClick = useCallback(() => {
    onChange(!isAuto)
  }, [isAuto, onChange])

  return (
    <button
      type='button'
      onClick={handleClick}
      className={cn(
        'group/mode',
        'flex h-5 shrink-0 items-center rounded-md px-1',
        'text-[10px] font-semibold uppercase leading-none',
        'cursor-pointer select-none',
        'overflow-hidden whitespace-nowrap',
        'transition-all duration-200 ease-out',
        config.className
      )}>
      <span
        className={cn(
          'inline-block overflow-hidden whitespace-nowrap',
          'transition-all duration-200 ease-out',
          isAuto ? '@sm:max-w-[8px]' : '@sm:max-w-[9px]',
          '@sm:group-hover/mode:max-w-20'
        )}>
        {config.label}
      </span>
    </button>
  )
}

export { AutoResolveBadge }
