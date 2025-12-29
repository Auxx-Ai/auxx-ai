// /app/settings/inbox/_components/inbox-list.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Inbox, InboxIcon, PlusIcon, RefreshCw } from 'lucide-react'
import { api } from '~/trpc/react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Badge } from '@auxx/ui/components/badge'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { EmptyState } from '~/components/global/empty-state'
import { InboxStatus } from '@auxx/database/enums'
export function InboxList() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  useUser({
    requireOrganization: true, // Require organization membership
    requireRoles: ['ADMIN', 'OWNER'], // Ensure user is an admin or owner
  })
  // Fetch all inboxes for the organization
  const { data: inboxes, isLoading: isLoadingInboxes } = api.inbox.getAll.useQuery()
  // Function to get status badge based on inbox status
  const getStatusBadge = (status: InboxStatus) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="green">Active</Badge>
      case 'ARCHIVED':
        return <Badge variant="gray">Archived</Badge>
      case 'PAUSED':
        return <Badge variant="yellow">Paused</Badge>
      default:
        return <Badge>{status}</Badge>
    }
  }
  // Navigate to the new inbox page
  const handleCreateInbox = () => {
    setIsLoading(true)
    router.push('/app/settings/inbox/new')
  }
  // Navigate to the inbox detail page
  const handleRowClick = (inboxId: string) => {
    router.push(`/app/settings/inbox/${inboxId}`)
  }
  return (
    <SettingsPage
      title="Inboxes"
      description="Manage your shared inboxes and their settings."
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Inboxes' }]}
      button={
        <Button variant="outline" size="sm" onClick={handleCreateInbox} disabled={isLoading}>
          <PlusIcon className="h-4 w-4" />
          Create Inbox
        </Button>
      }>
      <div className="flex h-full">
        {isLoadingInboxes ? (
          <EmptyState
            icon={RefreshCw}
            iconClassName="animate-spin"
            title="Loading inboxes..."
            description={<>Hang on tight while we load your inboxes...</>}
            button={<div className="h-12"></div>}
          />
        ) : inboxes && inboxes.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">Inbox</TableHead>
                <TableHead>Integrations</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inboxes &&
                inboxes.length > 0 &&
                inboxes.map((inbox) => (
                  <TableRow
                    key={inbox.id}
                    onClick={() => handleRowClick(inbox.id)}
                    className="cursor-pointer hover:bg-muted">
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        {/* Colored dot based on inbox color */}
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{
                            backgroundColor: inbox.color || '#4F46E5', // Default to indigo if no color
                          }}
                        />
                        <div>
                          <div className="font-medium">{inbox.name}</div>
                          {inbox.description && (
                            <div className="text-sm text-muted-foreground">{inbox.description}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {inbox.integrations.length === 0 ? (
                        <span className="text-sm text-muted-foreground">No integrations</span>
                      ) : (
                        <span>{inbox.integrations.length} integration(s)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {inbox.allowAllMembers ? (
                        <span>All members</span>
                      ) : (
                        <div>
                          {inbox.enableMemberAccess && inbox.memberAccess.length > 0 && (
                            <div>{inbox.memberAccess.length} member(s)</div>
                          )}
                          {inbox.enableGroupAccess && inbox.groupAccess.length > 0 && (
                            <div>{inbox.groupAccess.length} group(s)</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(inbox.status)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={InboxIcon}
            title="Create your first inbox"
            description={<>Inboxes help you organize your messages.</>}
            button={
              <Button size="sm" variant="outline" onClick={handleCreateInbox} disabled={isLoading}>
                <PlusIcon className="h-4 w-4" />
                Create Inbox
              </Button>
            }
          />
        )}
      </div>
    </SettingsPage>
  )
}
