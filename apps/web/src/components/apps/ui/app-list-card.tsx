// apps/web/src/components/apps/ui/app-list-card.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { BadgeCheck, Mail, MoreVertical } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { Tooltip } from '~/components/global/tooltip'

export interface AppListCardMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

interface AppListCardProps {
  title: string
  description: string | null
  href?: string
  onClick?: () => void
  disabled?: boolean
  icon?: React.ReactNode
  subtitle?: string
  verified?: boolean
  badges?: { label?: string; icon?: React.ReactNode }[]
  /** Optional actions shown in a hover-revealed three-dot dropdown in the top-right. */
  menuItems?: AppListCardMenuItem[]
}

/**
 * AppListCard component
 * Displays a card with icon, title, description, and optional badges. Pass
 * either `href` (renders as a link) or `onClick` (renders as a button).
 * Pass `menuItems` to add a three-dot dropdown; the card then renders as a
 * clickable div so the trigger isn't nested inside a link/button.
 */
export function AppListCard({
  title,
  description,
  href,
  onClick,
  disabled,
  icon,
  subtitle,
  verified,
  badges,
  menuItems,
}: AppListCardProps) {
  const router = useRouter()
  const hasMenu = !!menuItems?.length

  const cardClass =
    'rounded-2xl bg-primary-50 hover:bg-primary-50/50 hover:outline-5 hover:outline-primary-50 flex flex-col p-3 gap-2 border text-left disabled:opacity-60 disabled:cursor-not-allowed'

  const body = (
    <>
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
    </>
  )

  if (hasMenu) {
    return (
      <div
        className={`${cardClass} cursor-pointer group/app-card relative`}
        onClick={() => {
          if (disabled) return
          if (onClick) onClick()
          else if (href) router.push(href)
        }}>
        {body}
        <div className='absolute bottom-2 right-2'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='opacity-0 group-hover/app-card:opacity-100 duration-300 data-[state=open]:opacity-100! data-[state=open]:bg-muted! transition-opacity rounded-lg'
                variant='ghost'
                size='icon-xs'
                onClick={(e) => e.stopPropagation()}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
              {menuItems?.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  onClick={item.onClick}
                  disabled={item.disabled}
                  variant={item.destructive ? 'destructive' : undefined}>
                  {item.icon}
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  if (onClick) {
    return (
      <button type='button' onClick={onClick} disabled={disabled} className={cardClass}>
        {body}
      </button>
    )
  }

  return (
    <Link href={href ?? '#'} className={cardClass}>
      {body}
    </Link>
  )
}
