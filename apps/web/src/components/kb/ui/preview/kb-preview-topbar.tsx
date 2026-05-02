// apps/web/src/components/kb/ui/preview/kb-preview-topbar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ButtonGroup, ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { getKbPreviewHref } from '@auxx/ui/components/kb/utils'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import {
  ChevronDown,
  ExternalLink,
  Eye,
  Monitor,
  Moon,
  RotateCcw,
  Smartphone,
  Sun,
} from 'lucide-react'
import { useKbPublicUrl } from '~/components/kb/hooks/use-kb-public-url'
import { api } from '~/trpc/react'
import { useArticleContent } from '../../hooks/use-article-content'
import { type Device, type Theme, usePreview } from './preview-context'
import { PreviewVersionPicker } from './preview-version-picker'

interface KBPreviewTopBarProps {
  kbId: string
  /** Slug path of the article currently being edited; used to deep-link the new tab. */
  activeSlugPath?: string[]
  /** Resolved article id (from the editor's slug or override) — needed by the version picker. */
  articleId?: string | null
}

/**
 * Preview-pane controls — preview/live entry on the left, theme + device
 * toggles on the right. Publish lifecycle controls live in the editor header
 * (`KBPublishCluster`).
 */
export function KBPreviewTopBar({ kbId, activeSlugPath, articleId }: KBPreviewTopBarProps) {
  const {
    effectiveMode,
    defaultMode,
    override,
    isMobile,
    knowledgeBase,
    previewMode,
    setOverride,
    setDevice,
    setPreviewMode,
  } = usePreview()

  const { data: kb } = api.kb.byId.useQuery({ id: kbId })

  const previewHref = getKbPreviewHref(kbId, activeSlugPath, previewMode)
  const slugSegment =
    activeSlugPath && activeSlugPath.length > 0
      ? `/${activeSlugPath.map(encodeURIComponent).join('/')}`
      : ''
  const publicUrl = useKbPublicUrl(kb?.slug)
  const { hasPublishedVersion } = useArticleContent(articleId ?? null, kbId)

  const isPublished = kb?.publishStatus === 'PUBLISHED'
  const isUnlisted = kb?.publishStatus === 'UNLISTED'
  const isLive = (isPublished || isUnlisted) && Boolean(publicUrl)
  const liveHref = publicUrl ? `${publicUrl}${slugSegment}` : null

  const showMode = knowledgeBase?.showMode !== false
  const showsHiddenModeHint = !showMode && override !== null && override !== defaultMode

  const handleThemeChange = (value?: string) => {
    if (!value) return
    setOverride(value as Theme)
  }

  const handleDeviceChange = (value?: string) => {
    if (!value) return
    setDevice(value as Device)
  }

  return (
    <div className='flex items-center justify-between gap-2 border-b bg-background px-3 py-1'>
      <div className='flex items-center gap-2'>
        {isLive && liveHref ? (
          <DropdownMenu>
            <ButtonGroup>
              <Button variant='outline' size='xs' className='border-r-0' asChild>
                <a
                  href={previewHref}
                  target='_blank'
                  rel='noopener'
                  aria-label='Open preview in new tab'>
                  <Eye /> Preview
                </a>
              </Button>
              <ButtonGroupSeparator />
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='xs'
                  className='px-1.5'
                  aria-label='More preview options'>
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
            </ButtonGroup>
            <DropdownMenuContent align='start'>
              <DropdownMenuItem asChild>
                <a href={liveHref} target='_blank' rel='noopener'>
                  <ExternalLink /> Open live site
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant='outline' size='xs' asChild>
            <a
              href={previewHref}
              target='_blank'
              rel='noopener'
              aria-label='Open preview in new tab'>
              <Eye /> Preview
            </a>
          </Button>
        )}
        {articleId ? (
          <PreviewVersionPicker
            articleId={articleId}
            mode={previewMode}
            hasPublishedVersion={hasPublishedVersion}
            onModeChange={setPreviewMode}
          />
        ) : null}
      </div>

      <div className='flex items-center gap-2'>
        {showsHiddenModeHint && (
          <span className='text-xs text-muted-foreground'>
            Visitors only see {defaultMode} mode
          </span>
        )}

        <ToggleGroup
          size='sm'
          type='single'
          value={effectiveMode}
          onValueChange={handleThemeChange}
          aria-label='Theme'>
          <ToggleGroupItem value='light' aria-label='Light mode'>
            <Sun />
          </ToggleGroupItem>
          <ToggleGroupItem value='dark' aria-label='Dark mode'>
            <Moon />
          </ToggleGroupItem>
        </ToggleGroup>

        {override !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size='icon-sm'
                variant='ghost'
                onClick={() => setOverride(null)}
                aria-label='Reset to default mode'>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to default ({defaultMode})</TooltipContent>
          </Tooltip>
        )}

        <ToggleGroup
          size='sm'
          type='single'
          value={isMobile ? 'mobile' : 'desktop'}
          onValueChange={handleDeviceChange}
          aria-label='Screen size'>
          <ToggleGroupItem value='desktop' aria-label='Desktop mode'>
            <Monitor />
          </ToggleGroupItem>
          <ToggleGroupItem value='mobile' aria-label='Mobile mode'>
            <Smartphone />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  )
}
