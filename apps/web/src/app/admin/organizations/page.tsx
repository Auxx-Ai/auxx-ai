// apps/web/src/app/admin/organizations/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError } from '@auxx/ui/components/toast'
import { pluralize } from '@auxx/utils/strings'
import { Building2, Database, History } from 'lucide-react'
import { toast } from 'sonner'
import { AuditConsoleView } from '~/components/activity-log/ui/audit-console-view'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { OrganizationsTab } from './organizations-tab'

/**
 * Admin organizations page: an Organizations list tab plus a cross-org audit Log tab.
 */
export default function OrganizationsPage() {
  const [confirm, ConfirmDialog] = useConfirm()
  const { data: demoStats } = api.admin.getActiveDemoCount.useQuery()

  const runMigrations = api.admin.runEntityMigrations.useMutation({
    onSuccess: (data) => {
      const totalCreated = data.results.reduce(
        (acc, r) =>
          acc +
          r.migrations.reduce((a, m) => a + m.result.entityDefsCreated + m.result.fieldsCreated, 0),
        0
      )
      const errors = data.results.filter((r) => r.error).length
      toast.success('Entity migrations complete', {
        description:
          errors > 0
            ? `${totalCreated} records created, ${errors} org(s) had errors`
            : totalCreated > 0
              ? `${totalCreated} records created across ${data.results.length} org(s)`
              : `All ${data.results.length} org(s) already up to date`,
      })
    },
    onError: (error) => {
      toastError({ title: 'Migration failed', description: error.message })
    },
  })

  const handleRunMigrations = async () => {
    const confirmed = await confirm({
      title: 'Run entity migrations?',
      description:
        'This will create missing EntityDefinitions and CustomFields for all organizations. Each migration is idempotent and safe to re-run.',
      confirmText: 'Run Migrations',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      await runMigrations.mutateAsync()
    }
  }

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <div className='flex items-center gap-2'>
              {demoStats && demoStats.activeDemoCount > 0 && (
                <Badge variant='secondary'>
                  {demoStats.activeDemoCount} active {pluralize(demoStats.activeDemoCount, 'demo')}
                </Badge>
              )}
              <Button
                variant='outline'
                size='sm'
                onClick={handleRunMigrations}
                loading={runMigrations.isPending}
                loadingText='Running...'>
                <Database />
                Run Entity Migrations
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Organizations' href='/admin/organizations' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <Tabs defaultValue='organizations' className='flex-1 flex flex-col min-h-0'>
            <TabsList className='border-b w-full justify-start rounded-b-none'>
              <TabsTrigger value='organizations' variant='outline'>
                <Building2 />
                Organizations
              </TabsTrigger>
              <TabsTrigger value='log' variant='outline'>
                <History />
                Log
              </TabsTrigger>
            </TabsList>
            <TabsContent value='organizations' className='flex-1 flex flex-col min-h-0'>
              <OrganizationsTab />
            </TabsContent>
            <TabsContent value='log' className='flex-1 flex flex-col min-h-0'>
              <AuditConsoleView />
            </TabsContent>
          </Tabs>
        </MainPageContent>
      </MainPage>
    </>
  )
}
