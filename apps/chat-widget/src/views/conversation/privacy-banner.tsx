// apps/chat-widget/src/views/conversation/privacy-banner.tsx
//
// One-line consent notice rendered beneath the composer's textarea container.
// Visible when the widget has a configured `privacyPolicyUrl` and the visitor
// has not previously dismissed it for this channel.

import { X } from 'lucide-react'

interface PrivacyBannerProps {
  url: string
  onDismiss: () => void
}

export function PrivacyBanner({ url, onDismiss }: PrivacyBannerProps) {
  return (
    <div className='mx-3 mb-2 flex items-start gap-2 text-[11px] leading-snug text-muted-foreground'>
      <p className='flex-1'>
        By chatting with us, you agree to our{' '}
        <a
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          className='underline underline-offset-2 hover:text-foreground'>
          Privacy Policy
        </a>
        . Your personal data may be processed per this policy and/or our data processing agreement
        with the customer entity you are contacting us from.
      </p>
      <button
        type='button'
        aria-label='Dismiss privacy notice'
        onClick={onDismiss}
        className='shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'>
        <X className='size-3' />
      </button>
    </div>
  )
}
