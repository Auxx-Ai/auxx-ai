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
import { ConnectionCard, type ConnectionRow } from './connection-card'
import { ConnectionDetailDialog } from './connection-detail-dialog'
import type { DetailMethod } from './connection-detail-page'
import { ConnectionStackCard } from './connection-stack-card'
import { appTarget, optionalScopesHeld, platformTarget } from './connection-targets'
import { CredentialTemplateDialog } from './credential-template-dialog'
import { type ConnectionGroup, groupConnections } from './group-connections'
import { McpReconnectController } from './mcp-reconnect-controller'

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
  // MCP rows are owned by `mcpServerId` — look up their slug here to drive the MCP connect flow.
  const { data: mcpServers = [] } = api.mcp.list.useQuery()
  const mcpSlugByServer = useMemo(
    () => new Map(mcpServers.map((s) => [s.serverId, s.slug])),
    [mcpServers]
  )

  const [addOpen, setAddOpen] = useState(false)
  const [editRow, setEditRow] = useState<ConnectionRow | null>(null)
  // The optional scopes ticked in the edit dialog's picker (§4.5). Seeded from what the row
  // already holds when the dialog opens, so its Reconnect re-requests the existing grant rather
  // than dropping to the floor — and unticking one is how a user chooses to give it up.
  const [editScopes, setEditScopes] = useState<string[]>([])
  // The MCP server being (re)connected from a row's Reconnect — drives the connect controller. The
  // `attempt` nonce keys the controller so re-clicking Reconnect (even on the same server after a
  // cancel) always remounts it and re-fires the connect.
  const [reconnectMcp, setReconnectMcp] = useState<{ slug: string; attempt: number } | null>(null)
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
  const saveConnection = api.connections.save.useMutation()
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
    if (row.kind === 'app') return 'package'
    return row.kind === 'mcp' ? 'server' : 'key-round'
  }

  const resolveSubtitle = (row: ConnectionRow): string => {
    const provider = providerByKey.get(row.type)
    if (provider) return provider.label
    if (row.kind === 'mcp') return 'MCP server'
    const inst = row.appId ? appInstallations.find((i) => i.app.id === row.appId) : undefined
    return inst?.app.title ?? row.type
  }

  /**
   * The definition backing a row — an app's connection method, or the platform provider. Carries
   * the OAuth scope vocabulary (floor + optional) and the BYO gate the edit dialog's picker reads.
   * Undefined for MCP rows and definition-less secrets, which have no scopes to offer.
   */
  const scopeSourceForRow = (row: ConnectionRow) => {
    if (row.kind === 'app') {
      const inst = appInstallations.find((i) => i.app.id === row.appId)
      // Match the row's own method; single-method apps carry no `connectionDefinitionId` on
      // older rows, so fall back to the sole method rather than showing nothing.
      return (
        inst?.methods?.find((m) => m.id === row.connectionDefinitionId) ??
        (inst?.methods?.length === 1 ? inst.methods[0] : undefined)
      )
    }
    if (row.kind === 'mcp') return undefined
    return providerByKey.get(row.type)
  }

  // Reconnect re-authorizes (oauth) or re-enters (secret) the existing credential —
  // the flow opens the right surface based on the definition's connectionType.
  // `scopeAdd` carries the edit dialog's picks straight through to the authorize URL; when it is
  // omitted (the card's own Reconnect) the flow seeds it from the existing grant itself (§4.4).
  const handleReconnect = (row: ConnectionRow, scopeAdd?: string[]) => {
    if (row.kind === 'app') {
      const inst = appInstallations.find((i) => i.app.id === row.appId)
      if (!inst) {
        toastError({
          title: 'App not installed',
          description: 'Reconnect this account from the app’s settings instead.',
        })
        return
      }
      flow.start({
        target: appTarget(inst),
        scope: row.scope,
        connectionId: row.id,
        ...(scopeAdd && { scopeAdd }),
      })
      return
    }
    // MCP rows reconnect through the MCP-native flow (its own OAuth route + connect mutation),
    // keyed by the owning server's slug — never the platform provider path.
    if (row.kind === 'mcp') {
      const slug = row.mcpServerId ? mcpSlugByServer.get(row.mcpServerId) : undefined
      if (!slug) {
        toastError({
          title: 'MCP server unavailable',
          description: 'Reconnect this server from the MCP settings page instead.',
        })
        return
      }
      setReconnectMcp((prev) => ({ slug, attempt: (prev?.attempt ?? 0) + 1 }))
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
    flow.start({
      target: platformTarget(provider),
      scope: row.scope,
      connectionId: row.id,
      ...(scopeAdd && { scopeAdd }),
    })
  }

  // Plain connection secrets with no platform definition edit a single API key inline in the edit
  // dialog; apps/platform providers rename inline and re-auth / rotate their key through the flow's
  // Reconnect button. MCP rows are never plain secrets — they reconnect through the MCP flow.
  const isPlainSecret = (row: ConnectionRow) =>
    row.kind !== 'app' && row.kind !== 'mcp' && !providerByKey.get(row.type)

  // The platform provider backing this row (if any). Secret providers (e.g. AI API keys) edit
  // their credential fields inline; OAuth providers re-authorize through Reconnect.
  const editProvider = editRow ? providerByKey.get(editRow.type) : undefined
  // A row whose credentials are edited inline: a plain secret (bare API-key) or a provider-backed
  // secret (the provider's connection-variable form). OAuth/app rows stay name-only + Reconnect.
  const editInlineSecret = editRow
    ? isPlainSecret(editRow) || editProvider?.connectionType === 'secret'
    : false

  // The definition backing the row being edited — supplies the OAuth scope vocabulary and the
  // BYO gate the optional-scope picker hangs off (§4.1).
  const editSource = editRow ? scopeSourceForRow(editRow) : undefined

  // Synthetic method backing the unified edit dialog. Plain secrets expose a bare API-key row;
  // provider secrets expose the provider's fields (apiKey, base URL, …), seeded masked from
  // `getForEdit`; OAuth/app rows are fieldless (name-only) apart from the optional-scope picker.
  // Cheap to recompute, so no memo.
  const editMethod: DetailMethod | null = editRow
    ? {
        id: editRow.connectionDefinitionId ?? editRow.id,
        label: editRow.label ?? editRow.name,
        description: null,
        connectionType: editInlineSecret ? 'secret' : 'oauth2-code',
        global: editRow.scope !== 'user',
        connectionVariables:
          editProvider?.connectionType === 'secret' ? (editProvider.connectionVariables ?? []) : [],
        // The BYO gate rides along because `shouldOfferOptionalScopes` reads it — the picker
        // lives inside the "use your own OAuth client" disclosure. It adds no credential fields
        // here: `connectionVariables` above stays empty for OAuth rows, so the dialog keeps its
        // name-only Save and the disclosure only reveals the callback notice and the picker.
        ...(editInlineSecret
          ? {}
          : {
              requiresOwnClient: editSource?.requiresOwnClient,
              ownClientOptional: editSource?.ownClientOptional,
              ownClientReason: editSource?.ownClientReason,
              oauthCallbackUrl: editSource?.oauthCallbackUrl,
              oauth2Scopes: editSource?.oauth2Scopes,
              oauth2OptionalScopes: editSource?.oauth2OptionalScopes,
            }),
      }
    : null

  /** Open the edit dialog for a row, seeding the picker with the optional scopes it already holds. */
  const openEdit = (row: ConnectionRow) => {
    setEditRow(row)
    setEditScopes(optionalScopesHeld(row.grantedScopes, scopeSourceForRow(row) ?? {}))
  }

  const onEditSaved = () => {
    setEditRow(null)
    invalidate()
  }
  const onEditError = (error: { message: string }) =>
    toastError({ title: 'Error updating connection', description: error.message })

  // One Save persists a rename and the connection's credentials. Provider-backed secrets (e.g. AI
  // API keys, multi-field forms) route through `connections.save`, which splits values by the
  // def's secret flags and merges unchanged secrets on reconnect (no metadata wipe). Plain secrets
  // and name-only rows use `connections.update`. A no-op just closes.
  const handleEditSubmit = (payload: {
    name?: string
    secret?: string
    values?: Record<string, string>
  }) => {
    if (!editRow) return

    if (editProvider?.connectionType === 'secret') {
      saveConnection.mutate(
        {
          connectionDefinitionId: editRow.connectionDefinitionId ?? editRow.type,
          name: payload.name?.trim() || editRow.label || editRow.name,
          ...(payload.values && { values: payload.values }),
          ...(payload.secret && { secret: payload.secret }),
          connectionId: editRow.id,
        },
        { onSuccess: onEditSaved, onError: onEditError }
      )
      return
    }

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
      { onSuccess: onEditSaved, onError: onEditError }
    )
  }

  const handleDelete = async (row: ConnectionRow) => {
    // Guarded server-side too, but the menu item is disabled — bail before the confirm/mutation.
    if (row.usedByChannel) return
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
    if (!first) return
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
      onAction={() => openEdit(row)}
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
              const onlyRow = group.rows.length === 1 ? group.rows[0] : undefined
              if (onlyRow) return renderCard(onlyRow)
              const isOpen = expandedKey === group.key
              const toggle = () => setExpandedKey((k) => (k === group.key ? null : group.key))
              if (!isOpen) {
                return <ConnectionStackCard key={group.key} group={group} onToggle={toggle} />
              }
              // Expanded: a self-contained block (header + nested cards) so it reads as the stack,
              // not loose top-level cards detached from a narrow tile. It claims its own row
              // (`col-span-full`) so its height never stretches the sibling cards, but a nested grid
              // mirroring the column template caps the block to a single tile's width.
              return (
                <div key={group.key} className='col-span-full'>
                  <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
                    <div className='flex flex-col gap-2 rounded-2xl border bg-muted/40 p-2'>
                      {/* Header mirrors the collapsed face: icon, then title + "N connections" on a
                          second row, so toggling open/closed reads as the same card. */}
                      <button
                        type='button'
                        onClick={toggle}
                        className='flex w-full items-start gap-2 rounded-xl px-1 py-1 text-left hover:bg-muted/60'>
                        <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background'>
                          <AppIcon iconId={group.iconId} size='sm' />
                        </div>
                        <div className='flex flex-1 flex-col'>
                          <div className='flex items-center justify-between gap-1'>
                            <span className='text-sm font-semibold'>{group.label}</span>
                            <div className='flex items-center gap-1'>
                              {group.expiredCount > 0 && (
                                <span className='flex items-center gap-1 rounded-lg border bg-primary-100 px-1.5 py-0.5 text-xs text-amber-700'>
                                  <TriangleAlert className='size-3 text-amber-600' />
                                  Needs attention
                                </span>
                              )}
                              <ChevronUp className='size-4 shrink-0 text-muted-foreground' />
                            </div>
                          </div>
                          <span className='text-xs text-muted-foreground'>
                            {group.rows.length} connections
                          </span>
                        </div>
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
        <CredentialTemplateDialog
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
          // Inline-secret rows seed their masked credentials; name-only rows skip the load.
          connectionId={editInlineSecret ? editRow.id : undefined}
          pending={updateCredential.isPending || saveConnection.isPending}
          submitLabel='Save'
          loadingText='Saving...'
          showName
          initialName={editRow.label ?? editRow.name}
          description={
            editInlineSecret
              ? 'Rename this connection or update its credentials.'
              : 'Rename this connection, or use Reconnect to re-authorize or update its credentials.'
          }
          selectedOptionalScopes={editScopes}
          onOptionalScopesChange={setEditScopes}
          // The post-connect upgrade path (§4.5): tick the extra scope, then Reconnect. The picks
          // ride through as `scope_add`; Save stays a rename, since a granted scope only changes
          // by re-authorizing.
          onReconnect={
            editInlineSecret
              ? undefined
              : () => {
                  const row = editRow
                  const scopeAdd = editScopes
                  setEditRow(null)
                  handleReconnect(row, scopeAdd)
                }
          }
          onSubmit={handleEditSubmit}
        />
      )}

      {/* Connect/reconnect dialogs (variable, secret) owned by the flow. */}
      {flow.Dialogs}
      {/* MCP reconnect: loads the server by slug, then runs the MCP-native connect flow. The
          `attempt` nonce as key forces a fresh mount per Reconnect click. */}
      {reconnectMcp && (
        <McpReconnectController
          key={reconnectMcp.attempt}
          slug={reconnectMcp.slug}
          onConnected={invalidate}
          onClose={() => setReconnectMcp(null)}
        />
      )}
      <ConfirmDialog />
    </div>
  )
}
