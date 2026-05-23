// apps/chat-widget/src/views/home/cards/card.tsx
//
// Shared visual primitive for the Home tab card stack.

import { ChevronRight } from 'lucide-react'
import type { ComponentChildren } from 'preact'
import { cn } from '~/lib/cn'

interface HomeCardProps {
  onClick?: () => void
  disabled?: boolean
  children: ComponentChildren
  className?: string
  /** When true, shows a trailing chevron — purely decorative. */
  showChevron?: boolean
}

export function HomeCard({
  onClick,
  disabled,
  children,
  className,
  showChevron = true,
}: HomeCardProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border border-[color:var(--auxx-chat-hairline)] bg-card px-3 py-3 text-left transition-colors hover:bg-[color:var(--auxx-chat-surface-loud)] disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>{children}</div>
      {showChevron ? (
        <ChevronRight
          className='size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5'
          aria-hidden='true'
        />
      ) : null}
    </button>
  )
}
