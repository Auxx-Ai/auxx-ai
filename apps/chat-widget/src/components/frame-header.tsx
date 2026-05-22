// apps/chat-widget/src/components/frame-header.tsx
//
// Three header variants share most of their shape, so a single component
// switches on `variant`. Phases 4–6 fill in the slotted content:
//   - dark hero    → Home root: logo + greeting on a primary-colored band
//   - plain title  → Messages root: centered "Messages" on a flat band
//   - contextual   → deep frames: back chevron + custom title + actions slot

import { ArrowLeft, X } from 'lucide-react'
import type { ComponentChildren } from 'preact'
import { cn } from '~/lib/cn'

export type FrameHeaderVariant = 'dark-hero' | 'plain' | 'contextual'

interface FrameHeaderProps {
  variant: FrameHeaderVariant
  title?: string
  subtitle?: string
  logoLight?: string | null
  logoDark?: string | null
  resolvedTheme?: 'light' | 'dark'
  onClose: () => void
  onBack?: () => void
  actions?: ComponentChildren
  children?: ComponentChildren
}

export function FrameHeader({
  variant,
  title,
  subtitle,
  logoLight,
  logoDark,
  resolvedTheme = 'light',
  onClose,
  onBack,
  actions,
  children,
}: FrameHeaderProps) {
  if (variant === 'dark-hero') {
    // dark-hero sits on the primary-colored band — always use the light logo
    // (white/transparent, designed for dark backgrounds).
    const heroLogo = logoLight
    return (
      <header className='relative flex shrink-0 flex-col gap-4 bg-primary px-5 py-5 text-primary-foreground'>
        <div className='flex items-start justify-between'>
          {heroLogo ? (
            <img src={heroLogo} alt='' className='h-8 w-auto' />
          ) : (
            <span className='h-8' />
          )}
          <CloseButton onClose={onClose} tone='light' />
        </div>
        {children ?? (
          <div className='flex flex-col gap-1'>
            {title ? <h1 className='text-xl font-semibold leading-tight'>{title}</h1> : null}
            {subtitle ? <p className='text-sm opacity-90'>{subtitle}</p> : null}
          </div>
        )}
      </header>
    )
  }

  if (variant === 'plain') {
    return (
      <header className='relative flex shrink-0 items-center justify-between border-b border-border bg-transparent px-4 py-3'>
        <span className='w-6' />
        <h1 className='text-sm font-semibold'>{title}</h1>
        <CloseButton onClose={onClose} tone='dark' />
      </header>
    )
  }

  return (
    <header className='relative flex shrink-0 items-center gap-2 border-b border-border bg-transparent px-3 py-2'>
      {onBack ? (
        <button
          type='button'
          onClick={onBack}
          className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground'
          aria-label='Back'>
          <ArrowLeft className='size-4' aria-hidden='true' />
        </button>
      ) : null}
      <div className='flex min-w-0 flex-1 flex-col'>
        {title ? (
          <span className='truncate text-sm font-semibold text-foreground'>{title}</span>
        ) : null}
        {subtitle ? (
          <span className='truncate text-xs text-muted-foreground'>{subtitle}</span>
        ) : null}
      </div>
      {actions}
      <CloseButton onClose={onClose} tone='dark' />
    </header>
  )
}

function CloseButton({ onClose, tone }: { onClose: () => void; tone: 'light' | 'dark' }) {
  return (
    <button
      type='button'
      onClick={onClose}
      aria-label='Close chat'
      className={cn(
        'flex size-7 items-center justify-center rounded transition-colors',
        tone === 'light'
          ? 'text-white/90 hover:bg-white/10 hover:text-white'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}>
      <X className='size-4' aria-hidden='true' />
    </button>
  )
}
