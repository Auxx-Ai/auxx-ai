// apps/web/src/components/mail/thread-merge-badge.tsx
'use client'

import type { ThreadMergeData } from '@auxx/lib/threads/types'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useThreadMutation } from '~/components/threads/hooks'
import { RecordIcon, recordBadgeVariants } from '../resources/ui'

/** Unmerge TTL — must match `ThreadMergeService.UNMERGE_TTL_MS`. */
const UNMERGE_TTL_MS = 24 * 60 * 60 * 1000

interface ThreadMergeBadgeProps {
  mergeData: ThreadMergeData | null | undefined
}

export function ThreadMergeBadge({ mergeData }: ThreadMergeBadgeProps) {
  const sources = mergeData?.sources ?? []
  const { unmerge } = useThreadMutation()

  if (sources.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type='button' className={cn(recordBadgeVariants({ variant: 'link' }))}>
          <span className='flex size-4 items-center justify-center rounded-full bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200'>
            <RecordIcon iconId='merge' className='size-2.5' />
          </span>
          <span data-slot='record-display' className='truncate'>
            {sources.length} merged
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-80'>
        <DropdownMenuLabel>
          {sources.length} thread{sources.length === 1 ? '' : 's'} merged into this one
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className='flex max-h-80 flex-col overflow-y-auto'>
          {sources.map((source) => {
            const mergedAtMs = Date.parse(source.mergedAt)
            const canUnmerge =
              Number.isFinite(mergedAtMs) && Date.now() - mergedAtMs < UNMERGE_TTL_MS
            return (
              <DropdownMenuItem
                key={source.threadId}
                asChild
                className='gap-2 pe-0!'
                selected={false}>
                <Link
                  href={`/app/mail/inbox/open/${source.threadId}`}
                  className='flex w-full items-center gap-2'>
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate font-medium'>{source.subject || '(no subject)'}</span>
                  </div>
                  {canUnmerge && (
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      onClick={(e) => {
                        // Don't navigate, don't close the menu — just unmerge.
                        e.preventDefault()
                        e.stopPropagation()
                        unmerge(source.threadId)
                      }}>
                      <Undo2 />
                    </Button>
                  )}
                </Link>
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
