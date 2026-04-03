// apps/web/src/components/kopilot/ui/blocks/contact-card-block.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { User } from 'lucide-react'
import type { BlockRendererProps } from './block-registry'
import type { ContactCardData } from './block-schemas'

export function ContactCardBlock({ data }: BlockRendererProps<ContactCardData>) {
  const initials = data.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className='not-prose my-2 flex items-center gap-3 rounded-lg border px-3 py-2.5'>
      <Avatar className='size-9'>
        {data.avatarUrl ? <AvatarImage src={data.avatarUrl} alt={data.name} /> : null}
        <AvatarFallback className='text-xs'>
          {initials || <User className='size-4' />}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0 flex-1'>
        <div className='truncate text-sm font-medium'>{data.name}</div>
        <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          {data.email && <span className='truncate'>{data.email}</span>}
          {data.company && (
            <>
              {data.email && <span>·</span>}
              <span className='truncate'>{data.company}</span>
            </>
          )}
        </div>
        {(data.orderCount != null || data.totalSpent) && (
          <div className='mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
            {data.orderCount != null && <span>{data.orderCount} orders</span>}
            {data.totalSpent && (
              <>
                {data.orderCount != null && <span>·</span>}
                <span>{data.totalSpent} total</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
