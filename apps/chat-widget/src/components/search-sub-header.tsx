// apps/chat-widget/src/components/search-sub-header.tsx
//
// Reusable sub-header that hosts a search input. Lives directly under the
// FrameHeader so views can render a sticky search bar above their scroll
// containers. Intentionally dumb: value/onChange/placeholder. Debounce and
// fetching live in the consumer so different views can wire their own
// behavior without forking the bar.

import { Search, X } from 'lucide-react'
import type { JSX } from 'preact'
import { useCallback } from 'preact/hooks'
import { cn } from '~/lib/cn'

interface SearchSubHeaderProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

export function SearchSubHeader({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus,
  className,
}: SearchSubHeaderProps) {
  const handleInput = useCallback(
    (e: JSX.TargetedEvent<HTMLInputElement>) => {
      onChange(e.currentTarget.value)
    },
    [onChange]
  )
  const handleKeyDown = useCallback(
    (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && value) {
        e.preventDefault()
        onChange('')
      }
    },
    [value, onChange]
  )
  const handleClear = useCallback(() => onChange(''), [onChange])

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-[color:var(--auxx-chat-hairline)] px-3 py-2',
        className
      )}>
      <div className='relative flex flex-1 items-center'>
        <Search
          className='pointer-events-none absolute left-2.5 size-4 text-muted-foreground'
          aria-hidden='true'
        />
        <input
          type='text'
          value={value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete='off'
          autoCorrect='off'
          spellcheck={false}
          className='h-9 w-full rounded-md border border-[color:var(--auxx-chat-hairline)] bg-[color:var(--auxx-chat-surface-loud)] pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30'
        />
        {value ? (
          <button
            type='button'
            onClick={handleClear}
            aria-label='Clear search'
            className='absolute right-2 flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[color:var(--auxx-chat-surface-loud)] hover:text-foreground'>
            <X className='size-3.5' aria-hidden='true' />
          </button>
        ) : null}
      </div>
    </div>
  )
}
