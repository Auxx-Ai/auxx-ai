// apps/web/src/app/admin/data-migrations/data-migrations-table.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { formatDistanceToNow } from 'date-fns'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** One migration row as returned by `admin.listDataMigrations`. */
export interface DataMigrationRow {
  id: string
  description: string
  status: 'applied' | 'failed' | 'pending'
  error: string | null
  durationMs: number | null
  appliedAt: Date | string | null
}

/** Status as rendered, including the client-side `blocked` derivation. */
type RenderStatus = DataMigrationRow['status'] | 'blocked'

/** Humanize a duration: `< 1s`, `1.2s`, `2m 10s`. */
function humanizeDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return '< 1s'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

function StatusBadge({ status, blockedBy }: { status: RenderStatus; blockedBy?: string }) {
  if (status === 'applied') return <Badge variant='outline'>applied</Badge>
  if (status === 'failed') return <Badge variant='destructive'>failed</Badge>
  if (status === 'blocked') {
    return (
      <SimpleTooltip content={`Blocked by ${blockedBy} — re-run it first.`}>
        <Badge variant='secondary' className='text-muted-foreground'>
          blocked
        </Badge>
      </SimpleTooltip>
    )
  }
  return <Badge variant='secondary'>pending</Badge>
}

export function DataMigrationsTable({
  migrations,
  isLoading,
}: {
  migrations: DataMigrationRow[] | undefined
  isLoading: boolean
}) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [errorDialog, setErrorDialog] = useState<DataMigrationRow | null>(null)

  const rerun = api.admin.rerunDataMigration.useMutation({
    onSuccess: () => utils.admin.listDataMigrations.invalidate(),
    onError: (error) => toastError({ title: 'Re-run failed', description: error.message }),
  })

  // The first failed row's id; every pending row after it renders as `blocked`.
  const firstFailedId = migrations?.find((m) => m.status === 'failed')?.id
  const firstFailedIndex = firstFailedId
    ? (migrations?.findIndex((m) => m.id === firstFailedId) ?? -1)
    : -1

  const handleRerun = async (row: DataMigrationRow) => {
    const confirmed = await confirm({
      title: `Re-run ${row.id}?`,
      description:
        'This deletes the failed ledger row and enqueues a run; migrations after it run too once it succeeds.',
      confirmText: 'Re-run',
      cancelText: 'Cancel',
    })
    if (confirmed) rerun.mutate({ id: row.id })
  }

  return (
    <>
      <ConfirmDialog />

      <Dialog open={!!errorDialog} onOpenChange={(open) => !open && setErrorDialog(null)}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{errorDialog?.id} failed</DialogTitle>
            <DialogDescription>{errorDialog?.description}</DialogDescription>
          </DialogHeader>
          <pre className='font-mono text-xs whitespace-pre-wrap max-h-[60vh] overflow-auto rounded-md border bg-muted/50 p-3'>
            {errorDialog?.error}
          </pre>
        </DialogContent>
      </Dialog>

      <Card className='flex-1 flex flex-col overflow-y-auto'>
        <CardHeader>
          <CardTitle>Data Migrations</CardTitle>
          <CardDescription>
            One-shot data migrations, run automatically at worker boot. Pending migrations run in
            order; a failure stops the run.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex-1 flex flex-col'>
          <div className='flex-1 border rounded-md overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-48'>ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className='w-28'>Status</TableHead>
                  <TableHead className='w-32'>Ran</TableHead>
                  <TableHead className='w-24'>Took</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className='w-28 text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className='h-4 w-36' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-4 w-64' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-5 w-16' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-4 w-20' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-4 w-12' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-4 w-40' />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))
                ) : migrations && migrations.length > 0 ? (
                  migrations.map((row, index) => {
                    const isBlocked =
                      row.status === 'pending' && firstFailedIndex >= 0 && index > firstFailedIndex
                    const renderStatus: RenderStatus = isBlocked ? 'blocked' : row.status
                    return (
                      <TableRow key={row.id}>
                        <TableCell className='font-mono text-xs text-muted-foreground'>
                          {row.id}
                        </TableCell>
                        <TableCell className='font-medium'>{row.description}</TableCell>
                        <TableCell>
                          <StatusBadge status={renderStatus} blockedBy={firstFailedId} />
                        </TableCell>
                        <TableCell className='text-muted-foreground text-sm'>
                          {row.appliedAt
                            ? formatDistanceToNow(new Date(row.appliedAt), { addSuffix: true })
                            : '—'}
                        </TableCell>
                        <TableCell className='text-muted-foreground text-sm'>
                          {humanizeDuration(row.durationMs)}
                        </TableCell>
                        <TableCell>
                          {row.status === 'failed' && row.error ? (
                            <button
                              type='button'
                              onClick={() => setErrorDialog(row)}
                              className='max-w-[28rem] truncate text-left text-sm text-destructive hover:underline'>
                              {row.error.split('\n')[0]}
                            </button>
                          ) : null}
                        </TableCell>
                        <TableCell className='text-right'>
                          {row.status === 'failed' ? (
                            <Button
                              variant='outline'
                              size='sm'
                              loading={rerun.isPending && rerun.variables?.id === row.id}
                              onClick={() => handleRerun(row)}>
                              <RotateCcw />
                              Re-run
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center text-muted-foreground py-8'>
                      No data migrations registered
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
