// app/tickets/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { Textarea } from '@auxx/ui/components/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  ArrowLeft,
  Clock,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle,
  ArchiveIcon,
  Trash2,
  Reply,
  Notebook,
  Merge,
  Trash,
  MoreVertical,
  Edit,
  HouseIcon,
  PanelsTopLeftIcon,
  BoxIcon,
  TicketIcon,
  Timer,
  User,
  Loader2,
} from 'lucide-react'

import {
  TicketPriorityBadge,
  TicketStatusBadge,
  TicketTypeBadge,
} from '../../../../../components/tickets/ticket-badges'
import { Badge } from '@auxx/ui/components/badge'
import { Switch } from '@auxx/ui/components/switch'
import { Label } from '@auxx/ui/components/label'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { api } from '~/trpc/react'
// import { MultiSelectUsers } from '~/components/tickets/MultiSelectUsers'
import TicketNotes from './ticket-notes'
import { Tooltip } from '~/components/global/tooltip'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { TicketRelationships } from './ticket-relationships'
import { TicketMergeDialog } from './ticket-merge-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import Link from 'next/link'
import TicketMessage from './ticket-message'
import TicketReplyBox from './ticket-reply-box'
import { MultiSelectUsers } from '~/components/global/multi-select-users'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@auxx/ui/components/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ScrollArea, ScrollBar } from '@auxx/ui/components/scroll-area'

// Enum values
const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_CUSTOMER: 'WAITING_FOR_CUSTOMER',
  WAITING_FOR_THIRD_PARTY: 'WAITING_FOR_THIRD_PARTY',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
}

const TicketPriority = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', URGENT: 'URGENT' }

