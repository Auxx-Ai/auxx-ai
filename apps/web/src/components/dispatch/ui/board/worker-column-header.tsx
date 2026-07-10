// apps/web/src/components/dispatch/ui/board/worker-column-header.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { getInitials } from '~/components/groups/utils/group-utils'

interface WorkerColumnHeaderProps {
  name: string
  image?: string | null
  color?: string
}

/** Day (resource) view column header: avatar + name + the worker's board color. */
export function WorkerColumnHeader({ name, image, color }: WorkerColumnHeaderProps) {
  return (
    <div className='flex items-center gap-1.5'>
      <span
        className='size-2 shrink-0 rounded-full'
        style={{ backgroundColor: color ?? undefined }}
        aria-hidden
      />
      <Avatar className='size-5'>
        <AvatarImage src={image ?? undefined} />
        <AvatarFallback className='text-[9px]'>{getInitials(name)}</AvatarFallback>
      </Avatar>
      <span className='truncate text-sm'>{name}</span>
    </div>
  )
}
