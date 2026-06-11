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
import { pluralize } from '@auxx/utils/strings'
import { Building2, Database, History } from 'lucide-react'
import Link from 'next/link'
import { AuditConsoleView } from '~/components/activity-log/ui/audit-console-view'
import { api } from '~/trpc/react'
import { OrganizationsTab } from './organizations-tab'

/**
 * Admin organizations page: an Organizations list tab plus a cross-org audit Log tab.
 */
export default function OrganizationsPage() {
  const { data: demoStats } = api.admin.getActiveDemoCount.useQuery()

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {demoStats && demoStats.activeDemoCount > 0 && (
              <Badge variant='secondary'>
                {demoStats.activeDemoCount} active {pluralize(demoStats.activeDemoCount, 'demo')}
              </Badge>
            )}
            <Button variant='outline' size='sm' asChild>
              <Link href='/admin/data-migrations'>
                <Database />
                Data Migrations
              </Link>
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
  )
}
