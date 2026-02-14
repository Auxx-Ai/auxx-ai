// apps/web/src/components/workflow/ui/model-parameter/model-badge.tsx

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

type ModelBadgeProps = { className?: string; children?: React.ReactElement | string }

const ModelBadge = ({ className, children }: ModelBadgeProps) => {
  return (
    <div
      className={cn(
        'flex items-center px-1 h-[18px] rounded-[5px] border border-border text-xs font-medium uppercase text-muted-foreground cursor-default',
        className
      )}>
      {children}
    </div>
  )
}

export default ModelBadge
