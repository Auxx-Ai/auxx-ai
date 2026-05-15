// apps/web/src/components/agents/ui/detail/triggers/triggers-section-content.tsx
'use client'

import { getTriggerLabel } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle, Play, Trash2 } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import { TriggerCreateForm } from './trigger-create-form'

interface TriggersSectionContentProps {
  agent: AgentDetail
  adding: boolean
  onAddingChange: (adding: boolean) => void
}

/**
 * Triggers tab body — table of agent triggers + inline create form. Scheduled
 * is the v1 kind shipped here; event and app kinds land in PR-3 / PR-4.
 */
export function TriggersSectionContent({
  agent,
  adding,
  onAddingChange,
}: TriggersSectionContentProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const triggers = api.agentTrigger.list.useQuery({ agentId: agent.id })

  const updateTrigger = api.agentTrigger.update.useMutation({
    onSuccess: () => utils.agentTrigger.list.invalidate({ agentId: agent.id }),
    onError: (err) => toastError({ title: 'Failed to update trigger', description: err.message }),
  })

  const deleteTrigger = api.agentTrigger.delete.useMutation({
    onSuccess: () => utils.agentTrigger.list.invalidate({ agentId: agent.id }),
    onError: (err) => toastError({ title: 'Failed to delete trigger', description: err.message }),
  })

  const runNow = api.agentTrigger.runNow.useMutation({
    onError: (err) => toastError({ title: 'Run-now failed', description: err.message }),
  })

  const rows = triggers.data ?? []

  return (
    <div className='space-y-4 px-3'>
      <p className='text-sm text-muted-foreground'>
        Autonomous triggers fire this agent on a schedule, on a record event, or on an app event.
      </p>

      {adding ? (
        <TriggerCreateForm
          agentId={agent.id}
          onDone={() => {
            onAddingChange(false)
            utils.agentTrigger.list.invalidate({ agentId: agent.id })
          }}
        />
      ) : null}

      {triggers.isLoading ? (
        <div className='text-sm text-muted-foreground'>Loading triggers…</div>
      ) : rows.length === 0 ? (
        <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No triggers yet. Add one to fire this agent autonomously.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last fired</TableHead>
              <TableHead className='text-right'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>
                  <div className='flex flex-col'>
                    <span>{getTriggerLabel(row)}</span>
                    {row.lastError ? (
                      <span className='flex items-center gap-1 text-xs text-destructive'>
                        <AlertTriangle className='size-3' />
                        {row.lastError.slice(0, 80)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className='capitalize'>{row.kind}</TableCell>
                <TableCell>
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(checked) =>
                      updateTrigger.mutate({ id: row.id, enabled: checked })
                    }
                  />
                </TableCell>
                <TableCell className='text-xs text-muted-foreground'>
                  {row.lastFiredAt ? new Date(row.lastFiredAt).toLocaleString() : '—'}
                </TableCell>
                <TableCell className='text-right'>
                  <div className='flex justify-end gap-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      loading={runNow.isPending && runNow.variables?.id === row.id}
                      onClick={() => runNow.mutate({ id: row.id })}
                      title='Run now'>
                      <Play />
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={async () => {
                        const confirmed = await confirm({
                          title: 'Delete trigger?',
                          description: 'This action cannot be undone.',
                          confirmText: 'Delete',
                          cancelText: 'Cancel',
                          destructive: true,
                        })
                        if (confirmed) deleteTrigger.mutate({ id: row.id })
                      }}
                      title='Delete'>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog />
    </div>
  )
}
