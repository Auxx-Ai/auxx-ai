'use client'

// apps/web/src/components/contacts/drawer/contact-drawer.tsx

import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Expand, Mail, MessagesSquare, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'
import { useCommentAccess } from '~/components/global/comments/use-comment-access'
import { Tooltip } from '~/components/global/tooltip'
import { KopilotContext } from '~/components/kopilot/context'
import { KopilotSuggestion } from '~/components/kopilot/suggestions'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { RecordIdentityHeader } from '~/components/records/ui/record-identity-header'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { type RecordMeta, toRecordId, useRecord } from '~/components/resources'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { useCompose } from '~/hooks/use-compose'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'

/** The contact columns this drawer reads off the record store's untyped `[key: string]` bag. */
interface ContactRecord extends RecordMeta {
  email?: string | null
}

interface ContactDrawerProps {
  /** Whether the drawer is open (for controlled usage) */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  contactId: string | null
  /** Optional handler invoked when deleting the contact */
  onDeleteContact?: (contactId: string) => Promise<void> | void
}

/**
 * ContactDrawer renders the right-side contact detail drawer with tabbed content.
 * Supports both overlay and docked modes.
 * Now uses BaseEntityDrawer with registry-based configuration.
 */
export function ContactDrawer({
  open,
  onOpenChange,
  contactId,
  onDeleteContact,
}: ContactDrawerProps) {
  const { openCompose } = useCompose()
  const router = useRouter()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Counter that signals the comments composer to focus when incremented.
  const [focusComposerTrigger, setFocusComposerTrigger] = React.useState(0)

  // Create recordId for use throughout component
  const recordId = React.useMemo(
    () => (contactId ? toRecordId('contact', contactId) : null),
    [contactId]
  )
  const { canCompose } = useCommentAccess(recordId)

  // Restricted (read-only) mode, resolved per ROW from the contact's own `_access`
  // stamp. Called above the early return below so the hook order stays stable.
  const readOnly = useRecordDrawerReadOnly('contact', contactId ?? undefined)

  // Get record data for contact-specific UI
  const { record: contact } = useRecord<ContactRecord>({
    recordId,
    enabled: !!open && !!contactId,
  })

  // Memoize preset values for email compose
  const presetValues = React.useMemo<EditorPresetValues | undefined>(() => {
    if (!contact) return undefined

    // Get the primary email from contact
    const primaryEmail = contact.email
    if (!primaryEmail) return undefined

    return {
      to: [
        {
          id: contact.id,
          identifier: primaryEmail,
          identifierType: 'EMAIL',
          name: contact.displayName || undefined,
        },
      ],
    }
  }, [contact])

  /** Handle close button click */
  const handleClose = React.useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  /** Handle create note - switch to comments tab and focus composer */
  const handleCreateNoteClick = React.useCallback(() => {
    setFocusComposerTrigger((prev) => prev + 1)
  }, [])

  // `recordId` is null exactly when `contactId` is — listing it keeps the non-null narrowing
  // available to the header actions below.
  if (!open || !contactId || !recordId) return null

  const contactLabel = contact?.displayName ?? undefined

  return (
    <>
      <KopilotContext activeContactId={contactId} activeContactLabel={contactLabel} />
      <KopilotSuggestion
        text='Recent tickets from this contact'
        icon='history'
        priority={10}
        autoSubmit
      />
      <KopilotSuggestion text='Summarize this contact' icon='sparkle' autoSubmit />
      <KopilotSuggestion text='Draft a follow-up email' icon='reply' />
      <BaseEntityDrawer
        recordId={recordId}
        open={open}
        onOpenChange={onOpenChange ?? (() => {})}
        entityType='contact'
        isDocked={isDocked}
        dockedWidth={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={800}
        readOnly={readOnly}
        focusComposerTrigger={focusComposerTrigger}
        onClose={handleClose}
        headerIcon={<EntityIcon iconId='circle-user' color='indigo' className='size-6' />}
        headerTitle='Contact'
        headerActions={
          <>
            <Button
              variant='ghost'
              size='xs'
              disabled={!presetValues}
              onClick={() => presetValues && openCompose({ presetValues })}>
              <Mail />
              Compose
            </Button>
            {canCompose && (
              <Tooltip content='Create note'>
                <Button variant='ghost' size='icon-xs' onClick={handleCreateNoteClick}>
                  <MessagesSquare />
                </Button>
              </Tooltip>
            )}
            <Tooltip content='View full page'>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => router.push(`/app/contacts/${contactId}`)}>
                <Expand />
              </Button>
            </Tooltip>
            <ManualTriggerButton
              recordId={recordId}
              buttonVariant='ghost'
              buttonSize='icon-sm'
              buttonClassName='rounded-full'
              tooltipContent='Trigger workflow'
            />
            <Tooltip content='Delete contact'>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => {
                  if (onDeleteContact) {
                    void onDeleteContact(contactId)
                  }
                }}>
                <Trash className='text-bad-500' />
              </Button>
            </Tooltip>
          </>
        }
        cardContent={<RecordIdentityHeader recordId={recordId} readOnly={readOnly} />}
      />
    </>
  )
}
