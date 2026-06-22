// apps/web/src/components/connections/ui/add-connection-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { Cable } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useConnectFlow } from '~/components/apps/hooks/use-connect-flow'
import type { AppInstallation } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { type TemplateGalleryCategory, TemplateGalleryDialog } from '~/components/templates/ui'
import {
  ConnectionDetailPage,
  methodIsBareSecret,
  methodNeedsFields,
} from './connection-detail-page'
import { appTarget, type ProviderRow, platformTarget } from './connection-targets'
import { validateConnectionVariables } from './connection-variable-validation'

export type { ProviderRow }

type Scope = 'user' | 'organization'

/**
 * One selectable connection method. Apps carry these natively (`AppInstallation.methods`);
 * a platform provider is normalized into a single synthetic method so both flow through the
 * same resolve/connect path. `global` decides the connect scope (org-wide vs per-user).
 */
type Method = {
  id: string
  label: string
  description: string | null
  connectionType: string
  global: boolean
  connectionVariables: AppInstallation['methods'][number]['connectionVariables']
  /** OAuth approval gate (§3.1): this connection must bring its own client id/secret. */
  requiresOwnClient?: boolean
  ownClientReason?: 'no-platform-client' | 'pending-approval' | null
}

/** A gallery row — either an installed app or a platform provider — carrying its source. */
type CatalogItem = {
  id: string
  name: string
  description: string
  categories: string[]
} & ({ kind: 'app'; app: AppInstallation } | { kind: 'provider'; provider: ProviderRow })

/** Human labels for provider categories + the synthetic `apps` bucket. */
const CATEGORY_LABELS: Record<string, string> = {
  apps: 'Apps',
  ai: 'AI',
  database: 'Databases',
  data: 'Data',
  email: 'Email',
  auth: 'Authentication',
  social: 'Social',
  ecommerce: 'E-commerce',
  storage: 'Storage',
  other: 'Other',
}

/** ICON_DATA iconIds for the category sidebar (matches the other template galleries). */
const CATEGORY_ICONS: Record<string, string> = {
  all: 'layout-grid',
  apps: 'box',
  ai: 'sparkles',
  database: 'database',
  data: 'table',
  email: 'mail',
  auth: 'key',
  social: 'share-2',
  ecommerce: 'shopping-bag',
  storage: 'folder',
  other: 'more-horizontal',
}

/** Stable sidebar order; only categories with items are shown. */
const CATEGORY_ORDER = [
  'apps',
  'ai',
  'database',
  'data',
  'email',
  'auth',
  'social',
  'ecommerce',
  'storage',
  'other',
]

/**
 * Pin the catalog to a single app or platform provider — used when a caller (e.g. a
 * data connector sourced from an app, or a template that declares its provider) already
 * knows which connection to make. The gallery is skipped and the dialog opens straight
 * on that item's detail (its method picker + fields). Omit for the full catalog.
 */
export type ConnectionRestriction =
  | { kind: 'app'; appSlug: string }
  | { kind: 'provider'; providerKey: string }

interface AddConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Platform built-in providers (Google, Postgres, Stripe, …). */
  providers: ProviderRow[]
  /** Installed apps that expose a connection definition. */
  installedApps: AppInstallation[]
  isLoading?: boolean
  /** Fired after a connection is created (or its OAuth popup completes). */
  onConnected: () => void
  /** Scope the catalog to a single app/provider (skips the gallery). */
  restrictTo?: ConnectionRestriction
  /** Surfaces the new credentialId so a caller can bind it (e.g. to a data connector). */
  onConnectedCredential?: (credentialId: string) => void
}

/**
 * The "+ New connection" catalog, built on the shared {@link TemplateGalleryDialog}
 * shell. OAuth providers/apps without input connect one-click (popup); providers/apps
 * that need an API key or connection variables drill into the gallery's detail page —
 * the same dialog, no stacked modal. Persistence + the OAuth popup are reused from
 * {@link useConnectFlow}. See plans/connections/unify-connection-definition.md §15.
 */
