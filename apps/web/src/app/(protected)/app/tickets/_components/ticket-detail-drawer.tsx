// apps/web/src/app/(protected)/app/tickets/_components/ticket-detail-drawer.tsx

'use client'

import { useCallback, useState, useEffect } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Button } from '@auxx/ui/components/button'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import {
  OverflowTabsList,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@auxx/ui/components/tabs'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import {
  Calendar,
  Clock,
  Users,
  MessageSquare,
  MessagesSquare,
  ExternalLink,
  Edit,
  Trash2,
  Mail,
  Phone,
  MoreHorizontal,
  TextCursorInput,
  Archive,
  Ticket as TicketIcon,
  Flag,
  CircleDot,
  Hash,
  HouseIcon,
  User,
  Merge,
  Link as LinkIcon,
  Tags,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  TicketPriorityBadge,
  TicketStatusBadge,
  TicketTypeBadge,
} from '~/components/tickets/ticket-badges'
import { getFullName, getInitials } from '@auxx/lib/utils'
import { ContactHoverCard } from '~/components/contacts/contact-hover-card'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import type { Ticket } from './ticket-provider'
import { useRouter } from 'next/navigation'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { Tooltip } from '~/components/global/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'
import EntityFields from '~/components/fields/entity-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { TicketMergeDialog } from './ticket-merge-dialog'
import { TicketLinkDialog } from './ticket-link-dialog'
import { TicketRelationshipsCard } from './ticket-relationships-card'
import { TicketConversations } from './ticket-conversations'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { TimelineTab } from '~/components/timeline'
import { EntityIcon } from '~/components/pickers/icon-picker'

interface TicketDetailDrawerProps {
  ticket: Ticket
  open: boolean
  onOpenChange: (open: boolean) => void
}

const KeyboardShortcut = ({ shortcut }: { shortcut: string }) => (
  <span className="ml-auto pl-2 text-xs text-muted-foreground">{shortcut}</span>
)

/**
 * CustomerCard component - displays customer information in a card format
 */
interface CustomerCardProps {
  contact: Ticket['contact']
  onViewProfile: () => void
  className?: string
}

