// apps/web/src/app/admin/data-migrations/page.tsx
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
import { toastError } from '@auxx/ui/components/toast'
import { Play } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { DataMigrationsTable } from './data-migrations-table'

/**
 * Superadmin Data Migrations panel: the code registry joined with the ledger, plus a
 * "Run pending" action. Polls so rows flip pending → applied/failed as the worker runs.
 */
export default function DataMigrationsPage() {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data, isLoading } = api.admin.listDataMigrations.useQuery(undefined, {
    refetchInterval: 5000,
  })

  const migrations = data?.migrations
  const runState = data?.runState ?? 'idle'
  const isRunning = runState === 'queued' || runState === 'active'

  const runDataMigrations = api.admin.runDataMigrations.useMutation({
    onSuccess: () => utils.admin.listDataMigrations.invalidate(),
    onError: (error) => toastError({ title: 'Failed to start run', description: error.message }),
  })

  const counts = {
    applied: migrations?.filter((m) => m.status === 'applied').length ?? 0,
    failed: migrations?.filter((m) => m.status === 'failed').length ?? 0,
    pending: migrations?.filter((m) => m.status === 'pending').length ?? 0,
  }
  const summary = [
    counts.applied > 0 ? `${counts.applied} applied` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.pending > 0 ? `${counts.pending} pending` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const handleRun = async () => {
    const confirmed = await confirm({
      title: 'Run pending data migrations?',
      description: 'Pending migrations run in order on the worker; a failure stops the run.',
      confirmText: 'Run',
      cancelText: 'Cancel',
    })
    if (confirmed) runDataMigrations.mutate()
  }

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <div className='flex items-center gap-2'>
              {summary && <Badge variant='secondary'>{summary}</Badge>}
              <Button
                variant='outline'
                size='sm'
                onClick={handleRun}
                loading={runDataMigrations.isPending || isRunning}
                loadingText='Running…'>
                <Play />
                Run pending
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Data Migrations' href='/admin/data-migrations' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <DataMigrationsTable migrations={migrations} isLoading={isLoading} />
        </MainPageContent>
      </MainPage>
    </>
  )
}
