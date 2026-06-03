// apps/web/src/components/workflow/nodes/core/answer/components/auto-resolve-badge.tsx

'use client'

import type React from 'react'
import { useCallback } from 'react'
import { ModeBadge } from '~/components/shared/mode-badge'

interface AutoResolveBadgeProps {
  isAuto: boolean
  onChange: (isAuto: boolean) => void
}

const MODE_CONFIG = {
  auto: {
    label: 'Auto',
    className: 'bg-purple-500/15 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  },
  manual: {
    label: 'Manual',
    className: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  },
}

/**
 * Inline badge button that shows whether a field is auto-resolved or manually
 * set. Click toggles between auto and manual mode. `responsive` keeps the full
 * label in narrow containers and collapses to the first letter at `@sm`.
 */
const AutoResolveBadge: React.FC<AutoResolveBadgeProps> = ({ isAuto, onChange }) => {
  const config = isAuto ? MODE_CONFIG.auto : MODE_CONFIG.manual

  const handleClick = useCallback(() => {
    onChange(!isAuto)
  }, [isAuto, onChange])

  return (
    <ModeBadge responsive label={config.label} className={config.className} onClick={handleClick} />
  )
}

export { AutoResolveBadge }