function CustomerCard({ contact, onViewProfile, className }: CustomerCardProps) {
  // Convert contact to match ContactName type (handle null values)
  const contactName = {
    id: contact.id,
    firstName: contact.firstName ?? undefined,
    lastName: contact.lastName ?? undefined,
    email: contact.email ?? undefined,
    phone: contact.phone ?? undefined,
  }

  return (
    <div
      className={cn(
        'group flex items-center justify-between bg-primary-100/50 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200',
        className
      )}>
      {/* === Customer Cell === */}
      <div className="flex flex-row items-center gap-4">
        <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
          <Avatar className="h-7 w-7 rounded-none shadow-none">
            <AvatarFallback className="rounded-none bg-transparent">
              {getInitials(contactName)}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex flex-col">
          <div className="text-sm font-medium flex flex-row items-center gap-1">
            <span>{getFullName(contactName) || 'Unnamed Customer'}</span>
            <Badge variant="user" className="ml-1" size="xs">
              <User className="size-3" />
              <span>Customer</span>
            </Badge>
          </div>
          <div className="text-muted-foreground text-xs">
            <div className="flex items-center gap-2">
              {contact.email && (
                <>
                  <Mail className="size-3" />
                  <span>{contact.email}</span>
                </>
              )}
              {contact.phone && contact.email && (
                <span className="text-muted-foreground/50">•</span>
              )}
              {contact.phone && (
                <>
                  <Phone className="size-3" />
                  <span>{contact.phone}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === Actions Cell === */}
      <Button variant="outline" size="sm" onClick={onViewProfile}>
        <ExternalLink /> View
      </Button>
    </div>
  )
}

export function TicketDetailDrawer({ ticket, open, onOpenChange }: TicketDetailDrawerProps) {
  const router = useRouter()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const [activeTab, setActiveTab] = useState('overview')
  const [editingTitle, setEditingTitle] = useState(ticket.title || '')
  const [isRenaming, setIsRenaming] = useState(false)
  const [originalTitle, setOriginalTitle] = useState(ticket.title || '')
  const [confirm, ConfirmDialog] = useConfirm()

  // Reset editing title when ticket changes
  useEffect(() => {
    setEditingTitle(ticket.title || '')
    setOriginalTitle(ticket.title || '')
  }, [ticket.title])

  // Get utils for cache invalidation
  const utils = api.useUtils()

  // Fetch all tickets for merge dialog
  const { data: ticketsData } = api.ticket.all.useQuery({})
  const tickets = ticketsData?.tickets || []

  // Fetch ticket with relationships for link dialog
  const { data: ticketWithRelations, refetch: refetchTicket } = api.ticket.byId.useQuery(
    { id: ticket.id },
    { refetchOnWindowFocus: false, retry: 1 }
  )
  const relatedTicketIds =
    ticketWithRelations?.relatedTickets.map((r: any) => r.relatedTicketId) || []

  // Delete mutation
  const deleteTicket = api.ticket.deleteTicket.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      utils.ticket.list.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete ticket',
        description: error.message,
      })
    },
  })

  // Update title mutation
  const updateTicket = api.ticket.update.useMutation({
    onSuccess: () => {
      setIsRenaming(false)
      utils.ticket.list.invalidate()
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      setEditingTitle(originalTitle)
      setIsRenaming(false)
      toastError({
        title: 'Failed to rename ticket',
        description: message,
      })
    },
  })

  const handleRename = async () => {
    const trimmedTitle = editingTitle.trim()

    if (!trimmedTitle) {
      toastError({
        title: 'Invalid title',
        description: 'Title cannot be empty',
      })
      setEditingTitle(originalTitle)
      return
    }

    if (trimmedTitle === originalTitle) {
      setIsRenaming(false)
      return
    }

    setOriginalTitle(ticket.title || '')
    setIsRenaming(true)
    updateTicket.mutateAsync({
      id: ticket.id,
      title: trimmedTitle,
    })
  }

  const handleTitleBlur = () => {
    handleRename()
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingTitle(originalTitle)
      setIsRenaming(false)
    }
  }

  const handleOpenInNewTab = useCallback(() => {
    window.open(`/app/tickets/${ticket.id}`, '_blank')
  }, [ticket.id])

  const handleEdit = useCallback(() => {
    router.push(`/app/tickets/${ticket.id}/edit`)
    onOpenChange(false)
  }, [ticket.id, router, onOpenChange])

  const handleReply = useCallback(() => {
    router.push(`/app/tickets/${ticket.id}#reply`)
    onOpenChange(false)
  }, [ticket.id, router, onOpenChange])

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete Ticket',
      description: `Are you sure you want to delete ticket #${ticket.number}? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteTicket.mutate({ ticketId: ticket.id })
    }
  }, [confirm, deleteTicket, ticket.id, ticket.number])

  const handleArchive = useCallback(() => {
    toastSuccess({
      title: 'Archive feature',
      description: 'Archive functionality will be implemented soon.',
    })
  }, [])

  /** Handle close */
  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  if (!ticket) return null

  return (
    <>
      <DockableDrawer
        open={open}
        onOpenChange={onOpenChange}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={350}
        maxWidth={600}
        title={`Ticket #${ticket.number} - ${ticket.title}`}>
        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col rounded-t-xl">
          <DrawerHeader
            icon={<EntityIcon iconId="ticket" color="blue" className="size-6" />}
            title={
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  #{ticket.number}
                </span>
                <Input
                  id="title"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  placeholder="Enter title"
                  disabled={isRenaming || updateTicket.isPending}
                  className={cn(
                    'flex-1 h-7 min-w-0 w-full appearance-none rounded-md border bg-transparent px-1 outline-none',
                    'border-transparent',
                    'focus:shadow-xs',
                    (isRenaming || updateTicket.isPending) && 'opacity-50 cursor-not-allowed'
                  )}
                />
              </div>
            }
            onClose={handleClose}
            actions={
              <>
                <Tooltip content="Open in new tab">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full"
                    onClick={handleOpenInNewTab}>
                    <ExternalLink />
                  </Button>
                </Tooltip>
                <Tooltip content="Reply">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full"
                    onClick={handleReply}>
                    <MessageSquare />
                  </Button>
                </Tooltip>

                <ManualTriggerButton
                  resourceType="ticket"
                  resourceId={ticket.id}
                  buttonVariant="ghost"
                  buttonSize="icon-sm"
                  buttonClassName="rounded-full"
                  tooltipContent="Trigger workflow"
                />

                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="rounded-full">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={handleEdit}>
                      <Edit />
                      Edit ticket
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => {
                        const input = document.getElementById('title') as HTMLInputElement
                        if (input) {
                          input.focus()
                          input.select()
                        }
                      }}>
                      <TextCursorInput />
                      Rename
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={handleArchive}>
                      <Archive />
                      Archive
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <TicketMergeDialog
                      tickets={tickets}
                      primaryTicketId={ticket.id}
                      onMergeComplete={() => {
                        utils.ticket.list.invalidate()
                        onOpenChange(false)
                      }}
                      trigger={
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                          <Merge />
                          Merge ticket
                        </DropdownMenuItem>
                      }
                    />

                    <TicketLinkDialog
                      ticketId={ticket.id}
                      relatedTicketIds={relatedTicketIds}
                      onSuccess={() => {
                        refetchTicket()
                        utils.ticket.list.invalidate()
                      }}
                      trigger={
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                          <LinkIcon />
                          Link ticket
                        </DropdownMenuItem>
                      }
                    />

                    <DropdownMenuSeparator />

                    <DropdownMenuItem onClick={handleDelete} variant="destructive">
                      <Trash2 />
                      Delete
                      <KeyboardShortcut shortcut="Del" />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DockToggleButton />
              </>
            }
          />

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 border-b">
            {/* Type & Priority */}
            <div className="border-r border-b">
              <CardContent className="py-2">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Tags className="size-4 text-muted-foreground" />
                    <TicketStatusBadge status={ticket.status} />
                  </div>

                  <div className="flex items-center gap-2">
                    <CircleDot className="size-4 text-muted-foreground" />
                    <TicketTypeBadge type={ticket.type} closed={ticket.status === 'CLOSED'} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Flag className="size-4 text-muted-foreground" />
                    <TicketPriorityBadge
                      priority={ticket.priority}
                      closed={ticket.status === 'CLOSED'}
                    />
                  </div>
                </div>
              </CardContent>
            </div>

            {/* Assignments */}
            <div className="border-b">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Assigned To
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex items-start gap-2">
                  <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    {ticket.assignments.length > 0 ? (
                      <div className="space-y-1">
                        {ticket.assignments.map((assignment) => (
                          <div key={assignment.id} className="text-sm">
                            {assignment.agent.name || assignment.agent.email}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unassigned</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </div>

            {/* Created Date */}
            <div className="border-r">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Created</CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-semibold">
                      {format(new Date(ticket.createdAt), 'MMM d, yyyy')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>

            {/* Updated Date */}
            <div>
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Last Updated
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-semibold">
                      {format(new Date(ticket.updatedAt), 'MMM d, yyyy')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <OverflowTabsList
              tabs={[
                { value: 'overview', label: 'Overview', icon: TicketIcon },
                { value: 'conversations', label: 'Conversations', icon: MessagesSquare },
                { value: 'timeline', label: 'Timeline', icon: Clock },
                { value: 'comments', label: 'Comments', icon: MessageSquare },
              ]}
              value={activeTab}
              onValueChange={setActiveTab}
              variant="outline"
            />

            {/* Details Tab */}
            <TabsContent value="overview" className="flex-1 flex flex-col min-h-0 ">
              {/* Ticket Fields */}
              <div className="space-y-4 p-4">
                <div className="space-y-1">
                  <h4 className="text-sm ">Information</h4>

                  <EntityFields modelType={ModelTypes.TICKET} entityId={ticket.id} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm ">Customer</h4>
                  <CustomerCard
                    contact={ticket.contact}
                    onViewProfile={() => router.push(`/app/contacts/${ticket.contact.id}`)}
                  />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm ">Related Tickets</h4>
                  <TicketRelationshipsCard ticketId={ticket.id} />
                </div>
              </div>
            </TabsContent>

            {/* Conversations Tab */}
            <TabsContent value="conversations" className="flex-1 flex flex-col min-h-0">
              <TicketConversations ticketId={ticket.id} ticket={ticket} />
            </TabsContent>

            {/* Timeline Tab */}
            <TabsContent value="timeline" className="flex-1 flex flex-col min-h-0">
              <TimelineTab entityType="ticket" entityId={ticket.id} />
            </TabsContent>

            {/* Comments Tab */}
            <TabsContent value="comments" className="flex-1 flex flex-col h-full">
              <DrawerComments
                entityId={ticket.id}
                entityType="Ticket"
                emptyTitle="No internal notes yet"
                emptyDescription="Add internal notes to collaborate with your team on this ticket"
                headerTitle="Internal Notes"
                composerPlaceholder="Add internal note..."
              />
            </TabsContent>
          </Tabs>
        </div>
      </DockableDrawer>
      <ConfirmDialog />
    </>
  )
}
