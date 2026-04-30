// apps/web/src/components/kb/ui/preview/kb-preview-topbar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import { ExternalLink, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { useKbPublicUrl } from '~/components/kb/hooks/use-kb-public-url'
import { api } from '~/trpc/react'
import { type Device, type Theme, usePreview } from './preview-context'

interface KBPreviewTopBarProps {
  kbId: string
  /** Slug path of the article currently being edited; used to deep-link the new tab. */
  activeSlugPath?: string[]
}

/**
 * Preview-pane controls only — open-in-new-tab, light/dark toggle, and
 * desktop/mobile device toggle. Publish lifecycle controls live in the
 * editor header (`KBPublishCluster`).
 */
export function KBPreviewTopBar({ kbId, activeSlugPath }: KBPreviewTopBarProps) {
  const { isDark, isMobile, setTheme, setDevice } = usePreview()

  const { data: kb } = api.kb.byId.useQuery({ id: kbId })

  const slugSegment =
    activeSlugPath && activeSlugPath.length > 0
      ? `/${activeSlugPath.map(encodeURIComponent).join('/')}`
      : ''
  const previewHref = `/preview/kb/${kbId}${slugSegment}`
  const publicUrl = useKbPublicUrl(kb?.slug)

  const isPublished = kb?.publishStatus === 'PUBLISHED'
  const isUnlisted = kb?.publishStatus === 'UNLISTED'
  const isLive = isPublished || isUnlisted
  const externalHref = isLive && publicUrl ? `${publicUrl}${slugSegment}` : previewHref
  const externalLabel =
    isLive && publicUrl ? 'Open public site in new tab' : 'Open preview in new tab'

  const handleThemeChange = (value?: string) => {
    if (!value) return
    setTheme(value as Theme)
  }

  const handleDeviceChange = (value?: string) => {
    if (!value) return
    setDevice(value as Device)
  }

  return (
    <div className='flex items-center justify-end gap-2 border-b bg-background px-3 py-1'>
      <Button size='icon-sm' variant='ghost' asChild>
        <a
          href={externalHref}
          target='_blank'
          rel='noopener'
          aria-label={externalLabel}
          title={externalLabel}>
          <ExternalLink />
        </a>
      </Button>

      <ToggleGroup
        size='sm'
        type='single'
        value={isDark ? 'dark' : 'light'}
        onValueChange={handleThemeChange}
        aria-label='Theme'>
        <ToggleGroupItem value='light' aria-label='Light mode'>
          <Sun />
        </ToggleGroupItem>
        <ToggleGroupItem value='dark' aria-label='Dark mode'>
          <Moon />
        </ToggleGroupItem>
      </ToggleGroup>

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
  )
}
