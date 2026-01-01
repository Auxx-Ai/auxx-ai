// apps/web/src/app/(protected)/app/tickets/_components/ticket-management.tsx

'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import { DynamicTable, createCustomFieldColumns } from '~/components/dynamic-table'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import type { VisibilityState } from '@tanstack/react-table'
import { EmptyState } from '~/components/global/empty-state'
import {
  Ticket as TicketIcon,
  Plus,
  Trash2,
  Users,
  CircleDot,
  Flag,
  Filter,
  Play,
} from 'lucide-react'
import { useTicketProvider } from './ticket-provider'
import { TicketDetailDrawer } from './ticket-detail-drawer'
import { createTicketColumns } from './ticket-columns'
import type { Ticket } from './ticket-provider'
import { useConfirm } from '~/hooks/use-confirm'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import TicketForm from './new-ticket-form'
import { MassAssignDialog } from './dialog-mass-assign'
import { MassStatusDialog } from './dialog-mass-status'
import { MassPriorityDialog } from './dialog-mass-priority'
import { MassDeleteDialog } from './dialog-mass-deleting'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useInView } from 'react-intersection-observer'
import { parseAsBoolean, useQueryState } from 'nuqs'
import { Toggle } from '@auxx/ui/components/toggle'
import { useAllResources } from '~/components/resources'
import { useCustomFieldValueSyncer } from '~/hooks/use-custom-field-value-syncer'

interface TicketManagementProps {
  /**
   * Optional callback when a ticket is selected.
   * When provided, the drawer will NOT be rendered internally - parent handles it.
   */
  onTicketSelect?: (ticket: Ticket) => void
}

