'use client'
// apps/web/src/components/contacts/drawer/contact-drawer.tsx

import * as React from 'react'
import { Expand, Mail, MessagesSquare, Trash, User } from 'lucide-react'
import { getFullName } from '@auxx/utils/contact'
import { formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'

import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { useRecord, toResourceId } from '~/components/resources'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tooltip } from '~/components/global/tooltip'
import NewMessageDialog from '~/components/mail/email-editor/new-message-dialog'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { EntityIcon } from '@auxx/ui/components/icons'
import { BaseEntityDrawer } from '~/components/drawers/base-entity-drawer'

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
  const router = useRouter()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Counter that signals the comments composer to focus when incremented.
  const [focusComposerTrigger, setFocusComposerTrigger] = React.useState(0)

  // Create resourceId for use throughout component
  const resourceId = React.useMemo(
    () => (contactId ? toResourceId('contact', contactId) : null),
    [contactId]
  )

  // Get record data for contact-specific UI
  const { record: contact } = useRecord({
    resourceId,
    enabled: !!open && !!contactId,
  })

  // Memoize the createdAt text to avoid recalculating on every render
  const createdAtText = React.useMemo(
    () =>
      contact
        ? `Created ${formatDistanceToNow(new Date(contact.createdAt), { addSuffix: true })}`
        : null,
    [contact]
  )

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
          name: getFullName(contact) || undefined,
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

  if (!open || !contactId) return null

  return (
    <BaseEntityDrawer
      resourceId={resourceId}
      open={open}
      onOpenChange={onOpenChange ?? (() => {})}
      entityType="contact"
      isDocked={isDocked}
      dockedWidth={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      focusComposerTrigger={focusComposerTrigger}
      onClose={handleClose}
      headerIcon={<EntityIcon iconId="circle-user" color="indigo" className="size-6" />}
      headerTitle="Contact"
      headerActions={
        <>
          <NewMessageDialog
            trigger={
              <Button variant="ghost" size="xs" disabled={!presetValues}>
                <Mail />
                Compose
              </Button>
            }
            presetValues={presetValues}
          />
          <Tooltip content="Create note">
            <Button variant="ghost" size="icon-xs" onClick={handleCreateNoteClick}>
              <MessagesSquare />
            </Button>
          </Tooltip>
          <Tooltip content="View full page">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => router.push(`/app/contacts/${contactId}`)}>
              <Expand />
            </Button>
          </Tooltip>
          <ManualTriggerButton
            resourceType="contact"
            resourceId={resourceId}
            buttonVariant="ghost"
            buttonSize="icon-sm"
            buttonClassName="rounded-full"
            tooltipContent="Trigger workflow"
          />
          <Tooltip content="Delete contact">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                if (onDeleteContact) {
                  void onDeleteContact(contactId)
                }
              }}>
              <Trash className="text-bad-500" />
            </Button>
          </Tooltip>
          <DockToggleButton />
        </>
      }
      cardContent={
        <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
          <div className="size-10 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
            <User className="size-6 text-neutral-500 dark:text-foreground" />
          </div>
          <div className="flex flex-col align-start w-full">
            <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
              {contact ? getFullName(contact) : <Skeleton className="h-6 w-80 mb-1" />}
            </div>
            <div className="text-xs text-neutral-500 truncate">
              {contact ? <>{createdAtText}</> : <Skeleton className="h-4 w-40" />}
            </div>
          </div>
        </div>
      }
    />
  )
}
