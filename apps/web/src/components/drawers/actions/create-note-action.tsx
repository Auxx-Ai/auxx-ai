// apps/web/src/components/drawers/actions/create-note-action.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { MessagesSquare } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { Tooltip } from '~/components/global/tooltip'
import type { DrawerActionProps } from '../drawer-action-registry'

/**
 * Generic header action: switches to the Comments tab and focuses the composer.
 */
export function CreateNoteAction({ onCreateNote }: DrawerActionProps) {
  const [, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })

  const handleClick = () => {
    void setActiveTab('comments')
    onCreateNote()
  }

  return (
    <Tooltip content='Create note' allowInteraction>
      <Button variant='ghost' size='icon-xs' onClick={handleClick}>
        <MessagesSquare />
      </Button>
    </Tooltip>
  )
}
