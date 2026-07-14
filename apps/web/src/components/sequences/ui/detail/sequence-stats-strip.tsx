// apps/web/src/components/sequences/ui/detail/sequence-stats-strip.tsx
'use client'

import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { CheckCircle, MailWarning, Play, Reply, UserRound, UserRoundX, XCircle } from 'lucide-react'
import { api } from '~/trpc/react'

interface SequenceStatsStripProps {
  sequenceId: string
}

const asPercent = (rate: number) => `${Math.round(rate * 100)}%`

/**
 * Compact one-row stats strip under the detail header — enrolled / active /
 * completed / exited / failed / reply rate / bounce rate, mirroring the
 * workflows landing page's `StatCards` usage.
 */
export function SequenceStatsStrip({ sequenceId }: SequenceStatsStripProps) {
  const { data: stats, isLoading } = api.sequence.stats.useQuery({ sequenceId })

  const cards: StatCardData[] = [
    {
      title: 'Enrolled',
      body: stats?.enrolled ?? 0,
      icon: <UserRound className='size-4' />,
      color: 'text-blue-500',
    },
    {
      title: 'Active',
      body: stats?.active ?? 0,
      icon: <Play className='size-4' />,
      color: 'text-comparison-500',
    },
    {
      title: 'Completed',
      body: stats?.completed ?? 0,
      icon: <CheckCircle className='size-4' />,
      color: 'text-good-500',
    },
    {
      title: 'Exited',
      body: stats?.exited ?? 0,
      icon: <UserRoundX className='size-4' />,
      color: 'text-muted-foreground',
    },
    {
      title: 'Failed',
      body: stats?.failed ?? 0,
      icon: <XCircle className='size-4' />,
      color: 'text-bad-500',
    },
    {
      title: 'Reply rate',
      body: asPercent(stats?.replyRate ?? 0),
      icon: <Reply className='size-4' />,
      color: 'text-good-500',
    },
    {
      title: 'Bounce rate',
      body: asPercent(stats?.bounceRate ?? 0),
      icon: <MailWarning className='size-4' />,
      color: 'text-amber-500',
    },
  ]

  return (
    <StatCards
      cards={cards}
      loading={isLoading}
      columns={{ default: 'grid-cols-2', md: 'md:grid-cols-7' }}
      className='border-b bg-primary-50'
    />
  )
}
