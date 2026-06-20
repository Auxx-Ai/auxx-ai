// apps/web/src/components/apps/ui/connection-picker-popover.tsx
'use client'

import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { type ReactNode, useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { ConnectionDetailDialog } from '~/components/connections/ui/connection-detail-dialog'
import type { DetailMethod } from '~/components/connections/ui/connection-detail-page'
import { appTarget, platformTarget } from '~/components/connections/ui/connection-targets'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { api } from '~/trpc/react'
import { useConnectFlow } from '../hooks/use-connect-flow'
import { AppIcon } from './app-icon'
import { ConnectionPicker, type PickerConnection, type PickerKind } from './connection-picker'

interface ConnectionPickerPopoverProps {
  /** Currently-bound credentialId. */
  value: string | undefined
  /** Fires when an existing connection is picked (row carries `appInstallationId`). */
  onPick: (credentialId: string, connection: PickerConnection) => void
  /** Credential families to list. Defaults to all bindable kinds. */
  kinds?: PickerKind[]
  /**
   * Restrict to org-scoped (workspace) connections, excluding personal/user
   * creds. Defaults to true — background resources must bind org-scoped creds.
   */
  orgScopedOnly?: boolean
  /**
   * When set, a "+ New connection" footer defers creation to the parent (e.g. open
   * the full connection catalog scoped to one app/provider). The footer shows only
   * when this is provided.
   */
  onCreateNew?: () => void
  /**
   * Enable per-row actions: Reconnect (app rows) + Edit (integration secrets).
   * Defaults to true. Set false for a pure read-only picker (05c §4).
   */
  enableActions?: boolean
  /** Trigger placeholder when nothing is bound. */
  placeholder?: string
  /** Override the trigger button. */
  trigger?: ReactNode
  /** Match the popover width to the trigger (for full-width form fields). */
  matchTriggerWidth?: boolean
}

const DEFAULT_KINDS: PickerKind[] = ['app', 'integration', 'workflow']

/**
 * Popover-wrapped {@link ConnectionPicker}. Owns the `connections.list` query,
 * the trigger label, and the "+ New connection" flow. The cross-feature
 * replacement for `AppAccountPopover` — see
 * plans/data-connectors/claude/05b-connection-picker.md.
 */
export function ConnectionPickerPopover({
  value,
  onPick,
  kinds = DEFAULT_KINDS,
  orgScopedOnly = true,
  onCreateNew,
  enableActions = true,
  placeholder = 'Choose connection',
  trigger,
  matchTriggerWidth = false,
}: ConnectionPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [editRow, setEditRow] = useState<PickerConnection | null>(null)
  const utils = api.useUtils()
  const { appInstallations } = useAppsContext()

  const listInput = { kind: kinds, orgScopedOnly }
  const { data: connections = [] } = api.connections.list.useQuery(listInput, {
    refetchOnWindowFocus: false,
  })

  // Platform provider catalog, keyed by providerKey (= Credential.type) — drives the
  // OAuth-vs-secret routing so a platform OAuth row reconnects instead of showing the API form.
  const { data: providers = [] } = api.connections.listProviders.useQuery()
  const providerByKey = useMemo(
    () => new Map(providers.map((p) => [p.providerKey, p])),
    [providers]
  )

  // Reconnect (app rows): re-authorize via the shared connect flow, which does a
  // silent token refresh → OAuth popup, or the secret/variable re-entry form.
  const flow = useConnectFlow({
    onConnected: () => void utils.connections.list.invalidate(listInput),
  })

  // Reconnect re-authorizes (oauth) or re-enters (secret) the existing credential via the flow —
  // app rows via their installation, platform rows via the provider catalog. Mirrors connections-section.
  const handleReconnect = (row: PickerConnection) => {
    if (row.kind === 'app') {
      const inst = appInstallations.find((i) => i.app.id === row.appId)
      if (!inst) {
        toastError({
          title: 'App not installed',
          description: 'Reconnect this account from the app’s settings instead.',
        })
        return
      }
      flow.start({ target: appTarget(inst), scope: row.scope, connectionId: row.id })
      return
    }
    const provider = providerByKey.get(row.type)
    if (!provider) {
      toastError({
        title: 'Provider unavailable',
        description: 'This connection’s provider is no longer registered.',
      })
      return
    }
    flow.start({ target: platformTarget(provider), scope: row.scope, connectionId: row.id })
  }

  // Plain integration/workflow secrets with no platform definition edit a single API key in
  // place; everything else (apps, platform providers) routes through the flow.
  const isPlainSecret = (row: PickerConnection) =>
    row.kind !== 'app' && !providerByKey.get(row.type)

  const handleAction = (row: PickerConnection) => {
    setOpen(false)
    if (isPlainSecret(row)) setEditRow(row)
    else handleReconnect(row)
  }

  // Synthetic bare-secret method backing the in-place edit dialog (stable so it seeds once per open).
  const editMethod = useMemo<DetailMethod | null>(
    () =>
      editRow
        ? {
            id: editRow.id,
            label: editRow.label ?? editRow.name,
            description: null,
            connectionType: 'secret',
            global: editRow.scope !== 'user',
            connectionVariables: [],
          }
        : null,
    [editRow]
  )

  // Edit (plain integration/workflow secrets): re-enter the API key. `mergeSecrets` keeps any
  // other stored fields untouched.
  const updateCredential = api.connections.update.useMutation()
  const handleEditSubmit = (secret: string) => {
    if (!editRow) return
    updateCredential.mutate(
      { id: editRow.id, data: { apiKey: secret } },
      {
        onSuccess: () => {
          setEditRow(null)
          void utils.connections.list.invalidate(listInput)
        },
        onError: (error) =>
          toastError({ title: 'Error updating connection', description: error.message }),
      }
    )
  }

  const selected = useMemo(() => connections.find((c) => c.id === value), [connections, value])
  const triggerIconId = useMemo(() => {
    if (!selected?.appId) return null
    return appInstallations.find((i) => i.app.id === selected.appId)?.app.avatarUrl ?? null
  }, [appInstallations, selected])
  const triggerLabel = selected?.label ?? selected?.name ?? null

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {trigger ?? (
            <PickerTrigger
              open={open}
              hasValue={!!triggerLabel}
              placeholder={placeholder}
              size='default'
              variant='outline'>
              {triggerIconId && <AppIcon iconId={triggerIconId} size='sm' />}
              <span className='truncate'>{triggerLabel}</span>
            </PickerTrigger>
          )}
        </PopoverTrigger>
        <PopoverContentDialogAware
          className={matchTriggerWidth ? 'w-[var(--radix-popover-trigger-width)] p-0' : 'w-80 p-0'}
          align='start'>
          <ConnectionPicker
            value={value}
            connections={connections}
            onPick={(credentialId, connection) => {
              onPick(credentialId, connection)
              setOpen(false)
            }}
            onCreateNew={
              onCreateNew
                ? () => {
                    setOpen(false)
                    onCreateNew()
                  }
                : undefined
            }
            onAction={enableActions ? handleAction : undefined}
            providerByKey={providerByKey}
          />
        </PopoverContentDialogAware>
      </Popover>

      {editRow && editMethod && (
        <ConnectionDetailDialog
          open={!!editRow}
          onOpenChange={(next) => {
            if (!next) setEditRow(null)
          }}
          title={`Edit ${editRow.label ?? editRow.name}`}
          method={editMethod}
          connectionId={editRow.id}
          pending={updateCredential.isPending}
          submitLabel='Save'
          onSubmit={(payload) => handleEditSubmit(payload.secret ?? '')}
        />
      )}

      {/* Reconnect dialogs (secret / variable re-entry) owned by the connect flow. */}
      {flow.Dialogs}
    </>
  )
}
