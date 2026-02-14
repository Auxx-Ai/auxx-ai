// apps/web/src/components/dynamic-table/components/copyable-link-cell.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useCallback, useState } from 'react'

/** Props for CopyableLinkCell component */
interface CopyableLinkCellProps {
  /** The display text */
  displayText: string
  /** The value to copy (and use for href) */
  value: string
  /** Type of link - determines href prefix */
  type: 'email' | 'url' | 'phone'
  /** Additional className */
  className?: string
}

/**
 * Copyable link cell with hover-to-reveal action buttons
 * Uses mask-based animation for smooth reveal effect
 * Cell click triggers editing (handled by parent), buttons handle navigation
 */
export function CopyableLinkCell({ displayText, value, type, className }: CopyableLinkCellProps) {
  const [copied, setCopied] = useState(false)

  /** Handle copy to clipboard */
  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [value]
  )

  /** Handle external link click */
  const handleExternalClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const href = type === 'email' ? `mailto:${value}` : type === 'phone' ? `tel:${value}` : value
      if (type === 'url') {
        window.open(href, '_blank')
      } else {
        window.location.href = href
      }
    },
    [type, value]
  )

  // All types show external button, so always 2 buttons
  const maskWidth = '50px'

  return (
    <div className={cn('group/link w-fit relative max-w-full overflow-hidden', className)}>
      {/* Content with hover background */}
      <div className='group-hover/link:bg-primary-50 rounded-md flex items-center w-full px-1 '>
        <span className='whitespace-nowrap truncate cursor-default'>{displayText}</span>
      </div>

      {/* Gradient fade + buttons - slides in from right */}
      <div
        style={{ '--btn-width': maskWidth } as React.CSSProperties}
        className='absolute inset-y-0 right-0 flex items-center translate-x-[calc(var(--btn-width)+8px)] group-hover/link:translate-x-0 transition-transform duration-200 ease-out'>
        {/* Gradient fade overlay */}
        <div className='w-4 h-full bg-gradient-to-r from-transparent to-primary-50 opacity-0 group-hover/link:opacity-100 transition-opacity duration-200' />
        {/* Buttons */}
        <div className='flex items-center gap-0.5 bg-primary-50 pr-0.5'>
          <button
            onClick={handleExternalClick}
            className={cn(
              'size-5 flex items-center justify-center',
              'text-muted-foreground hover:text-foreground',
              'rounded hover:bg-primary-200'
            )}
            title={type === 'email' ? 'Send email' : type === 'phone' ? 'Call' : 'Open link'}>
            <ExternalLink className='size-3' />
          </button>
          <button
            onClick={handleCopy}
            className={cn(
              'size-5 flex items-center justify-center',
              'text-muted-foreground hover:text-foreground',
              'rounded hover:bg-primary-200'
            )}
            title='Copy to clipboard'>
            {copied ? <Check className='size-3 text-green-600' /> : <Copy className='size-3' />}
          </button>
        </div>
      </div>
    </div>
  )
}
