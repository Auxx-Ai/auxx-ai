// apps/web/src/components/connections/ui/connections-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { Plug, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useConnectFlow } from '~/components/apps/hooks/use-connect-flow'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { SecretConnectionForm } from '~/components/apps/ui/secret-connection-form'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { AddConnectionDialog } from './add-connection-dialog'
import { ConnectionCard, type ConnectionRow } from './connection-card'
import { appTarget, platformTarget } from './connection-targets'

/**
 * Settings → Channels → Connections. A unified card grid of every connection the
 * viewer may see, with a "+ New connection" catalog (platform providers + installable
 * apps). Mirrors the apps/MCP section. See plans/connections/unify-connection-definition.md §15.
 */
export function ConnectionsSection() {
  const { isAdminOrOwner } = useUser()
  const { appInstallations } = useAppsContext()
  const utils = api.useUtils()

  const { data: connections = [] } = api.connections.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  })
  const { data: providers = [], isLoading: providersLoading } =
    api.connections.listProviders.useQuery()

  const [addOpen, setAddOpen] = useState(false)
  const [editRow, setEditRow] = useState<ConnectionRow | null>(null)
  const [search, setSearch] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  const providerByKey = useMemo(
    () => new Map(providers.map((p) => [p.providerKey, p])),
    [providers]
  )

  const invalidate = () => void utils.connections.list.invalidate()
  const flow = useConnectFlow({ onConnected: invalidate })

  const updateCredential = api.credentials.update.useMutation()
  const deleteCredential = api.credentials.delete.useMutation()

  // Installed apps that actually expose a connection (have a scoped definition).
  const connectableApps = useMemo(
    () =>
      appInstallations.filter(
        (i) => i.connectionDefinitions?.user || i.connectionDefinitions?.organization
      ),
    [appInstallations]
  )

  // app row → app logo; platform row → provider lucide icon; else a neutral fallback.
  const resolveIcon = (row: ConnectionRow): string => {
    const inst = row.appId ? appInstallations.find((i) => i.app.id === row.appId) : undefined
    if (inst?.app.avatarUrl) return inst.app.avatarUrl
    const provider = providerByKey.get(row.type)
    if (provider?.icon) return provider.icon
    return row.kind === 'app' ? 'package' : 'key-round'
  }

  const resolveSubtitle = (row: ConnectionRow): string => {
    const provider = providerByKey.get(row.type)
    if (provider) return provider.label
    const inst = row.appId ? appInstallations.find((i) => i.app.id === row.appId) : undefined
    return inst?.app.title ?? row.type
  }

  // Reconnect re-authorizes (oauth) or re-enters (secret) the existing credential —
  // the flow opens the right surface based on the definition's connectionType.
  const handleReconnect = (row: ConnectionRow) => {
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

  // Plain integration/workflow secrets with no platform definition edit a single API
  // key in-place; everything else (apps, platform providers) routes through the flow.
  const isPlainSecret = (row: ConnectionRow) => row.kind !== 'app' && !providerByKey.get(row.type)

  const handleEditSubmit = (secret: string) => {
    if (!editRow) return
    updateCredential.mutate(
      { id: editRow.id, data: { apiKey: secret } },
      {
        onSuccess: () => {
          setEditRow(null)
          invalidate()
        },
        onError: (error) =>
          toastError({ title: 'Error updating connection', description: error.message }),
      }
    )
  }

  const handleDelete = async (row: ConnectionRow) => {
    const ok = await confirm({
      title: 'Delete connection?',
      description: `Remove "${row.label ?? row.name}"? This cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    deleteCredential.mutate(
      { id: row.id },
      {
        onSuccess: invalidate,
        onError: (error) =>
          toastError({ title: 'Error deleting connection', description: error.message }),
      }
    )
  }

  const q = search.trim().toLowerCase()
  const visible = connections.filter((c) => {
    if (!q) return true
    return (
      (c.label ?? c.name).toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      resolveSubtitle(c).toLowerCase().includes(q)
    )
  })

  return (
    <SettingsSection
      icon={Plug}
      title='Connections'
      description='OAuth accounts, API keys, and database connections used by apps, workflows, and data connectors.'
      action={
        <Button variant='outline' size='sm' onClick={() => setAddOpen(true)}>
          <Plus />
          New connection
        </Button>
      }>
      {connections.length > 0 && (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search connections…'
          className='max-w-xs'
        />
      )}

      {connections.length === 0 ? (
        <div className='rounded-2xl border border-dashed bg-primary-50 p-8 text-center'>
          <p className='text-sm text-muted-foreground'>
            No connections yet. Add one to authorize an app, workflow, or data connector.
          </p>
          <Button variant='outline' size='sm' className='mt-3' onClick={() => setAddOpen(true)}>
            <Plus />
            New connection
          </Button>
        </div>
      ) : (
        <div className='w-full @container'>
          <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
            {visible.map((row) => (
              <ConnectionCard
                key={row.id}
                connection={row}
                iconId={resolveIcon(row)}
                subtitle={resolveSubtitle(row)}
                actionLabel={
                  row.kind === 'app' ||
                  providerByKey.get(row.type)?.connectionType === 'oauth2-code'
                    ? 'Reconnect'
                    : 'Edit'
                }
                onAction={() => (isPlainSecret(row) ? setEditRow(row) : handleReconnect(row))}
                onDelete={() => void handleDelete(row)}
              />
            ))}
          </div>
        </div>
      )}

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        providers={providers}
        installedApps={isAdminOrOwner ? connectableApps : []}
        isLoading={providersLoading}
        onConnected={invalidate}
      />

      {/* Plain-secret edit (single API key). Multi-field / OAuth rows reconnect via the flow. */}
      {editRow && (
        <SecretConnectionForm
          open={!!editRow}
          onOpenChange={(next) => {
            if (!next) setEditRow(null)
          }}
          connectionLabel={editRow.label ?? editRow.name}
          connectionType={editRow.scope === 'user' ? 'user' : 'organization'}
          pending={updateCredential.isPending}
          onSubmit={handleEditSubmit}
        />
      )}

      {/* Connect/reconnect dialogs (variable, secret) owned by the flow. */}
      {flow.Dialogs}
      <ConfirmDialog />
    </SettingsSection>
  )
}
