// apps/web/src/components/connections/ui/connections-section.tsx
'use client'

import { HIDDEN_VALUE } from '@auxx/credentials/crypto/client'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { toastError } from '@auxx/ui/components/toast'
import { Building2, ChevronUp, ComponentIcon, Plus, TriangleAlert, User } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useConnectFlow } from '~/components/apps/hooks/use-connect-flow'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { EmptyState } from '~/components/global/empty-state'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { AddConnectionDialog } from './add-connection-dialog'
import { ConnectionCard, type ConnectionRow } from './connection-card'
import { ConnectionDetailDialog } from './connection-detail-dialog'
import type { DetailMethod } from './connection-detail-page'
import { ConnectionStackCard } from './connection-stack-card'
import { appTarget, platformTarget } from './connection-targets'
import { type ConnectionGroup, groupConnections } from './group-connections'

/**
 * Settings → Channels → Connections. A unified card grid of every connection the
 * viewer may see, with a "+ New connection" catalog (platform providers + installable
 * apps). Mirrors the apps/MCP section. See plans/connections/unify-connection-definition.md §15.
 */
export function ConnectionsSection() {
  const { isAdminOrOwner } = useUser()
  const { appInstallations } = useAppsContext()
  const utils = api.useUtils()

  const { data: connections = [], isLoading: connectionsLoading } = api.connections.list.useQuery(
    undefined,
    { refetchOnWindowFocus: false }
  )
  const { data: providers = [], isLoading: providersLoading } =
    api.connections.listProviders.useQuery()

  const [addOpen, setAddOpen] = useState(false)
  const [editRow, setEditRow] = useState<ConnectionRow | null>(null)
  // One open stack per page (master-detail); cleared in search mode.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  const providerByKey = useMemo(
    () => new Map(providers.map((p) => [p.providerKey, p])),
    [providers]
  )

  const invalidate = () => void utils.connections.list.invalidate()
  const flow = useConnectFlow({ onConnected: invalidate })

  const updateCredential = api.connections.update.useMutation()
  const deleteCredential = api.connections.delete.useMutation()

  // Installed apps that actually expose a connection (have a scoped definition).
  const connectableApps = useMemo(
    () =>
      appInstallations.filter(
        (i) => i.connectionDefinitions?.user || i.connectionDefinitions?.organization
      ),
    [appInstallations]
  )

  // app row → app logo; channel/platform row → server-resolved brand mark (row.icon, which
  // covers both the channel-provider map and the platform catalog); else a neutral fallback.
  // Channel creds carry a ChannelProviderType ('google'/'outlook') in `type`, which isn't a
  // providerKey — so `providerByKey.get(row.type)` misses them; `row.icon` is the source of truth.
  const resolveIcon = (row: ConnectionRow): string => {
    const inst = row.appId ? appInstallations.find((i) => i.app.id === row.appId) : undefined
    if (inst?.app.avatarUrl) return inst.app.avatarUrl
    if (row.icon) return row.icon
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
  // key inline in the edit dialog; apps/platform providers rename inline and re-auth /
  // rotate their key through the flow's Reconnect button.
  const isPlainSecret = (row: ConnectionRow) => row.kind !== 'app' && !providerByKey.get(row.type)

  // Synthetic method backing the unified edit dialog. Plain secrets expose their single API-key
  // row; every other row is name-only here (re-auth / key rotation routes through Reconnect), so
  // they carry a fieldless oauth-shaped method. Cheap to recompute, so no memo.
  const editMethod: DetailMethod | null = editRow
    ? {
        id: editRow.connectionDefinitionId ?? editRow.id,
        label: editRow.label ?? editRow.name,
        description: null,
        connectionType: isPlainSecret(editRow) ? 'secret' : 'oauth2-code',
        global: editRow.scope !== 'user',
        connectionVariables: [],
      }
    : null

  // One Save persists a rename (label) and, for a plain secret, a rotated API key — both via
  // `connections.update`. A no-op (nothing changed) just closes.
  const handleEditSubmit = (payload: { name?: string; secret?: string }) => {
    if (!editRow) return
    const currentName = editRow.label ?? editRow.name
    const newLabel = payload.name?.trim()
    const labelChanged = !!newLabel && newLabel !== currentName
    const newSecret = payload.secret && payload.secret !== HIDDEN_VALUE ? payload.secret : undefined
    if (!labelChanged && !newSecret) {
      setEditRow(null)
      return
    }
    updateCredential.mutate(
      {
        id: editRow.id,
        ...(labelChanged && { label: newLabel }),
        ...(newSecret && { data: { apiKey: newSecret } }),
      },
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

  // Start a fresh connect for a group's owner (the expanded "+ Add" affordance), scoped to the
  // section the group sits in. App groups target the installation; provider groups the provider.
  const handleAddToGroup = (group: ConnectionGroup) => {
    const first = group.rows[0]
    if (first.kind === 'app') {
      const inst = appInstallations.find((i) => i.app.id === first.appId)
      if (inst) flow.start({ target: appTarget(inst), scope: group.scope })
      return
    }
    const provider = providerByKey.get(first.type)
    if (provider) flow.start({ target: platformTarget(provider), scope: group.scope })
  }

  const renderCard = (row: ConnectionRow) => (
    <ConnectionCard
      key={row.id}
      connection={row}
      iconId={resolveIcon(row)}
      subtitle={resolveSubtitle(row)}
      actionLabel='Edit'
      onAction={() => setEditRow(row)}
      onDelete={() => void handleDelete(row)}
    />
  )

  // One scope's section: group rows by owner, draw singles as plain cards and multi-row groups as
  // expandable stacks. Renders nothing when the scope has no connections.
  const renderScopeSection = (
    title: string,
    icon: typeof User,
    scopeRows: ConnectionRow[],
    scope: 'user' | 'organization'
  ) => {
    const groups = groupConnections(scopeRows, { iconId: resolveIcon, label: resolveSubtitle })
    if (groups.length === 0) return null
    // Workspace adds are admin-gated (mirrors the catalog); personal adds are always allowed.
    const canAdd = scope === 'user' || isAdminOrOwner
    return (
      <SettingsSection key={scope} icon={icon} title={title}>
        <div className='w-full @container'>
          <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
            {groups.map((group) => {
              if (group.rows.length === 1) return renderCard(group.rows[0])
              const isOpen = expandedKey === group.key
              const toggle = () => setExpandedKey((k) => (k === group.key ? null : group.key))
              if (!isOpen) {
                return <ConnectionStackCard key={group.key} group={group} onToggle={toggle} />
              }
              // Expanded: a self-contained block (header + nested cards) so it reads as the stack,
              // not loose top-level cards detached from a narrow tile.
              return (
                <div
                  key={group.key}
                  className='col-span-full flex flex-col gap-2 rounded-2xl border bg-muted/40 p-2'>
                  <button
                    type='button'
                    onClick={toggle}
                    className='flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left hover:bg-muted/60'>
                    <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background'>
                      <AppIcon iconId={group.iconId} size='sm' />
                    </div>
                    <span className='text-sm font-semibold'>{group.label}</span>
                    {group.expiredCount > 0 && (
                      <span className='flex items-center gap-1 rounded-lg border bg-primary-100 px-1.5 py-0.5 text-xs text-amber-700'>
                        <TriangleAlert className='size-3 text-amber-600' />
                        Needs attention
                      </span>
                    )}
                    <span className='ml-auto text-xs text-muted-foreground'>
                      {group.rows.length} connections
                    </span>
                    <ChevronUp className='size-4 shrink-0 text-muted-foreground' />
                  </button>
                  <div className='flex flex-col gap-2'>
                    {group.rows.map(renderCard)}
                    {canAdd && (
                      <Button
                        variant='outline'
                        size='sm'
                        className='w-full border-dashed'
                        onClick={() => handleAddToGroup(group)}>
                        <Plus />
                        Add {group.label}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </SettingsSection>
    )
  }

  const q = search.trim().toLowerCase()
  // Search hunts a single account — flatten across scopes/stacks so a match is never hidden
  // behind a count tile.
  const searchMatches = connections.filter(
    (c) =>
      (c.label ?? c.name).toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      resolveSubtitle(c).toLowerCase().includes(q)
  )
  const personal = connections.filter((c) => c.scope === 'user')
  const workspace = connections.filter((c) => c.scope === 'organization')

  return (
    <div className='flex flex-1 flex-col gap-4'>
      {connections.length > 0 && (
        <div className='flex items-center gap-2'>
          {/* Bound the InputSearch wrapper (it's `relative flex-1`), not just its inner input —
              otherwise the absolutely-positioned clear button pins to the full-width row's edge. */}
          <div className='w-full max-w-xs'>
            <InputSearch
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search connections…'
            />
          </div>
          <Button
            variant='outline'
            size='sm'
            className='ml-auto shrink-0'
            onClick={() => setAddOpen(true)}>
            <Plus />
            New connection
          </Button>
        </div>
      )}

      {connectionsLoading && connections.length === 0 ? (
        <EmptyState
          icon={ComponentIcon}
          iconClassName='animate-spin'
          title='Loading...'
          description={<>Hang on tight while we load your connections...</>}
          button={<div className='h-12'></div>}
        />
      ) : connections.length === 0 ? (
        <div className='rounded-2xl border border-dashed bg-primary-50 p-8 text-center'>
          <p className='text-sm text-muted-foreground'>
            No connections yet. Add one to authorize an app, workflow, or data connector.
          </p>
          <Button variant='outline' size='sm' className='mt-3' onClick={() => setAddOpen(true)}>
            <Plus />
            New connection
          </Button>
        </div>
      ) : q ? (
        // Search mode: flat grid, no scope sections, no stacks.
        <div className='w-full @container'>
          <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
            {searchMatches.map(renderCard)}
          </div>
        </div>
      ) : (
        <div className='flex flex-col gap-6'>
          {renderScopeSection('Personal', User, personal, 'user')}
          {renderScopeSection('Workspace', Building2, workspace, 'organization')}
        </div>
      )}

      {addOpen && (
        <AddConnectionDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          providers={providers}
          installedApps={isAdminOrOwner ? connectableApps : []}
          isLoading={providersLoading}
          onConnected={invalidate}
        />
      )}

      {/* Unified edit dialog: rename every row; plain secrets also re-enter their API key here,
          apps/platform rows re-auth or rotate via the Reconnect button (the flow). */}
      {editRow && editMethod && (
        <ConnectionDetailDialog
          open={!!editRow}
          onOpenChange={(next) => {
            if (!next) setEditRow(null)
          }}
          title={`Edit ${editRow.label ?? editRow.name}`}
          method={editMethod}
          // Plain secrets seed their masked key; name-only rows skip the load.
          connectionId={isPlainSecret(editRow) ? editRow.id : undefined}
          pending={updateCredential.isPending}
          submitLabel='Save'
          loadingText='Saving...'
          showName
          initialName={editRow.label ?? editRow.name}
          description={
            isPlainSecret(editRow)
              ? 'Rename this connection or update its API key.'
              : 'Rename this connection, or use Reconnect to re-authorize or update its credentials.'
          }
          onReconnect={
            isPlainSecret(editRow)
              ? undefined
              : () => {
                  const row = editRow
                  setEditRow(null)
                  handleReconnect(row)
                }
          }
          onSubmit={handleEditSubmit}
        />
      )}

      {/* Connect/reconnect dialogs (variable, secret) owned by the flow. */}
      {flow.Dialogs}
      <ConfirmDialog />
    </div>
  )
}
