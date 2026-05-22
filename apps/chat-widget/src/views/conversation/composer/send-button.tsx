// apps/chat-widget/src/views/conversation/composer/send-button.tsx

import { SendHorizontal } from 'lucide-react'
import { cn } from '~/lib/cn'

interface SendButtonProps {
  onClick: () => void
  disabled: boolean
  loading: boolean
}

export function SendButton({ onClick, disabled, loading }: SendButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled || loading}
      title='Send'
      className={cn(
        'flex size-8 items-center justify-center rounded-full bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] transition-opacity disabled:opacity-40'
      )}>
      {loading ? (
        <span
          className='size-3 animate-spin rounded-full border-2 border-current border-t-transparent'
          aria-hidden='true'
        />
      ) : (
        <SendHorizontal className='size-4' aria-hidden='true' />
      )}
    </button>
  )
}
