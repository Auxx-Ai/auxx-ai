// apps/web/src/components/agents/ui/detail/triggers/triggers-section-content.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptySection } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { AlertTriangle, Pencil, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentTriggerDialog } from './agent-trigger-dialog'
import { TriggerLabel } from './trigger-label'

type Trigger = RouterOutputs['agentTrigger']['list'][number]

type TriggerKind = 'scheduled' | 'event' | 'app'

const KIND_META: Record<TriggerKind, { label: string; iconId: string; color: string }> = {
  scheduled: { label: 'Scheduled', iconId: 'clock', color: 'blue' },
  event: { label: 'Event', iconId: 'zap', color: 'amber' },
  app: { label: 'App', iconId: 'plug', color: 'violet' },
}

interface TriggersSectionContentProps {
  agent: AgentDetail
  addingKind: 'scheduled' | 'event' | null
  onAddingKindChange: (kind: 'scheduled' | 'event' | null) => void
}

/**
 * Triggers tab body — list of agent triggers + create/edit dialog. The
 * parent owns the "adding" state so the kind dropdown in the section header
 * can open this dialog in the right mode.
 */
export function TriggersSectionContent({
  agent,
  addingKind,
  onAddingKindChange,
}: TriggersSectionContentProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null)
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

  const rows = triggers.data ?? []

  const isDialogOpen = !!addingKind || !!editingTrigger
  const dialogKind: 'scheduled' | 'event' =
    editingTrigger?.kind === 'event'
      ? 'event'
      : editingTrigger?.kind === 'scheduled'
        ? 'scheduled'
        : (addingKind ?? 'scheduled')

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return
    onAddingKindChange(null)
    setEditingTrigger(null)
  }

  return (
    <div className='space-y-4'>
      <AgentTriggerDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        agentId={agent.id}
        kind={dialogKind}
        trigger={editingTrigger ?? undefined}
        onSuccess={() => utils.agentTrigger.list.invalidate({ agentId: agent.id })}
      />

      {triggers.isLoading ? (
        <EmptySection loading className='mx-3' />
      ) : rows.length === 0 ? (
        <EmptySection
          icon={<Zap className='size-4' />}
          title='No triggers yet'
          description='Add one to fire this agent autonomously.'
          className='mx-3'
        />
      ) : (
        <div className='flex flex-col pe-3'>
          {rows.map((row) => {
            const meta = KIND_META[row.kind as TriggerKind]
            const lastFiredLabel = row.lastFiredAt
              ? `Last run ${new Date(row.lastFiredAt).toLocaleString()}`
              : 'Never run'
            const isDirectEventRow =
              row.kind === 'event' && !row.entityDefinitionId && !!row.eventType
            const isEditable = row.kind !== 'app' && !isDirectEventRow
            return (
              <TreeRow
                key={row.id}
                icon={
                  <Tooltip content={meta.label}>
                    <span className='inline-flex'>
                      <EntityIcon
                        iconId={meta.iconId}
                        color={meta.color}
                        size='sm'
                        inverse
                        className='inset-shadow-xs inset-shadow-black/20'
                      />
                    </span>
                  </Tooltip>
                }
                title={
                  <Tooltip content={lastFiredLabel}>
                    <span className='inline-flex items-center gap-1'>
                      <TriggerLabel row={row} />
                      {row.lastError ? <AlertTriangle className='size-3 text-destructive' /> : null}
                    </span>
                  </Tooltip>
                }
                actions={
                  <>
                    {isEditable ? (
                      <Tooltip side='left' content='Edit trigger'>
                        <button
                          type='button'
                          onClick={() => setEditingTrigger(row)}
                          className='p-1 rounded-md hover:bg-primary/5 opacity-0 group-hover/tree-row:opacity-100'
                          aria-label='Edit trigger'>
                          <Pencil className='size-4 text-muted-foreground' />
                        </button>
                      </Tooltip>
                    ) : null}
                    <Tooltip side='left' content='Delete trigger'>
                      <button
                        type='button'
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
                        className='p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100'
                        aria-label='Delete trigger'>
                        <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
                      </button>
                    </Tooltip>
                    <Switch
                      size='sm'
                      className='ml-1'
                      checked={row.enabled}
                      onCheckedChange={(checked) =>
                        updateTrigger.mutate({ id: row.id, enabled: checked })
                      }
                    />
                  </>
                }
              />
            )
          })}
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
