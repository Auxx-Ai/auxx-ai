// apps/web/src/components/apps/app-list-card.tsx

'use client'

import { BadgeCheck, Mail } from 'lucide-react'
import Link from 'next/link'
import type React from 'react'
import { Tooltip } from '~/components/global/tooltip'

interface AppListCardProps {
  title: string
  description: string | null
  href: string
  icon?: React.ReactNode
  subtitle?: string
  verified?: boolean
  badges?: { label?: string; icon?: React.ReactNode }[]
}

/**
 * AppListCard component
 * Displays a card with icon, title, description, and optional badges
 */
export function AppListCard({
  title,
  description,
  href,
  icon,
  subtitle,
  verified,
  badges,
}: AppListCardProps) {
  return (
    <Link href={href} className='rounded-2xl'>
      <div className='rounded-2xl bg-primary-50 flex flex-col p-3 gap-2 border'>
        <div className='flex flex-row items-start justify-between gap-2 w-full'>
          <div className='flex flex-1 flex-row items-start gap-2'>
            <div className='size-8 rounded-xl border flex items-center justify-center overflow-hidden'>
              {icon ?? <Mail className='size-4' />}
            </div>
            <div className='flex flex-col flex-1'>
              <div className='flex flex-1 flex-row justify-between'>
                <div className='flex items-center gap-1 text-sm font-semibold'>
                  {title}
                  {verified && (
                    <Tooltip content='Verified'>
                      <BadgeCheck className='size-4 text-blue-500 shrink-0' />
                    </Tooltip>
                  )}
                </div>
                {badges && badges.length > 0 && (
                  <div className='flex items-center flex-row gap-0.5'>
                    {badges.map((badge, i) => (
                      <div
                        key={i}
                        className='h-5 gap-2 px-1 shrink-0 bg-primary-100 border flex items-center justify-center rounded-lg'>
                        {badge.icon}
                        {badge.label && <span className='text-xs'>{badge.label}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {subtitle && <div className='text-xs text-muted-foreground'>{subtitle}</div>}
            </div>
          </div>
        </div>
        <div className='text-sm text-muted-foreground line-clamp-2'>{description}</div>
      </div>
    </Link>
  )
}
