// packages/chat/src/views/conversation/suggested-replies.tsx
//
// Tap-to-send suggestion chips rendered above the composer while the thread
// has no user messages. Each chip sends its label verbatim as the visitor's
// first message; the strip then disappears because the parent's gate flips.

import { cn } from '~/lib/cn'

interface SuggestedRepliesProps {
  replies: string[]
  onSelect: (reply: string) => void
  disabled?: boolean
}

export function SuggestedReplies({ replies, onSelect, disabled = false }: SuggestedRepliesProps) {
  if (replies.length === 0) return null
  return (
    <div className='flex flex-wrap justify-end gap-2 px-3 pb-2'>
      {replies.map((reply, i) => (
        <button
          key={`${i}-${reply}`}
          type='button'
          disabled={disabled}
          aria-label={reply}
          onClick={() => onSelect(reply)}
          className={cn(
            'rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-sm transition',
            'hover:bg-muted active:scale-[0.98]',
            'disabled:pointer-events-none disabled:opacity-50'
          )}>
          {reply}
        </button>
      ))}
    </div>
  )
}
