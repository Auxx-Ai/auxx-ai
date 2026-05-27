// packages/chat/src/views/home/cards/recent-message-card.tsx

import { HomeCard } from './card'

interface RecentMessageCardProps {
  subject: string | null
  preview: string
  isInbound: boolean
  timestamp: string
  onOpen: () => void
}

export function RecentMessageCard({
  subject,
  preview,
  isInbound,
  timestamp,
  onOpen,
}: RecentMessageCardProps) {
  const relative = formatRelativeTime(timestamp)
  return (
    <HomeCard onClick={onOpen}>
      <div className='flex items-center justify-between gap-2'>
        <span className='truncate text-sm font-medium text-foreground'>
          {subject || 'Recent conversation'}
        </span>
        <span className='shrink-0 text-xs text-muted-foreground'>{relative}</span>
      </div>
      <span className='truncate text-xs text-muted-foreground'>
        {isInbound ? 'You: ' : ''}
        {preview}
      </span>
    </HomeCard>
  )
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`
  return new Date(t).toLocaleDateString()
}
