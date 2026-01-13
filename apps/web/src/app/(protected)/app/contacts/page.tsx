// ~/app/(protected)/app/contacts/page.tsx
'use client'
import { useMemo, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { type VisibilityState } from '@tanstack/react-table'
import { Button } from '@auxx/ui/components/button'
import { Plus, Ban, Users, Trash2, Play } from 'lucide-react'
import NewCustomerForm from './_components/new-customer-form'
import { useContactMutations } from './_components/use-contact-mutations'
import { useConfirm } from '~/hooks/use-confirm'
import GroupManagementDialog from './_components/groups/group-management-dialog'
import { ContactDrawer } from '~/components/contacts/drawer/contact-drawer'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import {
  DynamicTable,
  DynamicTableFooter,
  createCustomFieldColumns,
} from '~/components/dynamic-table'
import { useCombinedFilters } from '~/components/dynamic-table/hooks/use-combined-filters'
import { useActiveViewConfig } from '~/components/dynamic-table/stores/view-store'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { EmptyState } from '~/components/global/empty-state'
import { useAllResources, useRecordList } from '~/components/resources'
import { useCustomFieldValueSyncer } from '~/components/resources/hooks/use-custom-field-value-syncer'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { type CustomerStatus } from '@auxx/database/types'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import {
  createContactColumns,
  type Contact,
  type ContactColumnActions,
} from './_components/contact-columns'
import type { ConditionGroup, Condition } from '@auxx/lib/conditions/client'

/** Stable filter IDs to prevent reference changes */
const SEARCH_FILTER_ID = 'page-search-filter'
const STATUS_FILTER_ID = 'page-status-filter'
const TABLE_ID = 'contacts'

/**
 * Page-level filters (search bar, status dropdown).
 * Uses stable IDs to prevent unnecessary re-fetches.
 */
function buildPageFilters(params: {
  search?: string
  status?: CustomerStatus | 'ALL'
}): ConditionGroup[] | undefined {
  const groups: ConditionGroup[] = []

  if (params.search) {
    const searchConditions: Condition[] = [
      {
        id: `${SEARCH_FILTER_ID}-fn`,
        fieldId: 'firstName',
        operator: 'contains',
        value: params.search,
      },
      {
        id: `${SEARCH_FILTER_ID}-ln`,
        fieldId: 'lastName',
        operator: 'contains',
        value: params.search,
      },
      {
        id: `${SEARCH_FILTER_ID}-em`,
        fieldId: 'email',
        operator: 'contains',
        value: params.search,
      },
    ]
    groups.push({
      id: SEARCH_FILTER_ID,
      logicalOperator: 'OR',
      conditions: searchConditions,
    })
  }

  if (params.status && params.status !== 'ALL') {
    groups.push({
      id: STATUS_FILTER_ID,
      logicalOperator: 'AND',
      conditions: [
        { id: `${STATUS_FILTER_ID}-0`, fieldId: 'status', operator: 'is', value: params.status },
      ],
    })
  }

  return groups.length > 0 ? groups : undefined
}

const PAGE_SIZE = 100
export default function CustomerListPage() {
  const searchParams = useSearchParams()

  // Dock state
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // State for filters and pagination
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useQueryState(
    'create',
    parseAsBoolean.withDefault(false)
  )
  const [search, setSearch] = useState(searchParams.get('search') || '')
  // Debounce the search input to avoid querying on every keystroke
  const [debouncedSearch, cancelSearch] = useDebouncedValue(search, 300)
  const [status, setStatus] = useState<CustomerStatus | 'ALL'>(
    (searchParams.get('status') as CustomerStatus) || 'ALL'
  )
  const [groupFilter, setGroupFilter] = useState(searchParams.get('group') || '')
  // Contact drawer state - synced with URL for refresh persistence
  const [selectedContactId, setSelectedContactId] = useQueryState(
    'c',
    parseAsString.withDefault('')
  )
  // Derive drawer open state from whether a contact is selected
  const isDrawerOpen = !!selectedContactId
  const setIsDrawerOpen = useCallback(
    (open: boolean) => {
      if (!open) setSelectedContactId(null)
    },
    [setSelectedContactId]
  )
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)
  const [isWorkflowDialogOpen, setIsWorkflowDialogOpen] = useState(false)
  // Use confirm dialogs
  const [confirmSpam, ConfirmSpamDialog] = useConfirm()
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()
  // Use simple state for selected customer IDs
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([])

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW STORE INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

  // Get merged view config (saved + pending) from view store
  const viewConfig = useActiveViewConfig(TABLE_ID)

  // Build page-level filters with stable IDs
  const pageFilters = useMemo(
    () => buildPageFilters({ search: debouncedSearch, status }),
    [debouncedSearch, status]
  )

  // Merge view filters with page filters
  const combinedFilters = useCombinedFilters({ viewConfig, pageFilters })

  // Get sorting from view config (already merged saved + pending)
  const viewSorting = useMemo(() => {
    const sorting = viewConfig?.sorting
    return sorting?.length ? sorting : undefined
  }, [viewConfig?.sorting])

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // Query contacts using unified record list
  const {
    items,
    isLoading,
    isLoadingRecords,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refresh: refetch,
  } = useRecordList<Contact>({
    resourceType: 'contact',
    filters: combinedFilters,
    sorting: viewSorting,
    limit: PAGE_SIZE,
  })

  // Column visibility state for syncer
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // Get custom fields from ResourceProvider (single source of truth)
  // Use stable reference to prevent column recreation when resources object changes but fields are the same
  const { resources } = useAllResources()
  const customFieldsRef = useRef<(typeof resources)[0]['fields']>([])
  const customFields = useMemo(() => {
    const contactResource = resources.find((r) => r.id === 'contact')
    if (!contactResource) return customFieldsRef.current

    const newFields = contactResource.fields.filter((f) => f.id)

    // Only update ref if field IDs have changed
    const prevIds = customFieldsRef.current.map((f) => f.id).join(',')
    const newIds = newFields.map((f) => f.id).join(',')
    if (prevIds !== newIds) {
      customFieldsRef.current = newFields
    }

    return customFieldsRef.current
  }, [resources])

  // Row IDs for syncer
  const rowIds = useMemo(() => items.map((c) => c.id), [items])

  // Custom field column IDs
  const customFieldColumnIds = useMemo(
    () => customFields.map((f) => `customField_${f.id}`),
    [customFields]
  )

  // Custom field value syncer - triggers batch fetches for visible columns
  // Cells subscribe directly to store via CustomFieldCell
  useCustomFieldValueSyncer({
    entityDefinitionId: 'contact',
    rowIds,
    columnVisibility,
    customFieldColumnIds,
    enabled: customFields.length > 0,
  })

  // Query groups for filter dropdown
  // const { data: groups } = api.contact.getGroups.useQuery({})
  // Use contact mutations hook
  const mutations = useContactMutations({
    onSuccess: () => {
      refetch()
    },
  })
  // Handle marking customer(s) as spam
  const handleMarkAsSpam = async (customerIds: string | string[]) => {
    // Convert to array if single ID is passed
    const idsArray = Array.isArray(customerIds) ? customerIds : [customerIds]
    const count = idsArray.length
    const confirmed = await confirmSpam({
      title: 'Mark as Spam',
      description: `Are you sure you want to mark ${count} customer${count > 1 ? 's' : ''} as spam? This action can be reversed later.`,
      confirmText: 'Mark as Spam',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      if (idsArray.length === 1) {
        // Use single mutation for one contact
        mutations.markAsSpam.mutate({ id: idsArray[0]! })
      } else {
        // Use bulk mutation for multiple contacts
        mutations.bulkMarkAsSpam.mutate({ ids: idsArray })
      }
    }
  }
  // Handle deleting a contact
  const handleDeleteContact = async (customerId: string) => {
    const confirmed = await confirmDelete({
      title: 'Delete Contact',
      description: 'Are you sure you want to delete this customer? This action cannot be reversed.',
      confirmText: 'Delete Contact',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await mutations.deleteContact.mutateAsync({ id: customerId })
    }
  }
  // Handle bulk deleting contacts
  const handleBulkDeleteContacts = async (customerIds: string[]) => {
    const count = customerIds.length
    const confirmed = await confirmDelete({
      title: 'Delete Contacts',
      description: `Are you sure you want to permanently delete ${count} contact${count > 1 ? 's' : ''}? This action cannot be undone.`,
      confirmText: `Delete ${count} Contact${count > 1 ? 's' : ''}`,
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await mutations.bulkDeleteContacts.mutateAsync({ ids: customerIds })
      resetSelection() // Clear selection after deletion
    }
  }
  // Handle opening customer details - sets URL param which opens drawer
  const handleOpenCustomerDetails = useCallback(
    (id: string) => {
      setSelectedContactId(id)
    },
    [setSelectedContactId]
  )
  // Reset selection when changing pages/filters
  const resetSelection = useCallback(() => {
    setSelectedCustomerIds([])
  }, [])
  // Handle scrolling to bottom - load more data
  const handleScrollToBottom = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])
  // Handle row selection for our DynamicTable with performance optimization
  const handleRowSelectionChange = useCallback((selectedRows: Set<string>) => {
    // Use functional update to prevent unnecessary state changes
    setSelectedCustomerIds((prev) => {
      const newSelection = Array.from(selectedRows)
      // Only update if selection actually changed
      if (prev.length !== newSelection.length || !prev.every((id) => selectedRows.has(id))) {
        return newSelection
      }
      return prev
    })
  }, [])
  // Column actions - memoized to prevent column recreation
  const actions: ContactColumnActions = useMemo(
    () => ({
      onViewDetails: handleOpenCustomerDetails,
      onManageGroups: (id: string) => {
        setSelectedCustomerIds([id])
        setIsGroupDialogOpen(true)
      },
      onMarkAsSpam: handleMarkAsSpam,
      onDelete: handleDeleteContact,
    }),
    [handleOpenCustomerDetails, handleMarkAsSpam, handleDeleteContact]
  )
  // Define bulk actions for DynamicTable
  const bulkActions = useMemo(
    () => [
      {
        label: 'Run workflow',
        icon: Play,
        variant: 'outline' as const,
        action: () => setIsWorkflowDialogOpen(true),
      },
      {
        label: 'Manage groups',
        icon: Users,
        variant: 'outline' as const,
        action: () => setIsGroupDialogOpen(true),
      },
      {
        label: 'Mark as spam',
        icon: Ban,
        variant: 'destructive' as const,
        action: (rows: Contact[]) => handleMarkAsSpam(rows.map((row) => row.id)),
      },
      {
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive' as const,
        action: (rows: Contact[]) => handleBulkDeleteContacts(rows.map((row) => row.id)),
      },
    ],
    [handleMarkAsSpam, handleBulkDeleteContacts]
  )
  // Define columns for DynamicTable using static factory function + reactive cells for custom fields
  const columns = useMemo(() => {
    const standardColumns = createContactColumns(actions)

    // Add custom field columns - cells subscribe directly to store
    if (customFields.length === 0) {
      return standardColumns
    }

    const customFieldColumns = createCustomFieldColumns<Contact>(customFields, {
      entityDefinitionId: 'contact',
    })

    // Insert custom fields before the actions column (last column)
    const actionsColumn = standardColumns[standardColumns.length - 1]!
    const otherColumns = standardColumns.slice(0, -1)
    return [...otherColumns, ...customFieldColumns, actionsColumn] as ExtendedColumnDef<Contact>[]
  }, [actions, customFields])

  // Empty state component
  const EmptyStateComponent = () => (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={Users}
        title="No contacts found "
        description={<>Create your first contact</>}
        button={
          <Button size="sm" variant="outline" onClick={() => setIsNewCustomerOpen(true)}>
            <Plus />
            Create Contact
          </Button>
        }
      />
    </div>
  )
  // Build docked panel content
  const dockedPanel =
    isDocked && isDrawerOpen && selectedContactId ? (
      <ContactDrawer
        contactId={selectedContactId}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        onDeleteContact={handleDeleteContact}
      />
    ) : undefined

  return (
    <>
      <MainPage>
        <MainPageHeader
          action={
            <Button size="sm" className="h-7 rounded-lg" onClick={() => setIsNewCustomerOpen(true)}>
              <Plus className="size-4" />
              Create Contact
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Contacts" href="/app/contacts" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent
          dockedPanel={dockedPanel}
          dockedPanelWidth={dockedWidth}
          onDockedPanelWidthChange={setDockedWidth}
          dockedPanelMinWidth={minWidth}
          dockedPanelMaxWidth={maxWidth}>
          <div className="flex-1 overflow-hidden bg-white dark:bg-muted/10 rounded-lg">
            {/* Dynamic Table Component */}
            <DynamicTable
              data={items}
              className="h-full flex-1"
              resourceType="contact"
              tableId={TABLE_ID}
              entityLabel="Contact"
              bulkActions={bulkActions}
              enableSearch
              columns={columns}
              enableSorting
              enableFiltering
              isLoading={isLoading || isLoadingRecords}
              onRowSelectionChange={handleRowSelectionChange}
              onScrollToBottom={handleScrollToBottom}
              showRowNumbers={false}
              importHref="/app/contacts/import"
              onColumnVisibilityChange={setColumnVisibility}
              onAddNew={() => setIsNewCustomerOpen(true)}
              emptyState={<EmptyStateComponent />}>
              {/* Custom footer to show loading state */}
              <DynamicTableFooter>
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    {items.length} contacts loaded
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

            {/* New Customer Dialog */}
            <NewCustomerForm
              open={isNewCustomerOpen}
              onOpenChange={setIsNewCustomerOpen}
              onSuccess={() => {
                refetch()
              }}
            />

            {/* Group Management Dialog */}
            <GroupManagementDialog
              open={isGroupDialogOpen}
              onOpenChange={setIsGroupDialogOpen}
              customerIds={selectedCustomerIds}
              onSuccess={() => {
                refetch()
              }}
            />

            {/* Workflow Trigger Dialog */}
            <MassWorkflowTriggerDialog
              open={isWorkflowDialogOpen}
              onOpenChange={setIsWorkflowDialogOpen}
              resourceType="contact"
              resourceIds={selectedCustomerIds}
              onSuccess={() => {
                resetSelection()
                refetch()
              }}
            />
          </div>
        </MainPageContent>
      </MainPage>
      {/* Only render overlay drawer when NOT docked */}
      {!isDocked && (
        <ContactDrawer
          contactId={selectedContactId}
          open={isDrawerOpen}
          onOpenChange={setIsDrawerOpen}
          onDeleteContact={handleDeleteContact}
        />
      )}
      <ConfirmSpamDialog />
      <ConfirmDeleteDialog />
    </>
  )
}
