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
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'
import {
  type AppTriggerSource,
  TriggerSourcePickerPopover,
  type WebhookEndpointSource,
} from '~/components/pickers/trigger-source'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { useAgentAccess } from '../../../hooks/use-agent-access'
import type { AgentDetail } from '../../../store/agent-store'
import { AgentTriggerDialog } from './agent-trigger-dialog'
import { TriggerLabel } from './trigger-label'

type Trigger = RouterOutputs['agentTrigger']['list'][number]

type TriggerKind =
  | 'scheduled'
  | 'event'
  | 'app'
  | 'webhook-endpoint'
  | 'mention'
  | 'assignment'
  | 'dm'

/** What the kind dropdown can request: scheduled/event open directly, `source` opens the picker. */
type AddingKind = 'scheduled' | 'event' | 'source' | null
type BuiltinKind = 'mention' | 'assignment' | 'dm'

const BUILTIN_KINDS: BuiltinKind[] = ['mention', 'assignment', 'dm']

const KIND_META: Record<
  TriggerKind,
  { label: string; iconId: string; color: string; description?: string }
> = {
  scheduled: { label: 'Scheduled', iconId: 'clock', color: 'blue' },
  event: { label: 'Event', iconId: 'zap', color: 'amber' },
  app: { label: 'App', iconId: 'plug', color: 'violet' },
  'webhook-endpoint': { label: 'Webhook', iconId: 'webhook', color: 'teal' },
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
  addingKind: AddingKind
  onAddingKindChange: (kind: AddingKind) => void
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
  const [pendingAppSelection, setPendingAppSelection] = useState<AppTriggerSource | null>(null)
  const [pendingWebhookSelection, setPendingWebhookSelection] =
    useState<WebhookEndpointSource | null>(null)
  const { appInstallations } = useAppsContext()
  const utils = api.useUtils()
  // Triggers are ADMINISTRATION, not authoring (plan 25 §4.2): a trigger makes
  // the agent act autonomously on its own credentials, with no invoker to
  // intersect against. All four `agentTrigger` writes — create, update, delete,
  // runNow — assert `admin` server-side, so every affordance here (edit, delete,
  // and the enable switch, which is an `update`) follows.
  const { canAdmin } = useAgentAccess(agent.id)

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

  // The unified picker is open whenever the user picked "Trigger" from the dropdown
  // but hasn't chosen an app trigger / webhook endpoint yet.
  const isPickerOpen = addingKind === 'source' && !pendingAppSelection && !pendingWebhookSelection

  // The config dialog opens for: editing a row, creating a built-in row,
  // creating a scheduled/event row, OR after the user picked a source.
  const isDialogOpen =
    !!editingTrigger ||
    !!creatingBuiltinKind ||
    addingKind === 'scheduled' ||
    addingKind === 'event' ||
    !!pendingAppSelection ||
    !!pendingWebhookSelection

  const dialogKind: TriggerKind = editingTrigger?.kind
    ? (editingTrigger.kind as TriggerKind)
    : creatingBuiltinKind
      ? creatingBuiltinKind
      : pendingAppSelection
        ? 'app'
        : pendingWebhookSelection
          ? 'webhook-endpoint'
          : addingKind === 'event'
            ? 'event'
            : 'scheduled'

  const appSelectionForDialog = pendingAppSelection
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

  const webhookSelectionForDialog = pendingWebhookSelection
    ? {
        webhookEndpointId: pendingWebhookSelection.endpoint.id,
        endpointName: pendingWebhookSelection.endpoint.name,
        endpointUrl: pendingWebhookSelection.endpoint.url,
        hasTopicSource: !!pendingWebhookSelection.endpoint.topicSource,
      }
    : undefined

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return
    onAddingKindChange(null)
    setEditingTrigger(null)
    setCreatingBuiltinKind(null)
    setPendingAppSelection(null)
    setPendingWebhookSelection(null)
  }

  const handlePickerOpenChange = (open: boolean) => {
    if (!open && addingKind === 'source') {
      onAddingKindChange(null)
    }
  }

  const handleSourceSelected = (source: AppTriggerSource | WebhookEndpointSource) => {
    if (source.kind === 'app') setPendingAppSelection(source)
    else setPendingWebhookSelection(source)
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
      {/* The picker has no inline trigger (it's opened from the section-header "Add trigger"
          dropdown), so it anchors to a zero-height element at the top of the list and aligns
          to the end — i.e. it floats just under the "Add trigger" button. */}
      <TriggerSourcePickerPopover
        open={isPickerOpen}
        onOpenChange={handlePickerOpenChange}
        onSelect={handleSourceSelected}
        surface='agent'
        align='end'
        anchor={<div className='h-0 w-full' aria-hidden />}
      />

      <AgentTriggerDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        agentId={agent.id}
        kind={dialogKind}
        trigger={editingTrigger ?? undefined}
        appSelection={appSelectionForDialog}
        webhookSelection={webhookSelectionForDialog}
        onSuccess={invalidateList}
        onRepick={() => {
          setEditingTrigger(null)
          setCreatingBuiltinKind(null)
          setPendingAppSelection(null)
          setPendingWebhookSelection(null)
          onAddingKindChange('source')
        }}
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
                  isEditable={canAdmin}
                  isDeletable={false}
                  readOnly={!canAdmin}
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
                isEditable={canAdmin}
                isDeletable={false}
                readOnly={!canAdmin}
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
                isEditable={canAdmin && isEditable}
                isDeletable={canAdmin}
                readOnly={!canAdmin}
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
  /** The viewer lacks `admin` on this agent — the enable switch is frozen too. */
  readOnly?: boolean
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
  readOnly,
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
          <Switch
            size='xs'
            className='ml-1'
            checked={enabled}
            disabled={readOnly}
            onCheckedChange={onToggle}
          />
        </>
      }
    />
  )
}
