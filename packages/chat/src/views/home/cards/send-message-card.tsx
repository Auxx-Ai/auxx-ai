// packages/chat/src/views/home/cards/send-message-card.tsx

import { MessageSquarePlus } from 'lucide-react'
import { HomeCard } from './card'

interface SendMessageCardProps {
  onClick: () => void
  isPending: boolean
}

export function SendMessageCard({ onClick, isPending }: SendMessageCardProps) {
  return (
    <HomeCard onClick={onClick} disabled={isPending}>
      <div className='flex items-center gap-2'>
        <MessageSquarePlus className='size-4 shrink-0 text-primary' aria-hidden='true' />
        <span className='text-sm font-medium text-foreground'>
          {isPending ? 'Starting…' : 'Send us a message'}
        </span>
      </div>
      <span className='text-xs text-muted-foreground'>We usually reply within a few minutes.</span>
    </HomeCard>
  )
}
