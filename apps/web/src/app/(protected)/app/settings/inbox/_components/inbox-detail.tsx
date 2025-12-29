// /app/settings/inbox/_components/inbox-detail.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { CardDescription } from '@auxx/ui/components/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { InboxIntegrationsTab } from './inbox-integrations-tab'
import { InboxAccessTab } from './inbox-access-tab'
import { InboxSettingsTab } from './inbox-settings-tab'
import { X } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { EmptyState } from '~/components/global/empty-state'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@auxx/ui/components/table'

// Create a tab parameter with 'settings' as the default tab
// const tabParam = createTab({ name: 'tab', defaultValue: 'settings' })

// type TabValue = 'integrations' | 'access' | 'settings'

export function InboxDetail({ inboxId }: { inboxId: string }) {
  const router = useRouter()
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'integrations' })

  // Fetch inbox details
  const { data: inbox, isLoading } = api.inbox.getById.useQuery({ inboxId })

  // Navigate back to inbox list
  const handleBack = () => {
    router.push('/app/settings/inbox')
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <SettingsPage
        title={`Inbox - ${inbox?.name ?? 'Loading...'}`}
        description="Manage your shared inboxes and their settings."
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Inboxes', href: '/app/settings/inbox' },
          { title: inbox?.name ?? 'Loading...' },
        ]}
        button={
          <TabsList>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        }>
        <div>
          {isLoading ? (
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableCell>
                    <Skeleton className="h-4 w-full max-w-md" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-full max-w-sm" />
                  </TableCell>
                  <TableCell className="w-[80px]">
                    <Skeleton className="h-4 w-full max-w-xs" />
                  </TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`skeleton-row-${index}`} className="h-[53px]">
                    <TableCell>
                      <Skeleton className="h-4 w-full max-w-md" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-full max-w-sm" />
                    </TableCell>
                    <TableCell className="w-[80px]">
                      <Skeleton className="h-4 w-full max-w-xs" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : inbox ? (
            <>
              <TabsContent value="integrations" className="">
                <InboxIntegrationsTab inbox={inbox} />
              </TabsContent>
              <TabsContent value="access">
                <InboxAccessTab inbox={inbox} />
              </TabsContent>
              <TabsContent value="settings">
                <InboxSettingsTab inbox={inbox} />
              </TabsContent>
            </>
          ) : (
            <EmptyState
              icon={X}
              title="Inbox not found"
              description={<>Inbox doesn't exists...</>}
              button={
                <Button onClick={handleBack} className="mt-4" variant="outline">
                  Go Back
                </Button>
              }
            />
          )}
        </div>
      </SettingsPage>
    </Tabs>
  )
}
