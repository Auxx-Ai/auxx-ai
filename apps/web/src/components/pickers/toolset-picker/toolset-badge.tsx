// apps/web/src/components/pickers/toolset-picker/toolset-badge.tsx

'use client'

import { flattenCatalogToToolsets } from '@auxx/lib/agents/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { useMemo } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'

interface ToolsetBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  slug: string
  className?: string
}

/**
 * Inline pill for a `toolset:<slug>` reference chip. Resolves the slug via
 * the org toolset catalog (cached client-side, shared with the agents Tools
 * tab). Falls back to the raw slug if the catalog hasn't loaded or the slug
 * is no longer in the catalog.
 */
export function ToolsetBadge({ slug, className, variant, size }: ToolsetBadgeProps) {
  const { catalog, isLoading } = useToolCatalog()
  const entry = useMemo(
    () => flattenCatalogToToolsets(catalog).find((e) => e.slug === slug),
    [catalog, slug]
  )

  const label = entry?.label ?? slug
  const iconId = entry?.iconId ?? 'wrench'
  const color = entry?.color || undefined

  return (
    <span
      data-slot='toolset-badge'
      className={cn(recordBadgeVariants({ variant, size }), className)}>
      <AppIcon iconId={iconId} color={color} size='xs' />
      {isLoading && !entry ? (
        <Skeleton />
      ) : (
        <span data-slot='record-display' className='truncate max-w-[160px]'>
          {label}
        </span>
      )}
    </span>
  )
}
