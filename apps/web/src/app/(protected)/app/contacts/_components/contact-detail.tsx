// apps/web/src/app/(protected)/app/contacts/_components/contact-detail.tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Ban, User, UserCircle, Users } from 'lucide-react'
import { getFullName } from '@auxx/utils/contact'
import { api } from '~/trpc/react'
import { useContactMutations } from './use-contact-mutations'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import EntityFields from '~/components/fields/entity-fields'
import { toRecordId } from '~/components/resources'
import CustomerSpamDialog from './customer-spam-dialog'
// import { toast } from '@auxx/ui/components/toast'
import CustomerOrdersTab from './customer-orders-tab'
import CustomerTicketsTab from './customer-tickets-tab'
import { TimelineTab } from '~/components/timeline'
import GroupManagementDialog from './groups/group-management-dialog'
import CustomerSourcesCard from './customer-sources-card'
import CustomerGroupsCard from './groups/customer-groups-card'
import { getCustomerStatusVariant } from '~/components/contacts/contact-status'
import { useQueryState } from 'nuqs'
import { useDockStore } from '~/stores/dock-store'

// Memoized EntityFields for performance
const MemoEntityFields = React.memo(EntityFields)

/**
 * ContactDetailActions - action buttons for the contact detail header
 */
function ContactDetailActions({
  isMerged,
  isSpam,
  onGroupsClick,
  onMergeClick,
  onSpamClick,
}: {
  isMerged: boolean
  isSpam: boolean
  onGroupsClick: () => void
  onMergeClick: () => void
  onSpamClick: () => void
}) {
  if (isMerged) return null

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={onGroupsClick}>
        <Users /> Groups
      </Button>
      <Button variant="outline" size="sm" onClick={onMergeClick}>
        <UserCircle /> Merge
      </Button>
      {!isSpam && (
        <Button variant="destructive" size="sm" onClick={onSpamClick}>
          <Ban /> Mark as Spam
        </Button>
      )}
    </div>
  )
}

/**
 * ContactDetailSidebar - sidebar component with person card, entity fields, groups, and sources
 */
function ContactDetailSidebar({
  customer,
  isMerged,
  onManageGroups,
}: {
  customer: any
  isMerged: boolean
  onManageGroups: () => void
}) {
  const createdAtText = React.useMemo(
    () => `Created ${formatDistanceToNow(new Date(customer.createdAt), { addSuffix: true })}`,
    [customer.createdAt]
  )

  return (
    <div className="h-full overflow-y-auto">
      {/* Person Card - matching contact-drawer.tsx pattern */}
      <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
        <div className="size-10 border bg-muted rounded-lg flex items-center justify-center shrink-0">
          <User className="size-6 text-neutral-500 dark:text-foreground" />
        </div>
        <div className="flex flex-col align-start w-full">
          <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
            {getFullName(customer) || 'Unnamed Customer'}
          </div>
          <div className="text-xs text-neutral-500 truncate">{createdAtText}</div>
        </div>
      </div>

      {/* Entity Fields - directly below person card, no tabs */}
      <MemoEntityFields recordId={toRecordId('contact', customer.id)} className="m-4" />

      {/* Groups and Sources Sections - matching ticket-detail-drawer.tsx pattern */}
      <div className="space-y-4 p-4 pt-0">
        <div className="space-y-1">
          <h4 className="text-sm">Groups</h4>
          <CustomerGroupsCard
            customer={customer}
            isMerged={isMerged}
            onManageGroups={onManageGroups}
          />
        </div>

        <div className="space-y-1">
          <h4 className="text-sm">Connected Sources</h4>
          <CustomerSourcesCard customer={customer} />
        </div>
      </div>
    </div>
  )
}

/**
 * ContactDetail - main contact detail page component
 */
