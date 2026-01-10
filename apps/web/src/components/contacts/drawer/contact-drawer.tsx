'use client'
// apps/web/src/components/contacts/drawer/contact-drawer.tsx

import * as React from 'react'
import {
  Clock,
  Expand,
  HouseIcon,
  Mail,
  MessagesSquare,
  Package,
  ShoppingBag,
  Ticket,
  Trash,
  User,
} from 'lucide-react'
import { getFullName } from '@auxx/utils/contact'
import { formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'

import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { OverflowTabsList, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { api } from '~/trpc/react'
import { useRecordWithFetch } from '~/components/resources'
import { useQueryState } from 'nuqs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import EntityFields from '../../fields/entity-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import DrawerTickets from './drawer-tickets'
import DrawerOrders from './drawer-orders'
import DrawerConversations from './drawer-conversations'
import DrawerParts from './drawer-parts'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { TimelineTab } from '~/components/timeline'
import { Tooltip } from '~/components/global/tooltip'
import NewMessageDialog from '~/components/mail/email-editor/new-message-dialog'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'

// Memoized tab content components
const MemoEntityFields = React.memo(EntityFields)
const MemoDrawerTickets = React.memo(DrawerTickets)
const MemoDrawerOrders = React.memo(DrawerOrders)
const MemoDrawerConversations = React.memo(DrawerConversations)
const MemoDrawerComments = React.memo(DrawerComments)
const MemoTimelineTab = React.memo(TimelineTab)
const MemoDrawerParts = React.memo(DrawerParts)

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
 */
export function ContactDrawer({
  open,
  onOpenChange,
  contactId,
  onDeleteContact,
}: ContactDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })

  // Counter that signals the comments composer to focus when incremented.
  const [focusComposerTrigger, setFocusComposerTrigger] = React.useState(0)

  // Handle switching to the comments tab and focusing the composer
  const handleCreateNoteClick = React.useCallback(() => {
    if (activeTab !== 'comments') {
      void setActiveTab('comments')
    }
    setFocusComposerTrigger((prev) => prev + 1)
  }, [activeTab, setActiveTab])

  // Try record cache first (populated by batch fetcher when list loads)
  const { record: contact, isLoading: isCacheLoading } = useRecordWithFetch({
    resourceType: 'contact',
    id: contactId,
    enabled: !!open && !!contactId,
  })
  // Fall back to API if not in cache (for fields not included in batch fetch)
  // const { data: apiContact } = api.contact.getById.useQuery(
  //   { id: contactId! },
  //   {
  //     enabled: !!open && !!contactId && !cachedContact,
  //     staleTime: 30_000,
  //   }
  // )

  // Use cached contact if available, otherwise fall back to API response
  // const contact = cachedContact

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

  if (!open || !contactId) return null

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange ?? (() => {})}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      title="Contact">
      <ContactDrawerContent
        contactId={contactId}
        contact={contact}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        createdAtText={createdAtText}
        presetValues={presetValues}
        focusComposerTrigger={focusComposerTrigger}
        onCreateNoteClick={handleCreateNoteClick}
        onDeleteContact={onDeleteContact}
        onClose={handleClose}
      />
    </DockableDrawer>
  )
}

/**
 * Props for ContactDrawerContent
 */
interface ContactDrawerContentProps {
  contactId: string
  contact: ReturnType<typeof api.contact.getById.useQuery>['data']
  activeTab: string
  onTabChange: (tab: string) => void
  createdAtText: string | null
  presetValues: EditorPresetValues | undefined
  focusComposerTrigger: number
  onCreateNoteClick: () => void
  onDeleteContact?: (contactId: string) => Promise<void> | void
  onClose: () => void
}

/**
 * Inner content component for ContactDrawer - used in both overlay and docked modes
 */
function ContactDrawerContent({
  contactId,
  contact,
  activeTab,
  onTabChange,
  createdAtText,
  presetValues,
  focusComposerTrigger,
  onCreateNoteClick,
  onDeleteContact,
  onClose,
}: ContactDrawerContentProps) {
  const router = useRouter()

  return (
    <>
      <DrawerHeader
        icon={<EntityIcon iconId="circle-user" color="indigo" className="size-6" />}
        title="Contact"
        onClose={onClose}
        actions={
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
              <Button variant="ghost" size="icon-xs" onClick={onCreateNoteClick}>
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
              resourceId={contactId}
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
      />
      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full h-full">
          <div className="w-full h-full flex gap-0">
            <div className="w-full h-full flex flex-col overflow-auto justify-start">
              <OverflowTabsList
                tabs={[
                  { value: 'overview', label: 'Overview', icon: HouseIcon },
                  { value: 'timeline', label: 'Timeline', icon: Clock },
                  { value: 'comments', label: 'Comments', icon: MessagesSquare },
                  { value: 'tickets', label: 'Tickets', icon: Ticket },
                  { value: 'orders', label: 'Orders', icon: ShoppingBag },
                  { value: 'conversations', label: 'Conversations', icon: Mail },
                  { value: 'parts', label: 'Parts', icon: Package },
                ]}
                value={activeTab}
                onValueChange={onTabChange}
                variant="outline"
              />
              {/* Person Card */}
              <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
                <div className="size-10 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
                  <User className="size-6 text-neutral-500 dark:text-foreground" />
                </div>
                <div className="flex flex-col align-start w-full">
                  <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
                    {contact ? (
                      getFullName(contact)
                    ) : (
                      <div className="mb-1">
                        <Skeleton className="h-6 w-80" />
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {contact ? <>{createdAtText}</> : <Skeleton className="h-4 w-40" />}
                  </div>
                </div>
              </div>
              <div className="flex flex-1 overflow-hidden">
                <TabsContent value="overview" className="w-full">
                  <ScrollArea className="flex-1">
                    <Section
                      title="Details"
                      initialOpen
                      collapsible={false}
                      icon={<HouseIcon className="size-4" />}>
                      <MemoEntityFields modelType={ModelTypes.CONTACT} entityId={contact?.id} />
                    </Section>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="tickets" className="w-full">
                  <ScrollArea className="flex-1">
                    <MemoDrawerTickets contactId={contactId} />
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="orders" className="w-full">
                  <ScrollArea className="flex-1">
                    <MemoDrawerOrders contactId={contactId} />
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="conversations" className="w-full h-full mt-0">
                  <ScrollArea className="flex-1">
                    <MemoDrawerConversations contactId={contactId} />
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="comments" className="w-full h-full mt-0">
                  <ScrollArea className="flex-1">
                    <MemoDrawerComments
                      entityId={contactId}
                      entityType="Contact"
                      focusComposerTrigger={focusComposerTrigger}
                    />
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="timeline" className="w-full h-full mt-0 ">
                  <ScrollArea className="flex-1">
                    <div className="p-3 flex-1 flex-col flex">
                      <MemoTimelineTab entityType="contact" entityId={contactId} />
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="parts" className="w-full">
                  <ScrollArea className="flex-1">
                    <MemoDrawerParts contactId={contactId} />
                  </ScrollArea>
                </TabsContent>
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </>
  )
}
