// apps/web/src/components/apps/ui/connection-picker-popover.tsx
'use client'

import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { type ReactNode, useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { api } from '~/trpc/react'
import { useConnectFlow } from '../hooks/use-connect-flow'
import { AppIcon } from './app-icon'
import { ConnectionPicker, type PickerConnection, type PickerKind } from './connection-picker'
import { SecretConnectionForm } from './secret-connection-form'

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
   * When set, a "+ New connection" footer mints an `integration` secret of this
   * type and calls `onCreated` with the new credentialId.
   */
  createConnection?: { type: string; label: string }
  /** Fires with the new credentialId after "+ New connection" succeeds. */
  onCreated?: (credentialId: string) => void
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
 * Popover-wrapped {@link ConnectionPicker}. Owns the `credentials.list` query,
 * the trigger label, and the "+ New connection" mint flow. The cross-feature
 * replacement for `AppAccountPopover` — see
 * plans/data-connectors/claude/05b-connection-picker.md.
 */
export function ConnectionPickerPopover({
  value,
  onPick,
  kinds = DEFAULT_KINDS,
  orgScopedOnly = true,
  createConnection,
  onCreated,
  enableActions = true,
  placeholder = 'Choose connection',
  trigger,
  matchTriggerWidth = false,
}: ConnectionPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editRow, setEditRow] = useState<PickerConnection | null>(null)
  const utils = api.useUtils()
  const { appInstallations } = useAppsContext()

  const listInput = { kind: kinds, orgScopedOnly }
  const { data: connections = [] } = api.credentials.list.useQuery(listInput, {
    refetchOnWindowFocus: false,
  })

  // Reconnect (app rows): re-authorize via the shared connect flow, which does a
  // silent token refresh → OAuth popup, or the secret/variable re-entry form.
  const flow = useConnectFlow({
    onConnected: () => void utils.credentials.list.invalidate(listInput),
  })

  const handleReconnect = (row: PickerConnection) => {
    const inst = row.appId ? appInstallations.find((i) => i.app.id === row.appId) : undefined
    if (!inst) {
      toastError({
        title: 'App not installed',
        description: 'Reconnect this account from the app’s settings instead.',
      })
      return
    }
    setOpen(false)
    flow.start({
      target: {
        appId: inst.app.id,
        appSlug: inst.app.slug,
        appTitle: inst.app.title,
        installationId: inst.installationId,
        connectionDefinitions: inst.connectionDefinitions ?? {},
      },
      scope: row.scope,
      connectionId: row.id, // reconnect the existing cred, not a fresh connect
    })
  }

  // Edit (integration secrets): re-enter the API key. `mergeSecrets` keeps any
  // other stored fields untouched.
  const updateCredential = api.credentials.update.useMutation()
  const handleEditSubmit = (secret: string) => {
    if (!editRow) return
    updateCredential.mutate(
      { id: editRow.id, data: { apiKey: secret } },
      {
        onSuccess: () => {
          setEditRow(null)
          void utils.credentials.list.invalidate(listInput)
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

  const createCredential = api.credentials.create.useMutation()

  const handleCreate = (secret: string) => {
    if (!createConnection) return
    createCredential.mutate(
      {
        type: createConnection.type,
        name: createConnection.label,
        kind: 'integration',
        data: { apiKey: secret },
      },
      {
        onSuccess: ({ id }) => {
          setFormOpen(false)
          setOpen(false)
          void utils.credentials.list.invalidate(listInput)
          onCreated?.(id)
        },
        onError: (error) =>
          toastError({ title: 'Error creating connection', description: error.message }),
      }
    )
  }

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
            onCreateNew={createConnection ? () => setFormOpen(true) : undefined}
            onReconnect={enableActions ? handleReconnect : undefined}
            onEdit={
              enableActions
                ? (row) => {
                    setOpen(false)
                    setEditRow(row)
                  }
                : undefined
            }
          />
        </PopoverContentDialogAware>
      </Popover>

      {createConnection && (
        <SecretConnectionForm
          open={formOpen}
          onOpenChange={setFormOpen}
          connectionLabel={createConnection.label}
          connectionType='organization'
          pending={createCredential.isPending}
          onSubmit={handleCreate}
        />
      )}

      {editRow && (
        <SecretConnectionForm
          open={!!editRow}
          onOpenChange={(next) => {
            if (!next) setEditRow(null)
          }}
          connectionLabel={editRow.label ?? editRow.name}
          connectionType='organization'
          pending={updateCredential.isPending}
          onSubmit={handleEditSubmit}
        />
      )}

      {/* Reconnect dialogs (secret / variable re-entry) owned by the connect flow. */}
      {flow.Dialogs}
    </>
  )
}
