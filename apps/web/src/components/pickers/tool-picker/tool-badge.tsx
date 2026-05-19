// apps/web/src/components/pickers/tool-picker/tool-badge.tsx

'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { useMemo } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { api } from '~/trpc/react'

interface ToolBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  name: string
  className?: string
}

/**
 * Inline pill for a `tool:<name>` reference chip. Resolves the tool name via
 * the org tool catalog (cached client-side). Falls back to the raw tool name
 * if the catalog hasn't loaded or the tool is no longer in the catalog.
 */
export function ToolBadge({ name, className, variant, size }: ToolBadgeProps) {
  const catalogQuery = api.agentToolset.listTools.useQuery(undefined, {
    staleTime: 60_000,
  })
  const entry = useMemo(
    () => catalogQuery.data?.find((e) => e.name === name),
    [catalogQuery.data, name]
  )

  const label = entry?.displayName ?? name
  const iconId = entry?.toolsetIconId || 'wrench'
  const color = entry?.toolsetColor || undefined

  return (
    <span data-slot='tool-badge' className={cn(recordBadgeVariants({ variant, size }), className)}>
      <AppIcon iconId={iconId} color={color} size='xs' />
      {catalogQuery.isLoading && !entry ? (
        <Skeleton />
      ) : (
        <span data-slot='record-display' className='truncate max-w-[160px]'>
          {label}
        </span>
      )}
    </span>
  )
}
