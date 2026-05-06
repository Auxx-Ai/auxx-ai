// apps/homepage/src/app/platform/data-model/_components/kb-surface-card.tsx

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

type KbSurfaceCardProps = {
  title: string
  icon: LucideIcon
  bgClass: string
  accentClass?: string
  tone?: 'light' | 'dark'
  children: ReactNode
}

export function KbSurfaceCard({
  title,
  icon: Icon,
  bgClass,
  accentClass,
  tone = 'light',
  children,
}: KbSurfaceCardProps) {
  const isDark = tone === 'dark'
  return (
    <div
      className={cn(
        'group/card relative h-[420px] w-[280px] shrink-0 snap-start overflow-hidden rounded-3xl',
        'md:h-[480px] md:w-[320px]',
        'md:[&:nth-child(2n)]:-mt-[60px]',
        bgClass
      )}>
      <div className='absolute inset-0'>{children}</div>

      <div className='absolute left-8 top-8 flex items-center gap-2'>
        <span
          className={cn(
            'grid size-7 place-items-center rounded-md',
            isDark ? 'bg-white/10 text-white' : 'bg-foreground/10 text-foreground/80',
            accentClass
          )}>
          <Icon className='size-4' />
        </span>
        <span className={cn('text-sm font-medium', isDark ? 'text-white' : 'text-foreground')}>
          {title}
        </span>
      </div>
    </div>
  )
}
