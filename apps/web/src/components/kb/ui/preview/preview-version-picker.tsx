// apps/web/src/components/kb/ui/preview/preview-version-picker.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { formatRelativeTime } from '@auxx/utils'
import { Check, ChevronDown, GitBranch, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import type { PreviewMode } from '../../hooks/use-article-content'

interface PreviewVersionPickerProps {
  articleId: string
  mode: PreviewMode
  hasPublishedVersion: boolean
  onModeChange: (mode: PreviewMode) => void
  /**
   * When true, a placeholder picker (disabled, "Draft" label) is rendered.
   * Lets parents keep layout stable while waiting for an article id.
   */
  disabled?: boolean
  /**
   * ArticleRevision id of the currently-published revision. Used to badge the
   * matching row in the version history list. Null when never published.
   */
  publishedRevisionId?: string | null
  /**
   * When false and a published version exists, the Draft entry shows
   * "Same as live" to signal that publishing would be a no-op.
   */
  hasUnpublishedChanges?: boolean
}

function modeLabel(mode: PreviewMode, activeVersionLabel: string | null): string {
  if (mode === 'draft') return 'Draft'
  if (mode === 'live') return 'Live'
  return activeVersionLabel
    ? `v${mode.versionNumber} — ${activeVersionLabel}`
    : `v${mode.versionNumber}`
}

function isHistorical(mode: PreviewMode): mode is { versionNumber: number } {
  return typeof mode === 'object' && mode !== null
}

/**
 * Compact dropdown for switching the preview body between draft, the live
 * (currently published) revision, and any historical immutable snapshot.
 * Versions are loaded lazily on first open via `kb.getArticleVersions`.
 */
export function PreviewVersionPicker({
  articleId,
  mode,
  hasPublishedVersion,
  onModeChange,
  disabled,
  publishedRevisionId = null,
  hasUnpublishedChanges = true,
}: PreviewVersionPickerProps) {
  const [open, setOpen] = useState(false)
  const versionsQuery = api.kb.getArticleVersions.useQuery(
    { articleId },
    { enabled: open && !disabled, staleTime: 30_000 }
  )
  const versions = versionsQuery.data ?? []

  const activeVersion = isHistorical(mode)
    ? versions.find((v) => v.versionNumber === mode.versionNumber)
    : undefined
  const triggerLabel = modeLabel(mode, activeVersion?.label ?? null)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant='outline' size='xs' className='gap-1' aria-label='Switch preview version'>
          <GitBranch />
          <span className='max-w-[160px] truncate'>{triggerLabel}</span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[260px]'>
        <DropdownMenuLabel className='text-xs text-muted-foreground'>
          Preview content
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onModeChange('draft')}>
          <Check className={mode === 'draft' ? 'opacity-100' : 'opacity-0'} />
          <span>Draft</span>
          {hasPublishedVersion && !hasUnpublishedChanges ? (
            <span className='ml-auto text-xs text-muted-foreground'>Same as live</span>
          ) : null}
        </DropdownMenuItem>
        {hasPublishedVersion ? (
          <DropdownMenuItem onSelect={() => onModeChange('live')}>
            <Check className={mode === 'live' ? 'opacity-100' : 'opacity-0'} />
            <span>Live</span>
            <span className='ml-auto text-xs text-muted-foreground'>currently published</span>
          </DropdownMenuItem>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem disabled>
                  <Check className='opacity-0' />
                  <span>Live</span>
                  <span className='ml-auto text-xs text-muted-foreground'>not published</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent>This article has no published version yet.</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className='text-xs text-muted-foreground'>
          Version history
        </DropdownMenuLabel>
        {versionsQuery.isLoading ? (
          <div className='flex items-center justify-center py-4'>
            <Loader2 className='size-4 animate-spin text-muted-foreground' />
          </div>
        ) : versions.length === 0 ? (
          <div className='px-2 py-3 text-xs text-muted-foreground'>No published versions yet.</div>
        ) : (
          versions.map((v) => {
            const isActive = isHistorical(mode) && mode.versionNumber === v.versionNumber
            const isLive = publishedRevisionId !== null && v.id === publishedRevisionId
            return (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => {
                  if (v.versionNumber !== null) {
                    onModeChange({ versionNumber: v.versionNumber })
                  }
                }}>
                <Check className={isActive ? 'opacity-100' : 'opacity-0'} />
                <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                  <span className='truncate text-sm'>
                    v{v.versionNumber}
                    {v.label ? ` — ${v.label}` : ''}
                  </span>
                  {isLive ? (
                    <Badge variant='green' size='xs'>
                      Live
                    </Badge>
                  ) : null}
                </div>
                <span className='ml-2 shrink-0 text-xs text-muted-foreground'>
                  {formatRelativeTime(v.createdAt, true)}
                </span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
