// apps/web/src/components/drawers/actions/ticket-reply-action.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { MessageSquare } from 'lucide-react'
import { useChannels } from '~/components/channels/hooks/use-channels'
import { Tooltip } from '~/components/global/tooltip'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useCompose } from '~/hooks/use-compose'
import type { DrawerActionProps } from '../drawer-action-registry'

const TICKET_FIELDS = ['ticket_title'] as const

/**
 * Header action for tickets: opens the floating composer pre-filled with the
 * ticket's subject and linked to this ticket on send. Does not close the drawer.
 */
export function TicketReplyAction({ recordId, entityInstanceId, record }: DrawerActionProps) {
  const { openCompose } = useCompose()

  const { values } = useSystemValues(recordId, [...TICKET_FIELDS], { autoFetch: true })
  const channels = useChannels()
  const defaultIntegrationId = channels[0]?.id

  const handleClick = () => {
    const title =
      (values.ticket_title as string | undefined) ?? (record?.displayName as string | undefined)
    const presetValues: EditorPresetValues = {
      subject: title ? String(title) : '',
      linkTicketId: entityInstanceId,
      integrationId: defaultIntegrationId,
    }
    openCompose({ presetValues })
  }

  return (
    <Tooltip content='Reply' allowInteraction>
      <Button variant='ghost' size='icon-xs' onClick={handleClick}>
        <MessageSquare />
      </Button>
    </Tooltip>
  )
}
