// apps/web/src/components/kb/ui/preview/kb-preview-topbar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import { ExternalLink, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { type Device, type Theme, usePreview } from './preview-context'

interface KBPreviewTopBarProps {
  kbId: string
  /** Slug path of the article currently being edited; used to deep-link the new tab. */
  activeSlugPath?: string[]
}

export function KBPreviewTopBar({ kbId, activeSlugPath }: KBPreviewTopBarProps) {
  const { isDark, isMobile, setTheme, setDevice } = usePreview()

  const handleThemeChange = (value?: string) => {
    if (!value) return
    setTheme(value as Theme)
  }

  const handleDeviceChange = (value?: string) => {
    if (!value) return
    setDevice(value as Device)
  }

  const slugSegment =
    activeSlugPath && activeSlugPath.length > 0
      ? `/${activeSlugPath.map(encodeURIComponent).join('/')}`
      : ''
  const previewHref = `/preview/kb/${kbId}${slugSegment}`

  return (
    <div className='flex items-center border-b bg-background px-3 py-1'>
      <div className='flex flex-1 items-center gap-2'>
        <Button className='rounded-md' size='sm' variant='outline'>
          <span className='w-max-full text-ui-action truncate'>Publish site</span>
        </Button>
      </div>

      <div className='flex items-center gap-2'>
        <Button size='sm' variant='outline'>
          <span className='w-max-full text-ui-small truncate'>Share feedback</span>
        </Button>

        <Button size='icon-sm' variant='outline' asChild>
          <a
            href={previewHref}
            target='_blank'
            rel='noopener'
            aria-label='Open preview in new tab'
            title='Open preview in new tab'>
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
    </div>
  )
}
