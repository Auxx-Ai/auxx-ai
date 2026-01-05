// apps/web/src/app/(protected)/app/tickets/_components/ticket-management.tsx

'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import {
  DynamicTable,
  DynamicTableFooter,
  createCustomFieldColumns,
  useCombinedFilters,
} from '~/components/dynamic-table'
import { useActiveViewConfig } from '~/components/dynamic-table/stores/view-store'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import type { VisibilityState } from '@tanstack/react-table'
import { EmptyState } from '~/components/global/empty-state'
import { Ticket as TicketIcon, Plus, Trash2, Users, CircleDot, Flag, Play } from 'lucide-react'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { useRecordList, useAllResources } from '~/components/resources'
import { TicketDetailDrawer } from './ticket-detail-drawer'
import { createTicketColumns } from './ticket-columns'
import { useTicketMutations } from './use-ticket-mutations'
import type { Ticket } from './ticket-types'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import TicketFormDialog from './ticket-form-dialog'
import { MassAssignDialog } from './dialog-mass-assign'
import { MassStatusDialog } from './dialog-mass-status'
import { MassPriorityDialog } from './dialog-mass-priority'
import { MassDeleteDialog } from './dialog-mass-deleting'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'

const PAGE_SIZE = 100

interface TicketManagementProps {
  /**
   * Optional callback when a ticket is selected.
   * When provided, the drawer will NOT be rendered internally - parent handles it.
   */
  onTicketSelect?: (ticketId: string) => void
  /**
   * Callback when create dialog state changes (for header button sync)
   */
  onCreateDialogChange?: (open: boolean) => void
}

export function TicketManagement({
  onTicketSelect,
  onCreateDialogChange,
}: TicketManagementProps = {}) {
  const router = useRouter()

  // Create dialog state via URL
  const [createDialogOpen, setCreateDialogOpen] = useQueryState(
    'create',
    parseAsBoolean.withDefault(false)
  )

  // Sync create dialog state with parent
  useEffect(() => {
    onCreateDialogChange?.(createDialogOpen ?? false)
  }, [createDialogOpen, onCreateDialogChange])

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW STORE INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

  const TABLE_ID = 'tickets'

  // Get merged view config (saved + pending) from view store
  const viewConfig = useActiveViewConfig(TABLE_ID)

  // Merge view filters with page filters (no page-level filters for tickets currently)
  const combinedFilters = useCombinedFilters({ viewConfig, pageFilters: undefined })

  // Get sorting from view config
  const viewSorting = useMemo(() => {
    const sorting = viewConfig?.sorting
    return sorting?.length ? sorting : undefined
  }, [viewConfig?.sorting])

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  const {
    items: tickets,
    isLoading: isTicketsLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refresh: refetchTickets,
  } = useRecordList<Ticket>({
    resourceType: 'ticket',
    filters: combinedFilters,
    sorting: viewSorting,
    limit: PAGE_SIZE,
  })

  // Mutations hook
  const { deleteTicket } = useTicketMutations()

  // Ticket drawer state - synced with URL for deep linking (e.g., /app/tickets?t=ticketId)
  const [selectedTicketId, setSelectedTicketId] = useQueryState(
    't',
    parseAsString.withDefault('')
  )

  // Derive drawer open state from whether a ticket is selected
  const detailDrawerOpen = !!selectedTicketId
  const setDetailDrawerOpen = useCallback(
    (open: boolean) => {
      if (!open) setSelectedTicketId(null)
    },
    [setSelectedTicketId]
  )

  // Determine if drawer is managed externally
  const isExternalDrawer = !!onTicketSelect
  const [selectedTicketsForBulk, setSelectedTicketsForBulk] = useState<Ticket[]>([])
  const [massAssignDialogOpen, setMassAssignDialogOpen] = useState(false)
  const [massStatusDialogOpen, setMassStatusDialogOpen] = useState(false)
  const [massPriorityDialogOpen, setMassPriorityDialogOpen] = useState(false)
  const [massDeleteDialogOpen, setMassDeleteDialogOpen] = useState(false)
  const [massWorkflowDialogOpen, setMassWorkflowDialogOpen] = useState(false)
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

  // Handle ticket actions
  const handleViewDetails = useCallback(
    (ticket: Ticket) => {
      if (onTicketSelect) {
        onTicketSelect(ticket.id)
      } else {
        setSelectedTicketId(ticket.id)
      }
    },
    [onTicketSelect, setSelectedTicketId]
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
          await deleteTicket.mutateAsync({ ticketId: ticket.id })
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

    // Add custom field columns
    if (customFields.length === 0) {
      return standardColumns
    }

    const customCols = createCustomFieldColumns<Ticket>(customFields, {
      resourceType: 'ticket',
    })

    // Insert custom fields before the actions column (last column)
    const actionsColumn = standardColumns[standardColumns.length - 1]!
    const otherColumns = standardColumns.slice(0, -1)
    return [...otherColumns, ...customCols, actionsColumn] as ExtendedColumnDef<Ticket>[]
  }, [handleViewDetails, handleEdit, handleDelete, handleAssign, handleReply, customFields])

  // Handle scrolling to bottom - load more data
  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isTicketsLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isTicketsLoading, fetchNextPage])

  // Handle drawer close - just update the URL state
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedTicketId(null)
    },
    [setSelectedTicketId]
  )

  return (
    <>
      <DynamicTable<Ticket>
        tableId={TABLE_ID}
        resourceType="ticket"
        className="h-full"
        entityLabel="Ticket"
        columns={columns}
        data={tickets}
        isLoading={isTicketsLoading}
        bulkActions={bulkActions}
        onRowSelectionChange={() => {}}
        importHref="/app/tickets/import"
        enableSearch
        enableFiltering
        onRefresh={refetchTickets}
        searchPlaceholder="Search tickets..."
        onColumnVisibilityChange={setColumnVisibility}
        onAddNew={() => setCreateDialogOpen(true)}
        onScrollToBottom={handleScrollToBottom}
        emptyState={
          <EmptyState
            icon={TicketIcon}
            title="No tickets found"
            description="Create your first ticket to get started."
            button={
              <Button onClick={() => setCreateDialogOpen(true)} variant="outline">
                <Plus />
                Create Ticket
              </Button>
            }
          />
        }>
        {/* Custom footer to show loading state */}
        <DynamicTableFooter>
          <div className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground">
            <div>
              {tickets.length} tickets loaded
              {hasNextPage && <span className="ml-2">(more available)</span>}
            </div>
            {isFetchingNextPage && (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span>Loading more...</span>
              </div>
            )}
          </div>
        </DynamicTableFooter>
      </DynamicTable>

      {/* Create Ticket Dialog */}
      <TicketFormDialog
        open={createDialogOpen ?? false}
        onOpenChange={setCreateDialogOpen}
        onSuccess={() => {
          refetchTickets()
          setCreateDialogOpen(false)
        }}
      />

      {/* Ticket Detail Drawer - only rendered internally when onTicketSelect is not provided */}
      {!isExternalDrawer && selectedTicketId && (
        <TicketDetailDrawer
          ticketId={selectedTicketId}
          open={detailDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
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