export function TicketManagement({ onTicketSelect }: TicketManagementProps = {}) {
  const router = useRouter()
  const {
    tickets,
    isTicketsLoading,
    ticketFilter,
    setTicketFilter,
    deleteTicket,
    updateTicketStatus,
    updateTicketPriority,
    updateTicketAssignments,
    refetch,
    refetchTickets,
    totalTickets,
    createDialogOpen,
    setCreateDialogOpen,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useTicketProvider()

  // Internal drawer state - only used when onTicketSelect is not provided
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)

  // Determine if drawer is managed externally
  const isExternalDrawer = !!onTicketSelect
  const [selectedTicketsForBulk, setSelectedTicketsForBulk] = useState<Ticket[]>([])
  const [massAssignDialogOpen, setMassAssignDialogOpen] = useState(false)
  const [massStatusDialogOpen, setMassStatusDialogOpen] = useState(false)
  const [massPriorityDialogOpen, setMassPriorityDialogOpen] = useState(false)
  const [massDeleteDialogOpen, setMassDeleteDialogOpen] = useState(false)
  const [massWorkflowDialogOpen, setMassWorkflowDialogOpen] = useState(false)
  const [showFilter, setShowFilter] = useQueryState('filter', parseAsBoolean.withDefault(false))
  const [confirm, ConfirmDialog] = useConfirm()
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // Get custom fields from ResourceProvider (single source of truth)
  const { resources } = useAllResources()
  const customFieldsRef = useRef<(typeof resources)[0]['fields']>([])
  const customFields = useMemo(() => {
    const ticketResource = resources.find((r) => r.id === 'ticket')
    if (!ticketResource) return customFieldsRef.current

    const newFields = ticketResource.fields.filter((f) => f.id)

    // Only update ref if field IDs have changed
    const prevIds = customFieldsRef.current.map((f) => f.id).join(',')
    const newIds = newFields.map((f) => f.id).join(',')
    if (prevIds !== newIds) {
      customFieldsRef.current = newFields
    }

    return customFieldsRef.current
  }, [resources])

  // Row IDs for syncer
  const rowIds = useMemo(() => tickets.map((t) => t.id), [tickets])

  // Custom field column IDs
  const customFieldColumnIds = useMemo(
    () => customFields.map((f) => `customField_${f.id}`),
    [customFields]
  )

  // Custom field value syncer
  const { getValue, isValueLoading } = useCustomFieldValueSyncer({
    resourceType: 'ticket',
    rowIds,
    columnVisibility,
    customFieldColumnIds,
    enabled: customFields.length > 0,
  })

  // Infinite scroll observer
  const { ref: loadMoreRef, inView } = useInView()

  // Load more when scrolling to bottom
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage?.()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Handle ticket actions
  const handleViewDetails = useCallback(
    (ticket: Ticket) => {
      if (onTicketSelect) {
        onTicketSelect(ticket)
      } else {
        setSelectedTicket(ticket)
        setDetailDrawerOpen(true)
      }
    },
    [onTicketSelect]
  )

  const handleEdit = useCallback(
    (ticket: Ticket) => {
      router.push(`/app/tickets/${ticket.id}/edit`)
    },
    [router]
  )

  const handleDelete = useCallback(
    async (ticket: Ticket) => {
      const confirmed = await confirm({
        title: 'Delete Ticket',
        description: `Are you sure you want to delete ticket #${ticket.number}? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        try {
          await deleteTicket(ticket.id)
        } catch (error) {
          toastError({
            title: 'Failed to delete ticket',
            description: error instanceof Error ? error.message : 'An error occurred',
          })
        }
      }
    },
    [confirm, deleteTicket]
  )

  const handleAssign = useCallback((ticket: Ticket) => {
    setSelectedTicketsForBulk([ticket])
    setMassAssignDialogOpen(true)
  }, [])

  const handleReply = useCallback(
    (ticket: Ticket) => {
      router.push(`/app/tickets/${ticket.id}#reply`)
    },
    [router]
  )

  // Handle bulk delete
  const handleBulkDelete = useCallback(async (selectedTickets: Ticket[]) => {
    setSelectedTicketsForBulk(selectedTickets)
    setMassDeleteDialogOpen(true)
  }, [])

  // Handle bulk workflow
  const handleBulkWorkflow = useCallback(async (selectedTickets: Ticket[]) => {
    setSelectedTicketsForBulk(selectedTickets)
    setMassWorkflowDialogOpen(true)
  }, [])

  // Bulk actions configuration
  const bulkActions = useMemo(
    () => [
      {
        label: 'Run workflow',
        icon: Play,
        variant: 'outline' as const,
        action: handleBulkWorkflow,
        disabled: () => false,
      },
      {
        label: 'Assign',
        icon: Users,
        variant: 'outline' as const,

        action: async (selectedTickets: Ticket[]) => {
          setSelectedTicketsForBulk(selectedTickets)
          setMassAssignDialogOpen(true)
        },
      },
      {
        label: 'Change Status',
        icon: CircleDot,
        variant: 'outline' as const,

        action: async (selectedTickets: Ticket[]) => {
          setSelectedTicketsForBulk(selectedTickets)
          setMassStatusDialogOpen(true)
        },
      },
      {
        label: 'Change Priority',
        icon: Flag,
        variant: 'outline' as const,

        action: async (selectedTickets: Ticket[]) => {
          setSelectedTicketsForBulk(selectedTickets)
          setMassPriorityDialogOpen(true)
        },
      },
      {
        label: 'Delete Selected',
        icon: Trash2,
        variant: 'destructive' as const,
        action: handleBulkDelete,
        disabled: () => false,
      },
    ],
    [handleBulkWorkflow, handleBulkDelete]
  )

  // Column definitions with custom fields
  const columns = useMemo(() => {
    const standardColumns = createTicketColumns({
      onViewDetails: handleViewDetails,
      onEdit: handleEdit,
      onDelete: handleDelete,
      onAssign: handleAssign,
      onReply: handleReply,
    })

    // Add custom field columns using the syncer
    if (customFields.length === 0) {
      return standardColumns
    }

    const customCols = createCustomFieldColumns<Ticket>(customFields, {
      getValue,
      isValueLoading,
    })

    // Insert custom fields before the actions column (last column)
    const actionsColumn = standardColumns[standardColumns.length - 1]!
    const otherColumns = standardColumns.slice(0, -1)
    return [...otherColumns, ...customCols, actionsColumn] as ExtendedColumnDef<Ticket>[]
  }, [
    handleViewDetails,
    handleEdit,
    handleDelete,
    handleAssign,
    handleReply,
    customFields,
    getValue,
    isValueLoading,
  ])

  // Handle row click - open drawer instead of navigating
  const handleRowClick = useCallback(
    (ticket: Ticket) => {
      if (onTicketSelect) {
        onTicketSelect(ticket)
      } else {
        setSelectedTicket(ticket)
        setDetailDrawerOpen(true)
      }
    },
    [onTicketSelect]
  )

  // Handle export
  const handleExport = useCallback(() => {
    toastSuccess({
      title: 'Export started',
      description: 'Ticket list export will be available soon.',
    })
  }, [])

  // Custom toolbar with filter toggle
  const customToolbar = (
    <div className="flex items-center gap-2 px-3 py-2">
      <Toggle
        className="data-[state=on]:border-ring"
        aria-label="Filter tickets"
        pressed={showFilter}
        onPressedChange={setShowFilter}>
        <Filter size={16} aria-hidden="true" />
        Filters
      </Toggle>
    </div>
  )

  return (
    <>
      <DynamicTable<Ticket>
        tableId="tickets"
        className="h-full"
        columns={columns}
        data={tickets}
        isLoading={isTicketsLoading}
        bulkActions={bulkActions}
        onRowSelectionChange={() => {}}
        onExport={handleExport}
        importHref="/app/tickets/import"
        enableSearch
        onRefresh={refetch}
        searchPlaceholder="Search tickets..."
        searchKeys={['number', 'title', 'description']}
        onColumnVisibilityChange={setColumnVisibility}
        emptyState={
          <EmptyState
            icon={TicketIcon}
            title="No tickets found"
            description={
              Object.keys(ticketFilter).length > 0
                ? 'Try adjusting your filters to find tickets.'
                : 'Create your first ticket to get started.'
            }
            button={
              Object.keys(ticketFilter).length === 0 ? (
                <Button onClick={() => setCreateDialogOpen(true)} variant="outline">
                  <Plus />
                  Create Ticket
                </Button>
              ) : undefined
            }
          />
        }
      />

      {/* Load more trigger for infinite scroll */}
      {hasNextPage && (
        <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
          {isFetchingNextPage && (
            <span className="text-sm text-muted-foreground">Loading more...</span>
          )}
        </div>
      )}

      {/* Create Ticket Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-h-screen max-w-3xl overflow-y-scroll">
          <DialogHeader className="mb-4">
            <DialogTitle>Create New Support Ticket</DialogTitle>
            <DialogDescription>
              Fill out the form below to create a new support ticket.
            </DialogDescription>
          </DialogHeader>
          <TicketForm
            onSuccess={() => {
              refetchTickets()
              setCreateDialogOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Ticket Detail Drawer - only rendered internally when onTicketSelect is not provided */}
      {!isExternalDrawer && selectedTicket && (
        <TicketDetailDrawer
          ticket={selectedTicket}
          open={detailDrawerOpen}
          onOpenChange={setDetailDrawerOpen}
        />
      )}

      {/* Mass Action Dialogs */}
      <MassAssignDialog
        open={massAssignDialogOpen}
        onOpenChange={setMassAssignDialogOpen}
        ticketIds={selectedTicketsForBulk.map((t) => t.id)}
        onSuccess={() => {
          refetchTickets()
          setSelectedTicketsForBulk([])
        }}
      />

      <MassStatusDialog
        open={massStatusDialogOpen}
        onOpenChange={setMassStatusDialogOpen}
        ticketIds={selectedTicketsForBulk.map((t) => t.id)}
        onSuccess={() => {
          refetchTickets()
          setSelectedTicketsForBulk([])
        }}
      />

      <MassPriorityDialog
        open={massPriorityDialogOpen}
        onOpenChange={setMassPriorityDialogOpen}
        ticketIds={selectedTicketsForBulk.map((t) => t.id)}
        onSuccess={() => {
          refetchTickets()
          setSelectedTicketsForBulk([])
        }}
      />

      <MassDeleteDialog
        open={massDeleteDialogOpen}
        onOpenChange={setMassDeleteDialogOpen}
        ticketIds={selectedTicketsForBulk.map((t) => t.id)}
        onSuccess={() => {
          refetchTickets()
          setSelectedTicketsForBulk([])
        }}
      />

      <MassWorkflowTriggerDialog
        open={massWorkflowDialogOpen}
        onOpenChange={setMassWorkflowDialogOpen}
        resourceType="ticket"
        resourceIds={selectedTicketsForBulk.map((t) => t.id)}
        onSuccess={() => {
          refetchTickets()
          setSelectedTicketsForBulk([])
        }}
      />

      <ConfirmDialog />
    </>
  )
}
