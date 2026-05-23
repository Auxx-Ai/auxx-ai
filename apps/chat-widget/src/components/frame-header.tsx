// apps/chat-widget/src/components/frame-header.tsx
//
// Three header variants share most of their shape, so a single component
// switches on `variant`. Phases 4–6 fill in the slotted content:
//   - dark hero    → Home root: logo + greeting on a primary-colored band
//   - plain title  → Messages root: centered "Messages" on a flat band
//   - contextual   → deep frames: back chevron + custom title + actions slot
//
// v3 Phase 6 adds the floating-window toggle button immediately left of the
// close button in every variant, and forwards a ref to the root `<header>`
// element so the parent can attach a pointer-drag controller while floating.

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, X } from 'lucide-react'
import type { ComponentChildren, Ref } from 'preact'
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
  floating?: boolean
  onToggleFloating?: () => void
  headerRef?: Ref<HTMLElement>
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
  floating,
  onToggleFloating,
  headerRef,
}: FrameHeaderProps) {
  if (variant === 'dark-hero') {
    // dark-hero sits on the primary-colored band — always use the light logo
    // (white/transparent, designed for dark backgrounds).
    const heroLogo = logoLight
    return (
      <header
        ref={headerRef}
        className='auxx-chat-clip-top relative flex shrink-0 flex-col gap-4 bg-primary px-5 py-5 text-primary-foreground'>
        <div className='flex items-start justify-between'>
          {heroLogo ? (
            <img src={heroLogo} alt='' className='h-8 w-auto' />
          ) : (
            <span className='h-8' />
          )}
          <div className='flex items-center gap-1'>
            {onToggleFloating ? (
              <FloatButton floating={floating ?? false} onToggle={onToggleFloating} tone='light' />
            ) : null}
            <CloseButton onClose={onClose} tone='light' />
          </div>
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
      <header
        ref={headerRef}
        className='auxx-chat-clip-top relative flex shrink-0 items-center justify-between border-b border-[color:var(--auxx-chat-hairline)] bg-transparent px-4 py-3'>
        <span aria-hidden className='size-7' />
        <h1 className='text-sm font-semibold'>{title}</h1>
        <div className='flex items-center gap-1'>
          {onToggleFloating ? (
            <FloatButton floating={floating ?? false} onToggle={onToggleFloating} tone='dark' />
          ) : null}
          <CloseButton onClose={onClose} tone='dark' />
        </div>
      </header>
    )
  }

  return (
    <header
      ref={headerRef}
      className='auxx-chat-clip-top relative flex shrink-0 items-center gap-2 border-b border-[color:var(--auxx-chat-hairline)] bg-transparent px-3 py-2'>
      {onBack ? (
        <button
          type='button'
          onClick={onBack}
          className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-[color:var(--auxx-chat-surface-dark-default)] hover:text-[color:var(--auxx-chat-text-loud)]'
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
      {onToggleFloating ? (
        <FloatButton floating={floating ?? false} onToggle={onToggleFloating} tone='dark' />
      ) : null}
      <CloseButton onClose={onClose} tone='dark' />
    </header>
  )
}

function FloatButton({
  floating,
  onToggle,
  tone,
}: {
  floating: boolean
  onToggle: () => void
  tone: 'light' | 'dark'
}) {
  const Icon = floating ? ArrowDownLeft : ArrowUpRight
  return (
    <button
      type='button'
      onClick={onToggle}
      onPointerDown={(e) => e.stopPropagation()}
      data-no-drag
      aria-label={floating ? 'Dock chat' : 'Pop out chat'}
      aria-pressed={floating}
      className={cn(
        'flex size-7 items-center justify-center rounded transition-colors',
        tone === 'light'
          ? 'text-white/90 hover:bg-white/10 hover:text-white'
          : 'text-muted-foreground hover:bg-[color:var(--auxx-chat-surface-dark-default)] hover:text-[color:var(--auxx-chat-text-loud)]'
      )}>
      <Icon className='size-4' aria-hidden='true' />
    </button>
  )
}

function CloseButton({ onClose, tone }: { onClose: () => void; tone: 'light' | 'dark' }) {
  return (
    <button
      type='button'
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      data-no-drag
      aria-label='Close chat'
      className={cn(
        'flex size-7 items-center justify-center rounded transition-colors',
        tone === 'light'
          ? 'text-white/90 hover:bg-white/10 hover:text-white'
          : 'text-muted-foreground hover:bg-[color:var(--auxx-chat-surface-dark-default)] hover:text-[color:var(--auxx-chat-text-loud)]'
      )}>
      <X className='size-4' aria-hidden='true' />
    </button>
  )
}
