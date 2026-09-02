// apps/web/src/components/chat-widget/ui/settings/preview-pane.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@auxx/ui/components/sheet'
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
      {/* `MasterDetailSplit` does the sticking. The cap is the room it has under the
          settings header, in the variables `SettingsPage` publishes - `100vh` would
          overshoot by the chrome around the scroll viewport. */}
      <div className='flex h-[680px] max-h-[calc(var(--settings-viewport-h,100vh)-var(--settings-sticky-top,0px))] flex-col gap-3 p-4'>
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
 * Compact trigger that opens the mobile preview sheet. Pair it with
 * {@link MobilePreviewSheet} and a shared open-state in the parent. The
 * `className` controls which breakpoint it shows at (e.g. next to the mobile
 * tab dropdown vs. floating on tablet).
 */
export function MobilePreviewTrigger({
  onOpen,
  className,
}: {
  onOpen: () => void
  className?: string
}) {
  return (
    <Button type='button' variant='outline' size='sm' onClick={onOpen} className={className}>
      <Smartphone className='size-3.5' />
      Preview
    </Button>
  )
}

/**
 * Full-screen slide-up sheet showing the widget preview at the mobile/tablet
 * breakpoint where the persistent {@link PreviewPane} is hidden. Controlled —
 * the parent owns the open state so multiple triggers can share one sheet.
 *
 * Uses the Radix-backed {@link Sheet}, which portals to `document.body`. That
 * matters here: an ancestor `transform` (framer-motion in the page shell) plus
 * the settings card's `overflow-hidden` would otherwise re-root and clip a
 * plain `position: fixed` overlay to the settings window instead of the screen.
 */
export function MobilePreviewSheet({
  channelId,
  open,
  onClose,
}: {
  channelId: string
  open: boolean
  onClose: () => void
}) {
  // `rounded=0` — full-screen sheet wants the widget edge-to-edge, not the
  // rounded phone shell the desktop pane uses.
  const src = `/preview/widget/${channelId}/embed?theme=system&rounded=0`

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side='bottom' className='flex h-[100dvh] flex-col gap-0 p-0 lg:hidden'>
        <SheetHeader className='flex-none border-b px-4 py-3 text-left'>
          <SheetTitle className='text-sm font-semibold'>Preview</SheetTitle>
        </SheetHeader>
        <iframe
          title='Chat widget preview'
          src={src}
          className='w-full flex-1'
          style={{ border: 'none', background: 'transparent' }}
        />
      </SheetContent>
    </Sheet>
  )
}
