import { Button } from '@auxx/ui/components/button'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import React from 'react'
import { type Device, type Theme, usePreview } from './preview-context'

function KBPreviewTopBar() {
  const { isDark, isMobile, setTheme, setDevice } = usePreview()

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  const handleThemeChange = (value?: string) => {
    if (!value) return
    setTheme(value as Theme)
  }

  const handleDeviceChange = (value?: string) => {
    if (!value) return
    setDevice(value as Device)
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  return (
    <div className='flex items-center border-b bg-background px-3 py-1'>
      {/* Left section --------------------------------------------------- */}
      <div className='flex flex-1 items-center gap-2'>
        <Button className='rounded-md' size='sm' variant='outline'>
          <span className='w-max-full text-ui-action truncate'>Publish site</span>
        </Button>
      </div>

      {/* Right section -------------------------------------------------- */}
      <div className='flex items-center gap-2'>
        <Button size='sm' variant='outline'>
          <span className='w-max-full text-ui-small truncate'>Share feedback</span>
        </Button>

        {/* Theme toggle -------------------------------------------------- */}
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

        {/* Device toggle ------------------------------------------------- */}
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

export default KBPreviewTopBar