export function AddConnectionDialog({
  open,
  onOpenChange,
  providers,
  installedApps,
  isLoading,
  onConnected,
  restrictTo,
  onConnectedCredential,
}: AddConnectionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [token, setToken] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [connectingId, setConnectingId] = useState<string | null>(null)
  // The method chosen on the detail page when an item exposes >1 (null until picked).
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null)

  const flow = useConnectFlow({
    onConnected: (credId) => {
      onConnected()
      onConnectedCredential?.(credId)
      onOpenChange(false)
    },
  })

  // Clear the gallery row's busy spinner whenever the flow settles (success closes the dialog;
  // a cancelled/failed OAuth popup re-enables the catalog in place). `flow.pending` covers the
  // secret-save, silent-refresh, and OAuth-popup phases.
  useEffect(() => {
    if (!flow.pending) setConnectingId(null)
  }, [flow.pending])

  const items = useMemo<CatalogItem[]>(() => {
    const appItems: CatalogItem[] = installedApps.map((inst) => ({
      id: `app:${inst.installationId}`,
      name: inst.app.title,
      description: inst.app.description ?? 'Connect your account.',
      categories: ['apps'],
      kind: 'app',
      app: inst,
    }))
    const providerItems: CatalogItem[] = providers.map((provider) => ({
      id: `provider:${provider.providerKey}`,
      name: provider.label,
      description: provider.description ?? defaultProviderDescription(provider),
      categories: [provider.category ?? 'other'],
      kind: 'provider',
      provider,
    }))
    return [...appItems, ...providerItems]
  }, [installedApps, providers])

  const categories = useMemo<TemplateGalleryCategory[]>(() => {
    const present = new Set(items.flatMap((i) => i.categories))
    return [
      { value: 'all', label: 'All', icon: CATEGORY_ICONS.all },
      ...CATEGORY_ORDER.filter((c) => present.has(c)).map((c) => ({
        value: c,
        label: CATEGORY_LABELS[c] ?? c,
        icon: CATEGORY_ICONS[c],
      })),
    ]
  }, [items])

  /** Every connect method an item exposes. Apps carry them natively; a provider is one method. */
  function methodsFor(item: CatalogItem): Method[] {
    if (item.kind === 'app') return item.app.methods ?? []
    const p = item.provider
    return [
      {
        id: p.providerKey,
        label: p.label,
        description: p.description ?? null,
        connectionType: p.connectionType,
        global: p.global ?? false,
        // `connectionVariables` are already gated server-side (§3.1): BYO client fields
        // dropped when the platform client is usable, forced required when it must BYO.
        connectionVariables: p.connectionVariables ?? [],
        requiresOwnClient: p.requiresOwnClient,
        ownClientReason: p.ownClientReason,
      },
    ]
  }

  // When pinned to one app/provider, resolve it from the catalog and hide the gallery.
  // An unresolved restriction (app not installed / provider absent) renders the
  // gallery's empty state rather than silently widening to the full catalog.
  const restrictedItem = useMemo<CatalogItem | null>(() => {
    if (!restrictTo) return null
    if (restrictTo.kind === 'app') {
      return items.find((i) => i.kind === 'app' && i.app.app.slug === restrictTo.appSlug) ?? null
    }
    return (
      items.find(
        (i) => i.kind === 'provider' && i.provider.providerKey === restrictTo.providerKey
      ) ?? null
    )
  }, [restrictTo, items])

  const galleryItems = restrictTo ? (restrictedItem ? [restrictedItem] : []) : items

  // Restricted mode opens straight on the item's detail (controlled selection). Preselect
  // its sole method so fields render immediately; >1 method still forces an explicit pick.
  useEffect(() => {
    if (!open || !restrictedItem) return
    // Inlined (not methodsFor) so the effect depends only on restrictedItem's identity.
    const methodIds =
      restrictedItem.kind === 'app'
        ? (restrictedItem.app.methods ?? []).map((m) => m.id)
        : [restrictedItem.provider.providerKey]
    setSelectedMethodId(methodIds.length === 1 ? methodIds[0] : null)
    setValues({})
    setToken('')
    setErrors({})
  }, [open, restrictedItem])

  /** Resolve a row + chosen method to its connect target, scope, and the chosen method. */
  function resolve(item: CatalogItem, methodId: string | null) {
    const target = item.kind === 'app' ? appTarget(item.app) : platformTarget(item.provider)
    const methods = methodsFor(item)
    // Auto-resolve the single method; require an explicit pick when there are several.
    const chosen =
      methods.find((m) => m.id === methodId) ?? (methods.length === 1 ? methods[0] : null)
    const scope: Scope = chosen?.global ? 'organization' : 'user'
    return { target, methods, chosen, scope }
  }

  function resetFields() {
    setValues({})
    setToken('')
    setErrors({})
    setConnectingId(null)
    setSelectedMethodId(null)
  }

  /**
   * Mixed one-click / detail entry (mirrors the MCP template dialog). A single OAuth method
   * with no inputs connects directly and reports `'handled'`; anything that needs a choice
   * (>1 method) or input (API key / variables) falls through so the gallery opens its detail page.
   */
  function handleSelect(item: CatalogItem) {
    const { target, scope, methods } = resolve(item, null)
    const only = methods.length === 1 ? methods[0] : null
    // Multi-method, or a single method that needs fields → drill into the detail page.
    if (!only || methodNeedsFields(only)) {
      resetFields()
      // Preselect the sole method so its fields render immediately; force a pick when there are many.
      setSelectedMethodId(only?.id ?? null)
      return undefined
    }
    setConnectingId(item.id)
    flow.start({ target, scope, definitionId: only.id })
    return 'handled' as const
  }

  function validate(method: Method): boolean {
    const next = validateConnectionVariables({
      variables: method.connectionVariables ?? [],
      values,
      requireToken: methodIsBareSecret(method),
      token,
    })
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleConnect(item: CatalogItem) {
    const { target, scope, chosen } = resolve(item, selectedMethodId)
    if (!chosen) return
    if (methodNeedsFields(chosen) && !validate(chosen)) return
    setConnectingId(item.id)
    flow.connectWith(
      { target, scope, definitionId: chosen.id },
      (chosen.connectionVariables?.length ?? 0) > 0 ? { values } : { secret: token }
    )
  }

  // Dismissing the dialog aborts any in-flight connect — the guaranteed escape when a COOP provider's
  // popup can't be auto-detected as closed (otherwise the gallery would stay disabled until timeout).
  function handleOpenChange(next: boolean) {
    if (!next) {
      flow.cancel()
      setConnectingId(null)
    }
    onOpenChange(next)
  }

  return (
    <TemplateGalleryDialog<CatalogItem>
      open={open}
      onOpenChange={handleOpenChange}
      title='New connection'
      description='Connect an app or a built-in provider'
      crumbLabel='New connection'
      crumbIcon={<Cable />}
      items={galleryItems}
      isLoading={isLoading}
      categories={categories}
      // Pinned to one item → open on its detail; Back from the only item closes.
      selectedId={restrictTo ? (restrictedItem?.id ?? null) : undefined}
      onSelectedIdChange={
        restrictTo
          ? (id) => {
              if (id == null) onOpenChange(false)
            }
          : undefined
      }
      itemNoun='connection'
      renderIcon={(item) => (
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background'>
          <AppIcon
            iconId={
              item.kind === 'app'
                ? (item.app.app.avatarUrl ?? 'package')
                : (item.provider.icon ?? 'key')
            }
            size='sm'
          />
        </div>
      )}
      onSelectItem={handleSelect}
      busyItemId={connectingId}
      detailSize='lg'
      detailCrumb={(item) => `Connect ${item.name}`}
      detailBusy={flow.pending}
      onDetailExit={resetFields}
      renderDetail={(item) => (
        <ConnectionDetailPage
          methods={resolve(item, selectedMethodId).methods}
          selectedMethodId={selectedMethodId}
          onMethodChange={(id) => {
            setSelectedMethodId(id)
            setValues({})
            setToken('')
            setErrors({})
          }}
          values={values}
          onValueChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
          token={token}
          onTokenChange={setToken}
          errors={errors}
          disabled={flow.pending}
        />
      )}
      renderDetailFooter={(item) => {
        const { chosen } = resolve(item, selectedMethodId)
        return (
          <Button
            size='sm'
            variant='outline'
            onClick={() => handleConnect(item)}
            disabled={!chosen}
            loading={flow.pending}
            loadingText='Connecting...'
            data-dialog-submit>
            Connect <KbdSubmit variant='outline' size='sm' />
          </Button>
        )
      }}
    />
  )
}

/** Fallback copy when a provider def carries no description. */
function defaultProviderDescription(provider: ProviderRow): string {
  switch (provider.connectionType) {
    case 'oauth2-code':
      return 'Connect with OAuth.'
    case 'client-credentials':
      return 'Connect with a client ID and secret.'
    case 'secret':
      return 'Connect with an API key or credentials.'
    default:
      return 'Add a connection.'
  }
}
