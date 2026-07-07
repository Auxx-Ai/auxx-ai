// apps/web/src/components/inbox/ui/inbox-channel-placeholder-card.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ListCard } from '@auxx/ui/components/list-card'
import { Link2, Plus } from 'lucide-react'

/**
 * Dashed "Add a channel" card — opens a dropdown to either connect a new channel
 * (the gallery, pre-scoped to this inbox) or connect an existing channel (moving
 * it off its current inbox). The `ListCard` is non-interactive (no `onClick`), so
 * the wrapping `<button>` is the sole interactive element — no nested-interactive
 * / hydration issue.
 */
export function InboxChannelPlaceholderCard({
  onConnectNew,
  onConnectExisting,
}: {
  onConnectNew: () => void
  onConnectExisting: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type='button' className='w-full text-left'>
          <ListCard
            variant='placeholder'
            classNames={{ icon: 'border-dashed' }}
            icon={<Plus className='size-4 text-muted-foreground' />}
            title='Add a channel'
            subtitle='New or existing'
            description='Connect a channel to route its messages into this inbox.'
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuItem onClick={onConnectNew}>
          <Plus /> Connect new channel…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onConnectExisting}>
          <Link2 /> Connect existing channel…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
