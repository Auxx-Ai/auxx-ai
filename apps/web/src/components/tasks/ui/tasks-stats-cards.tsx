// apps/web/src/components/tasks/ui/tasks-stats-cards.tsx

'use client'

import type { TaskStats } from '@auxx/lib/tasks/client'
import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { AlertTriangle, Clock, ListTodo, UserX } from 'lucide-react'

interface TasksStatsCardsProps {
  stats: TaskStats | null
}

/**
 * Component displaying task statistics in card format
 */
export function TasksStatsCards({ stats }: TasksStatsCardsProps) {
  const cards: StatCardData[] = [
    {
      title: 'Open',
      body: stats?.open.toString() || '0',
      icon: <ListTodo className='size-4' />,
      description: 'Active tasks',
      color: 'text-accent-500',
      iconPosition: 'right',
    },
    {
      title: 'Due Today',
      body: stats?.dueToday.toString() || '0',
      icon: <Clock className='size-4' />,
      description: 'Tasks due today',
      color: 'text-comparison-500',
      iconPosition: 'right',
    },
    {
      title: 'Overdue',
      body: stats?.overdue.toString() || '0',
      icon: <AlertTriangle className='size-4' />,
      description: stats && stats.overdue > 0 ? 'Needs attention' : 'All on track',
      color: 'text-bad-500',
      iconPosition: 'right',
    },
    {
      title: 'Unassigned',
      body: stats?.unassigned.toString() || '0',
      icon: <UserX className='size-4' />,
      description: stats && stats.unassigned > 0 ? 'Needs an owner' : 'All assigned',
      color: 'text-good-500',
      iconPosition: 'right',
    },
  ]

  return <StatCards cards={cards} loading={!stats} />
}
