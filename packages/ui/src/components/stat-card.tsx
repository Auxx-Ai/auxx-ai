// apps/web/src/components/ui/stat-card.tsx

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

/**
 * StatCard component for displaying a stat with icon, title, value, and description.
 * @param title - The card title
 * @param icon - Optional icon to display next to the title
 * @param iconPosition - Position of the icon ('left' or 'right')
 * @param body - The main value or stat
 * @param description - Description or subtext
 * @param color - Tailwind color class for the title
 * @param first - If true, removes the left border
 * @param loading - If true, displays loading skeleton
 * @param className - Additional CSS classes
 */
interface StatCardProps {
  title: string
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
  body: React.ReactNode
  description?: React.ReactNode | string
  color?: string
  first?: boolean
  loading?: boolean
  className?: string
}

export function StatCard({
  title,
  icon,
  iconPosition = 'left',
  body,
  description,
  color,
  first = false,
  loading = false,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          'hover:bg-primary-100 transition-colors duration-200',
          { 'border-l': !first },
          className
        )}>
        <div className='pt-3 px-3 pb-0'>
          <div className='leading-none tracking-tight text-sm font-medium flex items-center gap-2'>
            <Skeleton className='h-4 w-20' />
          </div>
        </div>
        <div className='pt-1 px-3 pb-3'>
          <div className='text-2xl font-bold'>
            <Skeleton className='h-8 w-12' />
          </div>
          <div className='pt-2 text-xs text-muted-foreground'>
            <Skeleton className='h-3 w-24' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'hover:bg-primary-100 transition-colors duration-200',
        { 'border-l': !first },
        className
      )}>
      <div
        className={cn('pt-3 px-3 pb-0', color, {
          'flex flex-row justify-between': iconPosition === 'right',
        })}>
        <div
          className={cn('leading-none tracking-tight text-sm font-medium flex items-center gap-2')}>
          {iconPosition === 'left' && icon}
          {title}
        </div>
        {iconPosition === 'right' && icon}
      </div>
      <div className='pt-1 px-3 pb-3'>
        <div className='text-2xl font-bold'>{body}</div>
        <div className='text-xs text-muted-foreground'>{description}</div>
      </div>
    </div>
  )
}

/**
 * Individual stat card data interface
 */
export interface StatCardData {
  title: string
  body: React.ReactNode
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
  description?: React.ReactNode | string
  color?: string
  first?: boolean
  className?: string
}

/**
 * StatCards wrapper component for displaying multiple stat cards in a grid layout
 * @param cards - Array of stat card data
 * @param loading - If true, displays loading skeletons for all cards
 * @param className - Additional CSS classes for the grid container
 * @param columns - Responsive column configuration
 */
interface StatCardsProps {
  cards: StatCardData[]
  loading?: boolean
  className?: string
  columns?: { default?: string; sm?: string; md?: string; lg?: string }
}

export function StatCards({
  cards,
  loading = false,
  className,
  columns = { default: 'grid-cols-1', md: 'md:grid-cols-4' },
}: StatCardsProps) {
  const gridClasses = [
    'grid',
    columns.default || 'grid-cols-1',
    columns.sm,
    columns.md || 'md:grid-cols-4',
    columns.lg,
    'bg-primary-50 border-b', // border rounded-t-lg
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cn(gridClasses, className)}>
      {cards.map((card, index) => (
        <StatCard
          key={index}
          title={card.title}
          body={card.body}
          icon={card.icon}
          iconPosition={card.iconPosition}
          description={card.description}
          color={card.color}
          first={card.first ?? index === 0}
          loading={loading}
          className={card.className}
        />
      ))}
    </div>
  )
}
