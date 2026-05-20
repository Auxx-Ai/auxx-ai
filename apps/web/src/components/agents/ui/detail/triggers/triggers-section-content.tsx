// apps/web/src/components/agents/ui/detail/triggers/triggers-section-content.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptySection } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { api, type RouterOutputs } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import {
  AgentAppTriggerPickerDialog,
  type AppTriggerSelection,
} from './agent-app-trigger-picker-dialog'
import { AgentTriggerDialog } from './agent-trigger-dialog'
import { TriggerLabel } from './trigger-label'

type Trigger = RouterOutputs['agentTrigger']['list'][number]

type TriggerKind = 'scheduled' | 'event' | 'app' | 'mention' | 'assignment' | 'dm'
type BuiltinKind = 'mention' | 'assignment' | 'dm'

const BUILTIN_KINDS: BuiltinKind[] = ['mention', 'assignment', 'dm']

const KIND_META: Record<
  TriggerKind,
  { label: string; iconId: string; color: string; description?: string }
> = {
  scheduled: { label: 'Scheduled', iconId: 'clock', color: 'blue' },
  event: { label: 'Event', iconId: 'zap', color: 'amber' },
  app: { label: 'App', iconId: 'plug', color: 'violet' },
  mention: {
    label: 'Mention',
    iconId: 'at-sign',
    color: 'emerald',
    description: 'Fires whenever this agent is @-mentioned in a comment.',
  },
  assignment: {
    label: 'Assignment',
    iconId: 'user-plus',
    color: 'sky',
    description: 'Fires whenever this agent is assigned to a ticket.',
  },
  dm: {
    label: 'Direct message',
    iconId: 'message-circle',
    color: 'rose',
    description: 'Fires whenever a user direct-messages this agent.',
  },
}

interface TriggersSectionContentProps {
  agent: AgentDetail
  addingKind: 'scheduled' | 'event' | 'app' | null
  onAddingKindChange: (kind: 'scheduled' | 'event' | 'app' | null) => void
}

/**
 * Triggers tab body — list of agent triggers + create/edit dialog. The
 * parent owns the "adding" state so the kind dropdown in the section header
 * can open this dialog in the right mode.
 *
 * The two built-in kinds (`mention`, `assignment`) always render — when no DB
 * row exists yet, a virtual placeholder row is shown. Flipping its switch
 * creates the row on the fly; clicking edit opens the dialog in create mode.
 */