export function ContactDetail({ id }: { id: string }) {
  const router = useRouter()
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'tickets' })

  const recordId = toRecordId('contact', id)
  // Dock state for resizable sidebar
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // State for dialogs
  const [isSpamDialogOpen, setIsSpamDialogOpen] = useState(false)
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)

  // Query customer data
  const { data: customer, isLoading, refetch } = api.contact.getById.useQuery({ id })

  // Use contact mutations hook
  const mutations = useContactMutations({
    onSuccess: () => {
      refetch()
      setIsSpamDialogOpen(false)
    },
  })

  const handleMarkAsSpam = () => {
    mutations.markAsSpam.mutate({ id })
  }

  if (isLoading) {
    return <CustomerDetailSkeleton />
  }

  if (!customer) {
    return <CustomerNotFound router={router} />
  }

  const customerName =
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed Customer'
  const isSpam = customer.status === 'SPAM'
  const isMerged = customer.status === 'MERGED'

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className="flex items-center gap-4">
            <Badge variant={getCustomerStatusVariant(customer.status)}>{customer.status}</Badge>
            <ContactDetailActions
              isMerged={isMerged}
              isSpam={isSpam}
              onGroupsClick={() => setIsGroupDialogOpen(true)}
              onMergeClick={
                () => {}
                // toast({ title: 'Merge feature coming soon', description: 'This feature is currently being redesigned.' })
              }
              onSpamClick={() => setIsSpamDialogOpen(true)}
            />
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title="Contacts" href="/app/contacts" />
          <MainPageBreadcrumbItem title={customerName} last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent
        dockedPanels={[
          {
            key: 'sidebar',
            content: (
              <ContactDetailSidebar
                customer={customer}
                isMerged={isMerged}
                onManageGroups={() => setIsGroupDialogOpen(true)}
              />
            ),
            width: dockedWidth,
            onWidthChange: setDockedWidth,
            minWidth,
            maxWidth,
          },
        ]}>
        {/* Tabs content */}
        <Tabs
          value={tab ?? 'tickets'}
          onValueChange={setTab}
          className="flex-1 h-full flex flex-col min-h-0">
          <TabsList className="border-b w-full justify-start rounded-b-none bg-primary-150">
            <TabsTrigger value="tickets" variant="outline">
              Tickets
            </TabsTrigger>
            <TabsTrigger value="orders" variant="outline">
              Orders
            </TabsTrigger>
            <TabsTrigger value="timeline" variant="outline">
              Timeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="flex flex-col flex-1 min-h-0 ">
            <CustomerTicketsTab customer={customer} contactId={id} />
          </TabsContent>

          <TabsContent value="orders" className="flex flex-col flex-1 min-h-0 p-6 overflow-y-auto">
            <CustomerOrdersTab customer={customer} shopifyCustomers={customer.shopifyCustomers} />
          </TabsContent>

          <TabsContent value="timeline" className="flex flex-col flex-1 min-h-0">
            <ScrollArea className="flex-1">
              <div className="p-6 flex-1 flex-col flex">
                <TimelineTab recordId={recordId} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </MainPageContent>

      {/* Dialogs */}
      <CustomerSpamDialog
        open={isSpamDialogOpen}
        onOpenChange={setIsSpamDialogOpen}
        onConfirm={handleMarkAsSpam}
      />

      <GroupManagementDialog
        open={isGroupDialogOpen}
        onOpenChange={setIsGroupDialogOpen}
        customerIds={[id]}
        onSuccess={() => refetch()}
      />
    </MainPage>
  )
}

/**
 * CustomerDetailSkeleton - loading skeleton for contact detail page
 */
function CustomerDetailSkeleton() {
  const dockedWidth = useDockStore((state) => state.dockedWidth)

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title="Contacts" href="/app/contacts" />
          <MainPageBreadcrumbItem title="Loading..." last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent
        dockedPanels={[
          {
            key: 'sidebar',
            content: (
              <div className="h-full">
                {/* Person Card Skeleton */}
                <div className="flex gap-3 py-2 px-3 flex-row items-center justify-start border-b">
                  <Skeleton className="size-10 rounded-lg" />
                  <div className="flex flex-col w-full gap-1">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
                {/* Fields Skeleton */}
                <div className="p-4 space-y-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ),
            width: dockedWidth,
          },
        ]}>
        <div className="p-6 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainPageContent>
    </MainPage>
  )
}

/**
 * CustomerNotFound - not found state for contact detail page
 */
function CustomerNotFound({ router }: { router: any }) {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title="Contacts" href="/app/contacts" />
          <MainPageBreadcrumbItem title="Not Found" last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <h1 className="text-2xl font-bold">Customer Not Found</h1>
          <p className="text-muted-foreground">
            The requested customer could not be found. It may have been deleted or you may not have
            permission to view it.
          </p>
          <Button onClick={() => router.push('/app/contacts')}>Return to Customer List</Button>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
