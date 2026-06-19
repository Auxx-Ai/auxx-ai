// apps/web/src/components/connections/ui/add-connection-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { Cable } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useConnectFlow } from '~/components/apps/hooks/use-connect-flow'
import type { AppInstallation } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { type TemplateGalleryCategory, TemplateGalleryDialog } from '~/components/templates/ui'
import { ConnectionDetailPage } from './connection-detail-page'
import { ConnectionMethodPicker } from './connection-method-picker'
import { appTarget, type ProviderRow, platformTarget } from './connection-targets'

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
}: AddConnectionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [token, setToken] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [connectingId, setConnectingId] = useState<string | null>(null)
  // The method chosen on the detail page when an item exposes >1 (null until picked).
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null)

  const flow = useConnectFlow({
    onConnected: () => {
      onConnected()
      onOpenChange(false)
    },
  })

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
        connectionVariables: p.connectionVariables ?? [],
      },
    ]
  }

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
    const next: Record<string, string> = {}
    for (const v of method.connectionVariables ?? []) {
      if (v.required !== false && !values[v.key]?.trim()) next[v.key] = `${v.label} is required`
    }
    if (methodIsBareSecret(method) && !token.trim()) next.__token = 'A value is required'
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

  return (
    <TemplateGalleryDialog<CatalogItem>
      open={open}
      onOpenChange={onOpenChange}
      title='New connection'
      description='Connect an app or a built-in provider'
      crumbLabel='New connection'
      crumbIcon={<Cable />}
      items={items}
      isLoading={isLoading}
      categories={categories}
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
      renderDetail={(item) => {
        const { methods, chosen } = resolve(item, selectedMethodId)
        return (
          <div className='flex flex-col gap-3 p-3'>
            {methods.length > 1 && (
              <ConnectionMethodPicker
                methods={methods}
                value={selectedMethodId}
                onChange={(id) => {
                  setSelectedMethodId(id)
                  setValues({})
                  setToken('')
                  setErrors({})
                }}
                disabled={flow.pending}
              />
            )}
            {chosen && methodNeedsFields(chosen) && (
              <ConnectionDetailPage
                variables={chosen.connectionVariables ?? []}
                values={values}
                onValueChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
                showToken={methodIsBareSecret(chosen)}
                token={token}
                onTokenChange={setToken}
                errors={errors}
                disabled={flow.pending}
              />
            )}
          </div>
        )
      }}
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

/** A secret/variable method needs the detail step; bare OAuth connects one-click. */
function methodNeedsFields(method: Method): boolean {
  return method.connectionType === 'secret' || (method.connectionVariables?.length ?? 0) > 0
}

/** A single-secret method (API key) with no structured variables. */
function methodIsBareSecret(method: Method): boolean {
  return method.connectionType === 'secret' && (method.connectionVariables?.length ?? 0) === 0
}

/** Fallback copy when a provider def carries no description. */
function defaultProviderDescription(provider: ProviderRow): string {
  switch (provider.connectionType) {
    case 'oauth2-code':
      return 'Connect with OAuth.'
    case 'secret':
      return 'Connect with an API key or credentials.'
    default:
      return 'Add a connection.'
  }
}
