// apps/web/src/components/pickers/toolset-picker/toolset-badge.tsx

'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

interface ToolsetBadgeProps {
  slug: string
  className?: string
}

/**
 * Inline pill for a `toolset:<slug>` reference chip. Resolves the slug via
 * the org toolset catalog (cached client-side, shared with the agents Tools
 * tab). Falls back to the raw slug if the catalog hasn't loaded or the slug
 * is no longer in the catalog.
 */
export function ToolsetBadge({ slug, className }: ToolsetBadgeProps) {
  const catalogQuery = api.agentToolset.list.useQuery(undefined, {
    staleTime: 60_000,
  })
  const entry = useMemo(
    () => catalogQuery.data?.find((e) => e.slug === slug),
    [catalogQuery.data, slug]
  )

  const label = entry?.shortLabel ?? entry?.label ?? slug
  const iconId = entry?.iconId ?? 'wrench'
  const color = entry?.color ?? 'gray'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] bg-neutral-100 px-1 py-0 h-5 text-sm text-neutral-600 ring-1 ring-neutral-300 dark:bg-muted dark:text-neutral-100 dark:ring-neutral-800',
        className
      )}
      data-slot='toolset-badge'>
      <EntityIcon iconId={iconId} color={color} size='sm' />
      {catalogQuery.isLoading && !entry ? (
        <Skeleton className='h-3 w-14 rounded-full' />
      ) : (
        <span className='truncate max-w-[160px]'>{label}</span>
      )}
    </span>
  )
}
