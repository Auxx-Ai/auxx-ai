// apps/web/src/components/pickers/tool-picker/tool-badge.tsx

'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { AppIcon } from '~/components/workflow/ui/app-icon'
import { api } from '~/trpc/react'

interface ToolBadgeProps {
  name: string
  className?: string
}

/**
 * Inline pill for a `tool:<name>` reference chip. Resolves the tool name via
 * the org tool catalog (cached client-side). Falls back to the raw tool name
 * if the catalog hasn't loaded or the tool is no longer in the catalog.
 */
export function ToolBadge({ name, className }: ToolBadgeProps) {
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
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] bg-neutral-100 px-1 py-0 h-5 text-sm text-neutral-600 ring-1 ring-neutral-300 dark:bg-muted dark:text-neutral-100 dark:ring-neutral-800',
        className
      )}
      data-slot='tool-badge'>
      <AppIcon iconId={iconId} color={color} size='sm' />
      {catalogQuery.isLoading && !entry ? (
        <Skeleton className='h-3 w-14 rounded-full' />
      ) : (
        <span className='truncate max-w-[160px]'>{label}</span>
      )}
    </span>
  )
}
