// apps/web/src/components/drawers/actions/contact-compose-action.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Mail } from 'lucide-react'
import * as React from 'react'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { Tooltip } from '~/components/global/tooltip'
import { toEmailAddressList } from '~/components/mail/email-address-list'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useCompose } from '~/hooks/use-compose'
import type { DrawerActionProps } from '../drawer-action-registry'

const CONTACT_FIELDS = ['primary_email', 'first_name', 'last_name'] as const

/**
 * Header action for contacts: opens the floating composer with the contact's
 * email pre-filled in the To field. Multi-value contacts get an address
 * dropdown (primary first); a single address composes directly; no address
 * disables the button. Does not close the drawer.
 */
export function ContactComposeAction({ recordId, record }: DrawerActionProps) {
  const { openCompose } = useCompose()

  const { values } = useSystemValues(recordId, [...CONTACT_FIELDS], { autoFetch: true })
  const defaultIntegrationId = useDefaultChannelId()

  // Ordered address list — index 0 is the primary.
  const emails = React.useMemo(() => toEmailAddressList(values.primary_email), [values])

  const name = React.useMemo(() => {
    const firstName = values.first_name as string | undefined
    const lastName = values.last_name as string | undefined
    return (
      [firstName, lastName].filter(Boolean).join(' ').trim() ||
      (record?.displayName as string | undefined) ||
      undefined
    )
  }, [values, record?.displayName])

  const composeTo = React.useCallback(
    (email: string) => {
      const presetValues: EditorPresetValues = {
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
      openCompose({ presetValues })
    },
    [record?.id, name, defaultIntegrationId, openCompose]
  )

  // >1 address: pick which one to compose to.
  if (emails.length > 1) {
    return (
      <DropdownMenu>
        <Tooltip content='Compose email' allowInteraction>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon-xs'>
              <Mail />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align='end'>
          {emails.map((email) => (
            <DropdownMenuItem key={email} onSelect={() => composeTo(email)}>
              <Mail />
              {email}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const primary = emails[0]

  return (
    <Tooltip content='Compose email' allowInteraction>
      <Button
        variant='ghost'
        size='icon-xs'
        disabled={!primary}
        onClick={() => primary && composeTo(primary)}>
        <Mail />
      </Button>
    </Tooltip>
  )
}
