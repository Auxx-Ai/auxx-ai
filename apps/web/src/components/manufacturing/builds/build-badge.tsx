// apps/web/src/components/manufacturing/builds/build-badge.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { Hammer } from 'lucide-react'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { useAccess } from '~/providers/capabilities-provider'
import { openBuildSheet } from './build-sheet-store'

/** Whether this member may open the build sheet: `builds.get` needs `mrp.view`. */
export function useCanOpenBuilds(): boolean {
  return useAccess().can(PermissionKey.mrpView)
}

interface BuildBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  build: { buildId: string; number?: string | null }
  /** Open the build sheet on click. Off where the row itself opens it, and without `mrp.view`. */
  link?: boolean
  className?: string
}

/** A `Build` row as an inline chip: not a `RecordBadge`, since a build has no definition. */
export function BuildBadge({ build, link = true, size, className }: BuildBadgeProps) {
  const canOpen = useCanOpenBuilds()
  const iconClass = size === 'sm' ? 'size-3 shrink-0' : 'size-4 shrink-0'
  const content = (
    <>
      <Hammer className={iconClass} />
      <span className='truncate'>{build.number ?? 'Build'}</span>
    </>
  )

  if (!link || !canOpen)
    return <span className={cn(recordBadgeVariants({ size }), className)}>{content}</span>
  return (
    <button
      type='button'
      aria-label={`Open build ${build.number ?? ''}`.trim()}
      onClick={(event) => {
        event.stopPropagation()
        openBuildSheet(build.buildId)
      }}
      className={cn(recordBadgeVariants({ variant: 'link', size }), className)}>
      {content}
    </button>
  )
}