export function TriggersSectionContent({
  agent,
  addingKind,
  onAddingKindChange,
}: TriggersSectionContentProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null)
  const [creatingBuiltinKind, setCreatingBuiltinKind] = useState<BuiltinKind | null>(null)
  const [pendingAppSelection, setPendingAppSelection] = useState<AppTriggerSelection | null>(null)
  const { appInstallations } = useExtensionsContext()
  const utils = api.useUtils()

  const triggers = api.agentTrigger.list.useQuery({ agentId: agent.id })

  const invalidateList = () => utils.agentTrigger.list.invalidate({ agentId: agent.id })

  const updateTrigger = api.agentTrigger.update.useMutation({
    onSuccess: invalidateList,
    onError: (err) => toastError({ title: 'Failed to update trigger', description: err.message }),
  })

  const deleteTrigger = api.agentTrigger.delete.useMutation({
    onSuccess: invalidateList,
    onError: (err) => toastError({ title: 'Failed to delete trigger', description: err.message }),
  })

  const createTrigger = api.agentTrigger.create.useMutation({
    onSuccess: invalidateList,
    onError: (err) => toastError({ title: 'Failed to enable trigger', description: err.message }),
  })

  const rows = triggers.data ?? []

  const builtinByKind: Record<BuiltinKind, Trigger | undefined> = {
    mention: rows.find((r) => r.kind === 'mention'),
    assignment: rows.find((r) => r.kind === 'assignment'),
    dm: rows.find((r) => r.kind === 'dm'),
  }
  const customRows = rows.filter(
    (r) => r.kind !== 'mention' && r.kind !== 'assignment' && r.kind !== 'dm'
  )

  // App-picker dialog is open whenever the user picked "App" from the dropdown
  // but hasn't selected a (app, trigger) pair yet.
  const isAppPickerOpen = addingKind === 'app' && !pendingAppSelection

  // The config dialog opens for: editing a row, creating a built-in row,
  // creating a scheduled/event row, OR after the user picked an app trigger.
  const isDialogOpen =
    !!editingTrigger ||
    !!creatingBuiltinKind ||
    addingKind === 'scheduled' ||
    addingKind === 'event' ||
    (addingKind === 'app' && !!pendingAppSelection)

  const dialogKind: TriggerKind = editingTrigger?.kind
    ? (editingTrigger.kind as TriggerKind)
    : creatingBuiltinKind
      ? creatingBuiltinKind
      : addingKind === 'app'
        ? 'app'
        : (addingKind ?? 'scheduled')

  const appSelectionForDialog =
    addingKind === 'app' && pendingAppSelection
      ? {
          installationId: pendingAppSelection.installation.installationId,
          appId: pendingAppSelection.installation.app.id,
          appTitle: pendingAppSelection.installation.app.title,
          appAvatarUrl: pendingAppSelection.installation.app.avatarUrl,
          triggerId: pendingAppSelection.trigger.triggerId,
          triggerLabel: pendingAppSelection.trigger.label,
          triggerDescription: pendingAppSelection.trigger.description,
          inputsJsonSchema: pendingAppSelection.trigger.inputsJsonSchema,
        }
      : undefined

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return
    onAddingKindChange(null)
    setEditingTrigger(null)
    setCreatingBuiltinKind(null)
    setPendingAppSelection(null)
  }

  const handleAppPickerOpenChange = (open: boolean) => {
    if (!open && addingKind === 'app') {
      onAddingKindChange(null)
    }
  }

  const handleAppSelected = (selection: AppTriggerSelection) => {
    setPendingAppSelection(selection)
  }

  const handleDelete = async (row: Trigger) => {
    const confirmed = await confirm({
      title: 'Delete trigger?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteTrigger.mutate({ id: row.id })
  }

  return (
    <div className='space-y-4'>
      <AgentAppTriggerPickerDialog
        open={isAppPickerOpen}
        onOpenChange={handleAppPickerOpenChange}
        onSelect={handleAppSelected}
      />

      <AgentTriggerDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        agentId={agent.id}
        kind={dialogKind}
        trigger={editingTrigger ?? undefined}
        appSelection={appSelectionForDialog}
        onSuccess={invalidateList}
      />

      {triggers.isLoading ? (
        <EmptySection loading className='mx-3' />
      ) : (
        <div className='flex flex-col pe-4'>
          {BUILTIN_KINDS.map((kind) => {
            const existing = builtinByKind[kind]
            if (existing) {
              return (
                <TriggerRow
                  key={existing.id}
                  meta={KIND_META[kind]}
                  title={<TriggerLabel row={existing} />}
                  description={KIND_META[kind].description}
                  lastFiredAt={existing.lastFiredAt}
                  hasError={!!existing.lastError}
                  enabled={existing.enabled}
                  isEditable
                  isDeletable={false}
                  onEdit={() => setEditingTrigger(existing)}
                  onToggle={(checked) =>
                    updateTrigger.mutate({ id: existing.id, enabled: checked })
                  }
                />
              )
            }
            return (
              <TriggerRow
                key={`virtual-${kind}`}
                meta={KIND_META[kind]}
                title={<span className='text-muted-foreground'>On {kind}</span>}
                description={KIND_META[kind].description}
                lastFiredAt={null}
                hasError={false}
                enabled={false}
                isEditable
                isDeletable={false}
                onEdit={() => setCreatingBuiltinKind(kind)}
                onToggle={(checked) => {
                  if (!checked) return
                  createTrigger.mutate({
                    agentId: agent.id,
                    enabled: true,
                    trigger: { kind },
                  })
                }}
              />
            )
          })}

          {customRows.map((row) => {
            const meta = KIND_META[row.kind as TriggerKind]
            const isDirectEventRow =
              row.kind === 'event' && !row.entityDefinitionId && !!row.eventType
            const isEditable = !isDirectEventRow

            let iconOverride: ReactNode | undefined
            if (row.kind === 'app' && row.triggerAppId) {
              const installation =
                appInstallations.find((i) => i.installationId === row.triggerInstallationId) ??
                appInstallations.find((i) => i.app.id === row.triggerAppId)
              const avatarUrl = installation?.app.avatarUrl
              if (avatarUrl) {
                iconOverride = (
                  <Tooltip content={installation?.app.title ?? meta.label}>
                    <span className='inline-flex'>
                      <AppIcon iconId={avatarUrl} size='sm' />
                    </span>
                  </Tooltip>
                )
              }
            }

            return (
              <TriggerRow
                key={row.id}
                meta={meta}
                icon={iconOverride}
                title={<TriggerLabel row={row} />}
                lastFiredAt={row.lastFiredAt}
                hasError={!!row.lastError}
                enabled={row.enabled}
                isEditable={isEditable}
                isDeletable
                onEdit={() => setEditingTrigger(row)}
                onDelete={() => handleDelete(row)}
                onToggle={(checked) => updateTrigger.mutate({ id: row.id, enabled: checked })}
              />
            )
          })}
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}

interface TriggerRowProps {
  meta: { label: string; iconId: string; color: string }
  /** When provided, replaces the default EntityIcon for this row. */
  icon?: ReactNode
  title: ReactNode
  description?: string
  lastFiredAt: string | null
  hasError: boolean
  enabled: boolean
  isEditable: boolean
  isDeletable: boolean
  onEdit?: () => void
  onDelete?: () => void
  onToggle: (checked: boolean) => void
}

/**
 * One row in the triggers list. Used for both real (DB-backed) triggers and
 * the two virtual built-in rows (`mention`, `assignment`) that show before
 * a row exists.
 */
function TriggerRow({
  meta,
  icon,
  title,
  description,
  lastFiredAt,
  hasError,
  enabled,
  isEditable,
  isDeletable,
  onEdit,
  onDelete,
  onToggle,
}: TriggerRowProps) {
  const lastFiredLabel = lastFiredAt
    ? `Last run ${new Date(lastFiredAt).toLocaleString()}`
    : 'Never run'

  return (
    <TreeRow
      description={description}
      icon={
        icon ?? (
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
        )
      }
      title={
        <Tooltip content={lastFiredLabel} allowInteraction>
          <span className='inline-flex items-center gap-1'>
            {title}
            {hasError ? <AlertTriangle className='size-3 text-destructive' /> : null}
          </span>
        </Tooltip>
      }
      actions={
        <>
          {isEditable && onEdit ? (
            <Tooltip side='left' content='Edit trigger' allowInteraction>
              <button
                type='button'
                onClick={onEdit}
                className='p-1 rounded-md hover:bg-primary/5 opacity-0 group-hover/tree-row:opacity-100'
                aria-label='Edit trigger'>
                <Pencil className='size-4 text-muted-foreground' />
              </button>
            </Tooltip>
          ) : null}
          {isDeletable && onDelete ? (
            <Tooltip side='left' content='Delete trigger' allowInteraction>
              <button
                type='button'
                onClick={onDelete}
                className='p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100'
                aria-label='Delete trigger'>
                <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
              </button>
            </Tooltip>
          ) : null}
          <Switch size='xs' className='ml-1' checked={enabled} onCheckedChange={onToggle} />
        </>
      }
    />
  )
}
