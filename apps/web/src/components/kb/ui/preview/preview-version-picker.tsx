// apps/web/src/components/kb/ui/preview/preview-version-picker.tsx
'use client'

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
}

function modeLabel(mode: PreviewMode, activeVersionLabel: string | null): string {
  if (mode === 'draft') return 'Draft'
  if (mode === 'live') return 'Live'
  return activeVersionLabel
    ? `v${mode.versionNumber} — ${activeVersionLabel}`
    : `v${mode.versionNumber}`
}

function relativeTime(date: Date | string): string {
  const ts = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - ts.getTime()
  const sec = Math.round(diff / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  if (sec < 60) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day < 7) return `${day}d ago`
  return ts.toLocaleDateString()
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
          <span className='ml-auto text-xs text-muted-foreground'>in progress</span>
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
            return (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => {
                  if (v.versionNumber !== null) {
                    onModeChange({ versionNumber: v.versionNumber })
                  }
                }}>
                <Check className={isActive ? 'opacity-100' : 'opacity-0'} />
                <div className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate text-sm'>
                    v{v.versionNumber}
                    {v.label ? ` — ${v.label}` : ''}
                  </span>
                </div>
                <span className='ml-2 shrink-0 text-xs text-muted-foreground'>
                  {relativeTime(v.createdAt)}
                </span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
