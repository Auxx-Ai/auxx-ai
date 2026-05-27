// apps/web/src/components/chat-widget/ui/settings/preview-pane.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Moon, Smartphone, Sun, SunMoon } from 'lucide-react'
import { useState } from 'react'

type PreviewTheme = 'light' | 'dark' | 'system'
type PreviewIntent = 'general' | 'setup' | 'appearance' | 'behavior' | 'ai' | 'identity'

interface PreviewPaneProps {
  channelId: string
  intent: PreviewIntent
  className?: string
}

/**
 * Live preview pane shown alongside the chat-widget settings tabs. Frames the
 * minimal embed route (`/preview/widget/<id>/embed`) inside a phone-shaped
 * card so settings changes can be visualised against the actual widget bundle
 * without leaving the page.
 *
 * The widget itself is config-driven by the channel's saved state — edits in
 * the form are reflected after a save (the `v` query string is rotated on
 * save success by the outer settings shell to bust the cache). Live unsaved
 * preview is a deliberate follow-up.
 */
export function PreviewPane({ channelId, className }: PreviewPaneProps) {
  const [theme, setTheme] = useState<PreviewTheme>('system')

  // `intent` is intentionally NOT part of the iframe URL or key — switching
  // tabs should keep the same widget instance alive. Reserved on the props
  // for the follow-up that adds per-intent overlay controls.
  const src = `/preview/widget/${channelId}/embed?theme=${theme}`

  return (
    <div className={cn('h-full', className)}>
      <div className='sticky top-[128px] flex h-[680px] max-h-[calc(100vh-9rem)] flex-col gap-3 p-4'>
        <div className='flex items-center justify-between'>
          <div className='text-sm font-medium text-muted-foreground'>Live preview</div>
          <ThemeToggle value={theme} onChange={setTheme} />
        </div>
        <div className='relative flex-1 overflow-hidden rounded-t-[1.125rem] rounded-b-[1.75rem] border border-black/20 '>
          <iframe
            key={theme}
            title='Chat widget preview'
            src={src}
            className='h-full w-full'
            style={{ border: 'none', background: 'transparent' }}
          />
        </div>
      </div>
    </div>
  )
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: PreviewTheme
  onChange: (next: PreviewTheme) => void
}) {
  const cycle: PreviewTheme = value === 'light' ? 'dark' : value === 'dark' ? 'system' : 'light'
  const Icon = value === 'dark' ? Moon : value === 'light' ? Sun : SunMoon
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-xs'
      onClick={() => onChange(cycle)}
      aria-label={`Theme: ${value}`}
      title={`Theme: ${value} (click to change)`}>
      <Icon className='size-3.5' />
    </Button>
  )
}

/**
 * Floating button + sheet for the mobile/tablet breakpoint where the
 * persistent preview pane is hidden. Renders the same iframe at full width
 * inside a slide-up sheet.
 */
export function MobilePreviewLauncher({ channelId }: { channelId: string; intent: PreviewIntent }) {
  const [open, setOpen] = useState(false)
  const src = `/preview/widget/${channelId}/embed?theme=system`

  return (
    <>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => setOpen(true)}
        className='fixed bottom-4 right-4 z-50 shadow-lg lg:hidden'>
        <Smartphone className='size-3.5' />
        Preview
      </Button>
      {open ? (
        <div
          role='dialog'
          aria-modal='true'
          className='fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm lg:hidden'>
          <div className='flex items-center justify-between border-b px-4 py-3'>
            <div className='text-sm font-semibold'>Preview</div>
            <Button type='button' variant='ghost' size='sm' onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
          <iframe
            title='Chat widget preview'
            src={src}
            className='flex-1 w-full'
            style={{ border: 'none', background: 'transparent' }}
          />
        </div>
      ) : null}
    </>
  )
}
