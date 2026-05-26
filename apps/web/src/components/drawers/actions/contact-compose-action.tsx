// apps/web/src/components/drawers/actions/contact-compose-action.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Mail } from 'lucide-react'
import * as React from 'react'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { Tooltip } from '~/components/global/tooltip'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useCompose } from '~/hooks/use-compose'
import type { DrawerActionProps } from '../drawer-action-registry'

const CONTACT_FIELDS = ['primary_email', 'first_name', 'last_name'] as const

/**
 * Header action for contacts: opens the floating composer with the contact's
 * primary email pre-filled in the To field. Does not close the drawer.
 */
export function ContactComposeAction({ recordId, record }: DrawerActionProps) {
  const { openCompose } = useCompose()

  const { values } = useSystemValues(recordId, [...CONTACT_FIELDS], { autoFetch: true })
  const defaultIntegrationId = useDefaultChannelId()

  const presetValues = React.useMemo<EditorPresetValues | undefined>(() => {
    const email = values.primary_email as string | undefined
    if (!email) return undefined

    const firstName = values.first_name as string | undefined
    const lastName = values.last_name as string | undefined
    const name =
      [firstName, lastName].filter(Boolean).join(' ').trim() ||
      (record?.displayName as string | undefined) ||
      undefined

    return {
      to: [
        {
          id: (record?.id as string | undefined) ?? email,
          identifier: email,
          identifierType: 'EMAIL',
          name,
        },
      ],
      integrationId: defaultIntegrationId,
    }
  }, [values, record?.id, record?.displayName, defaultIntegrationId])

  return (
    <Tooltip content='Compose email' allowInteraction>
      <Button
        variant='ghost'
        size='icon-xs'
        disabled={!presetValues}
        onClick={() => presetValues && openCompose({ presetValues })}>
        <Mail />
      </Button>
    </Tooltip>
  )
}