export default function TicketDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [showAddNotes, setShowAddNotes] = useState(false)
  const [isMergeOpen, setIsMergeOpen] = useState(false)
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const [selectedAssignees, setSelectedAssignees] = useState<{ value: string; label: string }[]>([])

  // Fetch ticket data
  const {
    data: ticket,
    isLoading,
    error,
    refetch,
  } = api.ticket.byId.useQuery({ id: ticketId }, { refetchOnWindowFocus: false, retry: 1 })
  const { data: ticketsData } = api.ticket.all.useQuery({})
  const tickets = ticketsData?.tickets || []

  // Mutations
  const updateStatus = api.ticket.updateStatus.useMutation({ onSuccess: () => refetch() })

  const updatePriority = api.ticket.updatePriority.useMutation({ onSuccess: () => refetch() })

  const updateAssignment = api.ticket.updateAssignment.useMutation({ onSuccess: () => refetch() })

  const deleteTicket = api.ticket.deleteTicket.useMutation({
    onSuccess: () => {
      router.push('/app/tickets/list')
    },
  })

  // Initialize the selected assignees from ticket data when available
  useEffect(() => {
    if (ticket?.assignments?.length) {
      const assigneeOptions = ticket.assignments.map((assignment) => ({
        value: assignment.agent?.id,
        label:
          assignment.agent?.name || assignment.agent?.email || assignment.agent?.id || 'Unknown',
      }))
      // console.log()
      setSelectedAssignees(assigneeOptions)
    }
  }, [ticket?.assignments])

  // Handle changes
  const handleStatusChange = async (status: string) => {
    await updateStatus.mutateAsync({ id: ticketId, status: status as any })
  }

  const handlePriorityChange = async (priority: string) => {
    await updatePriority.mutateAsync({ id: ticketId, priority: priority as any })
  }

  const handleAssignmentChange = async (options: { value: string; label: string }[]) => {
    // Filter out special options like 'UNASSIGNED' or 'ME'
    const agentIds = options
      .filter((option) => option.value !== 'UNASSIGNED' && option.value !== 'ME')
      .map((option) => option.value)
    // console.log('handle change', agentIds)
    await updateAssignment.mutateAsync({ ticketId, agentIds })
  }

  const handleCloseTicket = async () => {
    await updateStatus.mutateAsync({ id: ticketId, status: 'CLOSED' })
  }

  const handleDeleteTicket = async () => {
    try {
      await deleteTicket.mutateAsync({ ticketId })
    } catch (error) {
      console.error('Error deleting ticket:', error)
    }
  }

  // Loading state
  if (isLoading) {
    return <TicketDetailSkeleton />
  }

  // Error state
  if (error || !ticket) {
    return (
      <div className="container mx-auto py-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to tickets
        </Button>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error?.message || 'Ticket not found'}</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Get type-specific case details from unified typeData
  const hasTypeSpecificData = ticket.typeData && Object.keys(ticket.typeData).length > 0

  return (
    <div className="">
      <div className="flex items-center p-4">
        <h1 className="text-2xl font-bold">Ticket {ticket.number}</h1>
        <div className="ml-4 space-x-2">
          <TicketTypeBadge type={ticket.type} />
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </div>
      </div>

      <div>
        {/* Ticket Menu Options */}
        <Separator className="" />
        <div className="flex items-center bg-slate-50 p-2 dark:bg-black">
          <div className="flex items-center gap-2">
            <Tooltip content="Go Back">
              <Button variant="outline" size="sm" onClick={() => router.back()} className="px-2">
                <ArrowLeft />
              </Button>
            </Tooltip>

            <Tooltip content={showReplyForm ? 'Hide Reply' : 'Reply'}>
              <Button
                variant={showReplyForm ? 'outline-solid' : 'info'}
                size="sm"
                onClick={() => setShowReplyForm((prev) => !prev)}>
                <Reply className="h-4 w-4" />
                {showReplyForm ? 'Hide' : 'Reply'}
              </Button>
            </Tooltip>
            <Tooltip content="Write a note">
              <Button variant="outline" size="sm" onClick={() => setShowAddNotes(true)}>
                <Notebook />
                Add Note
              </Button>
            </Tooltip>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Tooltip content="Close ticket">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCloseTicket}
                disabled={updateStatus.isPending}>
                <CheckCircle />
                Close
              </Button>
            </Tooltip>
            <TicketMergeDialog tickets={tickets} open={isMergeOpen} primaryTicketId={ticket.id} />

            <Tooltip content="Merge tickets">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsMergeOpen(true)
                }}>
                <Merge />
              </Button>
            </Tooltip>
            <Tooltip content="Delete ticket">
              <Button variant="outline" size="icon-sm" onClick={() => setIsDeleteDialogOpen(true)}>
                <Trash />
                <span className="sr-only">Delete</span>
              </Button>
            </Tooltip>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Tooltip content="More options">
              <div className="relative">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm">
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/app/tickets/${ticket.id}/edit`}>
                        <Edit />
                        Edit
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <MoreVertical />
                      More options
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Tooltip>
          </div>
        </div>
        <Separator className="" />
      </div>

      {/* Ticket Detail Section */}
      <div className="h-[calc(100vh-114px)] overflow-y-auto">
        <div className="grid h-full grid-cols-1 md:grid-cols-3">
          <div className="flex flex-1 md:col-span-2">
            <div className="flex flex-1 flex-col">
              {/* Show thread details (from, subject, date) */}
              <div className="flex items-start p-4">
                <div className="flex items-start gap-4 text-sm">
                  <Avatar>
                    <AvatarImage alt={ticket.contact.firstName || 'Customer'} />
                    <AvatarFallback>
                      {(
                        ticket.contact.firstName?.substring(0, 1) ||
                        ticket.contact.email?.substring(0, 1) ||
                        'C'
                      ).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid gap-1">
                    <div className="font-semibold">{ticket.title}</div>
                    <div className="line-clamp-1 text-xs">
                      <span className="font-medium">Reported by</span>{' '}
                      {ticket.createdBy?.name || 'Customer'}{' '}
                      <span className="font-medium">via Mail</span>
                    </div>
                    <div className="line-clamp-1 text-xs">
                      {ticket.description || (
                        <span className="italic text-muted-foreground">
                          No description provided
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(ticket.createdAt), "PPP 'at' p")}
                </div>
              </div>
              <Separator />

              {/* Message Thread */}
              <div className="flex flex-1 flex-col overflow-y-scroll bg-opacity-10 bg-dots-sm text-gray-200 dark:text-gray-200/30">
                <div className="flex flex-col gap-4 p-6 text-card-foreground">
                  {/* Display all replies */}
                  {ticket.replies && ticket.replies.length > 0 ? (
                    ticket.replies.map((reply) => <TicketMessage key={reply.id} reply={reply} />)
                  ) : (
                    <div className="py-6 text-center text-muted-foreground">
                      <p>No messages in this ticket yet.</p>
                    </div>
                  )}
                  {/* Reply Box */}
                  <div className="">
                    {showReplyForm ? (
                      <TicketReplyBox
                        ticket={ticket}
                        onSuccess={() => {
                          refetch()
                          setShowReplyForm(false)
                        }}
                        onCancel={() => setShowReplyForm(false)}
                      />
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full border-dashed py-6"
                        onClick={() => setShowReplyForm(true)}>
                        <Reply />
                        Click to write a reply
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Type-specific Case Details */}
            {hasTypeSpecificData && (
              <Card className="m-3 mb-6">
                <CardHeader>
                  <CardTitle>Case Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* Render different fields based on ticket type using unified typeData */}
                    {ticket.type === 'MISSING_ITEM' && ticket.typeData && (
                      <>
                        {ticket.typeData.orderId && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order ID</div>
                            <div>{ticket.typeData.orderId}</div>
                          </div>
                        )}
                        {ticket.typeData.orderDate && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order Date</div>
                            <div>{format(new Date(ticket.typeData.orderDate), 'PPP')}</div>
                          </div>
                        )}
                        {ticket.typeData.missingItems &&
                          Array.isArray(ticket.typeData.missingItems) && (
                            <div className="md:col-span-2">
                              <div className="mb-1 text-sm font-medium">Missing Items</div>
                              <ul className="list-disc space-y-1 pl-5">
                                {ticket.typeData.missingItems.map((item: any, index: number) => (
                                  <li key={index}>
                                    {item.name} (Qty: {item.quantity}){' '}
                                    {item.sku && `- SKU: ${item.sku}`}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        {ticket.typeData.replacementSent !== undefined && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Replacement Sent</div>
                            <div>{ticket.typeData.replacementSent ? 'Yes' : 'No'}</div>
                          </div>
                        )}
                      </>
                    )}

                    {ticket.type === 'SHIPPING_ISSUE' && ticket.typeData && (
                      <>
                        {ticket.typeData.orderId && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order ID</div>
                            <div>{ticket.typeData.orderId}</div>
                          </div>
                        )}
                        {ticket.typeData.orderDate && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order Date</div>
                            <div>{format(new Date(ticket.typeData.orderDate), 'PPP')}</div>
                          </div>
                        )}
                        {ticket.typeData.trackingNumber && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Tracking Number</div>
                            <div>{ticket.typeData.trackingNumber}</div>
                          </div>
                        )}
                        {ticket.typeData.carrier && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Carrier</div>
                            <div>{ticket.typeData.carrier}</div>
                          </div>
                        )}
                        {ticket.typeData.issue && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-sm font-medium">Issue</div>
                            <div>{ticket.typeData.issue}</div>
                          </div>
                        )}
                      </>
                    )}

                    {ticket.type === 'REFUND' && ticket.typeData && (
                      <>
                        {ticket.typeData.orderId && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order ID</div>
                            <div>{ticket.typeData.orderId}</div>
                          </div>
                        )}
                        {ticket.typeData.orderDate && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order Date</div>
                            <div>{format(new Date(ticket.typeData.orderDate), 'PPP')}</div>
                          </div>
                        )}
                        {ticket.typeData.refundAmount && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Refund Amount</div>
                            <div>${ticket.typeData.refundAmount}</div>
                          </div>
                        )}
                        {ticket.typeData.refundStatus && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Refund Status</div>
                            <div>{ticket.typeData.refundStatus}</div>
                          </div>
                        )}
                        {ticket.typeData.refundReason && (
                          <div className="md:col-span-2">
                            <div className="mb-1 text-sm font-medium">Refund Reason</div>
                            <div>{ticket.typeData.refundReason}</div>
                          </div>
                        )}
                      </>
                    )}

                    {ticket.type === 'RETURN' && ticket.typeData && (
                      <>
                        {ticket.typeData.orderId && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order ID</div>
                            <div>{ticket.typeData.orderId}</div>
                          </div>
                        )}
                        {ticket.typeData.orderDate && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Order Date</div>
                            <div>{format(new Date(ticket.typeData.orderDate), 'PPP')}</div>
                          </div>
                        )}
                        {ticket.typeData.returnItems &&
                          Array.isArray(ticket.typeData.returnItems) && (
                            <div className="md:col-span-2">
                              <div className="mb-1 text-sm font-medium">Return Items</div>
                              <ul className="list-disc space-y-1 pl-5">
                                {ticket.typeData.returnItems.map((item: any, index: number) => (
                                  <li key={index}>
                                    {item.name} (Qty: {item.quantity}){' '}
                                    {item.reason && `- Reason: ${item.reason}`}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        {ticket.typeData.returnStatus && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Return Status</div>
                            <div>{ticket.typeData.returnStatus}</div>
                          </div>
                        )}
                        {ticket.typeData.returnTrackingNumber && (
                          <div>
                            <div className="mb-1 text-sm font-medium">Return Tracking Number</div>
                            <div>{ticket.typeData.returnTrackingNumber}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="border-l border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-black md:col-span-1">
            <div className="flex justify-center p-3">
              <Tabs defaultValue="tab-1" className="w-full">
                <ScrollArea>
                  <TabsList className="mb-3">
                    <TabsTrigger value="tab-1">
                      <TicketIcon
                        className="-ms-0.5 me-1.5 opacity-60"
                        size={16}
                        aria-hidden="true"
                      />
                      Properties
                    </TabsTrigger>
                    <TabsTrigger value="tab-2" className="group">
                      <Timer className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
                      Timeline
                      {ticket.notes && ticket.notes.length > 0 && (
                        <Badge
                          className="ms-1.5 min-w-5 bg-primary/15 px-1 transition-opacity group-data-[state=inactive]:opacity-50"
                          variant="secondary">
                          {ticket.notes.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="tab-3" className="group">
                      <User className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
                      Customer
                    </TabsTrigger>
                  </TabsList>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
                <TabsContent value="tab-1" className="pt-2">
                  <div className="pb-3">
                    <div className="flex items-center gap-2">
                      <TicketIcon
                        className="text-muted-foreground/70"
                        size={20}
                        aria-hidden="true"
                      />
                      <h2 className="text-sm font-medium">Ticket Details</h2>
                    </div>
                  </div>
                  <div className="-mt-px">
                    {/* Content group */}
                    <div className="relative py-5 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-linear-to-r before:from-black/[0.06] before:via-black/10 before:to-black/[0.06]">
                      {/* <h3 className='mb-4 text-xs font-medium uppercase text-muted-foreground/80'>
                        Chat presets
                      </h3> */}
                      <div className="space-y-4">
                        {/* Model */}
                        <div className="flex items-center justify-between gap-2">
                          <Label className="font-normal">Status</Label>
                          <div className="flex items-center gap-2">
                            <Select
                              value={ticket.status}
                              onValueChange={handleStatusChange}
                              disabled={updateStatus.isPending}>
                              <SelectTrigger className="h-7 w-auto max-w-full gap-1 bg-background px-4 py-1 [&_svg]:-me-1">
                                <SelectValue placeholder="Select Status" />
                              </SelectTrigger>
                              <SelectContent className="[&_*[role=option]>span]:end-2 [&_*[role=option]>span]:start-auto [&_*[role=option]]:pe-8 [&_*[role=option]]:ps-2">
                                {Object.values(TicketStatus).map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {status.replace(/_/g, ' ')}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {updateStatus.isPending && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                <Loader2 className="animate-spin" size={16} />
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Priority */}
                        <div className="mb-5 flex items-center justify-between gap-2">
                          <Label className="font-normal">Priority</Label>
                          <div className="flex items-center gap-2">
                            <Select
                              value={ticket.priority}
                              onValueChange={handlePriorityChange}
                              disabled={updatePriority.isPending}>
                              <SelectTrigger className="h-7 w-auto max-w-full gap-1 bg-background px-4 py-1 [&_svg]:-me-1">
                                <SelectValue placeholder="Select Priority" />
                              </SelectTrigger>
                              <SelectContent className="[&_*[role=option]>span]:end-2 [&_*[role=option]>span]:start-auto [&_*[role=option]]:pe-8 [&_*[role=option]]:ps-2">
                                {Object.values(TicketPriority).map((priority) => (
                                  <SelectItem key={priority} value={priority}>
                                    {priority}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {updatePriority.isPending && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                <Loader2 className="animate-spin" size={16} />
                              </div>
                            )}
                          </div>
                        </div>

                        <Separator className="" />

                        {/* Agents */}
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <MultiSelectUsers
                              value={selectedAssignees}
                              onChange={(options) => {
                                setSelectedAssignees(options)
                                handleAssignmentChange(options)
                              }}
                              placeholder="Select assignees"
                            />

                            {updateAssignment.isPending && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                <Loader2 className="animate-spin" size={16} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* {(ticket.dueDate || ticket.resolvedAt || ticket.closedAt) && (
                    <Separator />
                  )} */}
                  <div className="relative py-5 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-linear-to-r before:from-black/[0.06] before:via-black/10 before:to-black/[0.06]">
                    {ticket.dueDate && (
                      <div className="flex items-center justify-between gap-2">
                        <Label className="font-normal">Due Date</Label>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center text-sm text-amber-500">
                            <Clock className="mr-2 h-4 w-4" />
                            {format(new Date(ticket.dueDate), 'MMM d, yyyy')}
                          </div>
                        </div>
                      </div>
                    )}

                    {ticket.resolvedAt && (
                      <div>
                        <div className="mb-1 text-sm font-medium">Resolved</div>
                        <div className="flex items-center text-sm text-green-500">
                          <CheckCircle className="mr-2 h-4 w-4" />
                          {format(new Date(ticket.resolvedAt), 'MMM d, yyyy')}
                        </div>
                      </div>
                    )}

                    {ticket.closedAt && (
                      <div className="flex items-center justify-between gap-2">
                        <Label className="font-normal">Closed</Label>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center text-sm text-amber-500">
                            <ArchiveIcon className="mr-2 h-4 w-4" />
                            {format(new Date(ticket.closedAt), 'MMM d, yyyy')}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <Separator className="" />
                  {/* Related Tickets */}
                  <div className="mt-6">
                    <TicketRelationships ticket={ticket} />
                  </div>
                </TabsContent>
                <TabsContent value="tab-2" className="pt-2">
                  {/* Notes */}
                  <div className="pb-3">
                    <div className="flex items-center gap-2">
                      <Timer className="text-muted-foreground/70" size={20} aria-hidden="true" />
                      <h2 className="text-sm font-medium">Notes & Activity</h2>
                    </div>
                  </div>
                  <div className="-mt-px">
                    {/* Content group */}
                    <div className="relative py-5 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-linear-to-r before:from-black/[0.06] before:via-black/10 before:to-black/[0.06]">
                      <h3 className="align-center mb-4 flex justify-between">
                        <span className="text-xs font-medium uppercase text-muted-foreground/80">
                          Notes & Activity
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setShowAddNotes((showAddNotes) => !showAddNotes)}>
                          Add Note
                        </Button>
                      </h3>
                    </div>
                  </div>

                  <TicketNotes
                    ticket={ticket}
                    onSubmit={() => refetch()}
                    showAddNotes={showAddNotes}
                  />
                </TabsContent>
                <TabsContent value="tab-3" className="pt-2">
                  {/* Customer Info */}
                  <Card className="pt-4">
                    <VisuallyHidden>
                      <CardHeader>
                        <CardTitle>Customer Details</CardTitle>
                      </CardHeader>
                    </VisuallyHidden>
                    <CardContent className="space-y-6">
                      <div>
                        <div className="mb-1 text-sm font-medium">Customer</div>
                        <div className="flex items-center">
                          <Avatar className="mr-2 h-8 w-8">
                            <AvatarFallback>
                              {ticket.contact.firstName?.substring(0, 2) ||
                                ticket.contact?.email?.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div>{ticket.contact.firstName || 'No name'}</div>
                            <div className="text-sm text-muted-foreground">
                              {ticket.contact.email}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this ticket?</AlertDialogTitle>
            <AlertDescription>
              This action cannot be undone. This will permanently delete the ticket and all
              associated data including replies, notes, and assignments.
            </AlertDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTicket}
              disabled={deleteTicket.isPending}>
              {deleteTicket.isPending ? 'Deleting...' : 'Delete Ticket'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Skeleton loader component
function TicketDetailSkeleton() {
  const router = useRouter()
  return (
    <div className="">
      <div className="flex items-center p-4">
        <Skeleton className="h-8 w-64" />
        <div className="ml-4 flex space-x-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-32" />
        </div>
      </div>
      <Separator className="" />
      <div className="flex items-center bg-slate-50 p-2 dark:bg-black">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()} className="px-2">
            <ArrowLeft />
          </Button>
          <Skeleton className="h-8 w-60" />
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Skeleton className="h-8 w-64" />
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      <Separator className="" />
      <div className="container mx-auto py-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <Skeleton className="mb-2 h-8 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Status & Priority</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
