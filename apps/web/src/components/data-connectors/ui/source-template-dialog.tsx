// apps/web/src/components/data-connectors/ui/source-template-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { Plug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { type TemplateGalleryCategory, TemplateGalleryDialog } from '~/components/templates/ui'
import { api } from '~/trpc/react'

interface SourceTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A selectable source — the blank REST builtin, a first-party template, an
 * installed app's connector, or a `recommended-app` connector from a published,
 * verified app this org has NOT installed yet (v9). The last one is the only arm
 * that cannot create on click: the app has to exist first.
 */
type SourceItem = {
  id: string
  name: string
  description: string
  categories: string[]
  /** Template/app icon keys are optional at the source (`iconKey?: string`), so both empty forms land here. */
  iconKey: string | null | undefined
} & (
  | { kind: 'builtin'; type: 'generic-rest' }
  | { kind: 'template'; templateId: string; requiresConnection: boolean }
  | { kind: 'app'; type: string; requiresConnection: boolean; appIconId: string }
  | {
      kind: 'recommended-app'
      type: string
      requiresConnection: boolean
      appIconId: string
      appSlug: string
      appTitle: string
      developerTitle: string | null
    }
)

/**
 * Fallback identity when a catalog entry ships no `iconKey`.
 *
 * There is no lucide lookup table here any more. A template's `iconKey` is the SAME
 * polymorphic visual-ref the app branch already renders (`brand:<slug>`, a bare lucide
 * id, `url:`, emoji, …), so both branches go through `AppIcon`. The old hardcoded map
 * knew five lucide names and silently fell back to `Boxes` for everything else — which
 * is why a template could not carry a brand mark at all.
 */
const DEFAULT_SOURCE_ICON = 'boxes'

/** Human labels + sidebar icons for the three catalog buckets. */
const CATEGORY_LABELS: Record<string, string> = {
  custom: 'Custom',
  templates: 'Templates',
  apps: 'Apps',
}
const CATEGORY_ICONS: Record<string, string> = {
  all: 'layout-grid',
  custom: 'globe',
  templates: 'box',
  apps: 'grid',
}
const CATEGORY_ORDER = ['custom', 'templates', 'apps']

/**
 * "Connect a source" picker, built on the shared {@link TemplateGalleryDialog}
 * shell so it matches the other template galleries (category sidebar, search,
 * list↔detail nav). Lists the full catalog from `dataConnector.catalog`: the
 * blank built-in REST connector, first-party templates (pre-filled generic-rest
 * presets), and installed-app connectors. Templates/apps create one-click and
 * route into their detail view; Custom REST drills into a detail page to name the
 * source first. See plans/data-connectors/v6/source-template-dialog-plan.md.
 */
export function SourceTemplateDialog({ open, onOpenChange }: SourceTemplateDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [name, setName] = useState('')
  const [busyItemId, setBusyItemId] = useState<string | null>(null)

  const catalog = api.dataConnector.catalog.useQuery(undefined, { enabled: open })

  const create = api.dataConnector.create.useMutation({
    onSuccess: (connector) => {
      void utils.dataConnector.list.invalidate()
      onOpenChange(false)
      setName('')
      router.push(`/app/connectors/${connector.id}`)
    },
    onError: (e) => {
      setBusyItemId(null)
      toastError({ title: 'Could not create connector', description: e.message })
    },
  })

  const items = useMemo<SourceItem[]>(() => {
    const data = catalog.data
    if (!data) return []
    const builtin = data.builtin[0]
    const builtinItem: SourceItem | null = builtin
      ? {
          id: `builtin:${builtin.type}`,
          name: builtin.label,
          description: builtin.description,
          categories: ['custom'],
          iconKey: builtin.iconKey,
          kind: 'builtin',
          type: builtin.type,
        }
      : null
    const templateItems: SourceItem[] = data.templates.map((t) => ({
      id: `template:${t.id}`,
      name: t.name,
      description: t.description,
      categories: ['templates'],
      iconKey: t.iconKey,
      kind: 'template',
      templateId: t.id,
      requiresConnection: t.requiresConnection,
    }))
    const appItems: SourceItem[] = data.apps.map((a) => ({
      id: `app:${a.connectorId}`,
      name: a.label,
      description: a.description,
      categories: ['apps'],
      iconKey: a.iconKey,
      kind: 'app',
      type: a.type,
      requiresConnection: a.requiresConnection,
      appIconId: a.appIconId,
    }))
    // Appended AFTER the installed connectors so what the org already has always
    // sorts first inside the Apps category.
    const recommendedItems: SourceItem[] = data.recommended.map((r) => ({
      id: `recommended:${r.appSlug}:${r.connectorId}`,
      name: r.label,
      description: r.description,
      categories: ['apps'],
      iconKey: r.iconKey,
      kind: 'recommended-app',
      type: r.type,
      requiresConnection: r.requiresConnection,
      appIconId: r.appIconId,
      appSlug: r.appSlug,
      appTitle: r.appTitle,
      developerTitle: r.developerTitle,
    }))
    return [
      ...(builtinItem ? [builtinItem] : []),
      ...templateItems,
      ...appItems,
      ...recommendedItems,
    ]
  }, [catalog.data])

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

  /**
   * Templates/installed apps create one-click (`'handled'` keeps the shell on the
   * list). Custom REST and recommended (uninstalled) apps fall through so the
   * shell opens their detail page — to name the source, and to install the app.
   */
  function handleSelect(item: SourceItem): 'handled' | undefined {
    if (item.kind === 'builtin') {
      setName(item.name)
      return undefined
    }
    if (item.kind === 'recommended-app') return undefined
    setBusyItemId(item.id)
    if (item.kind === 'template') {
      create.mutate({ name: item.name, type: 'generic-rest', templateId: item.templateId })
    } else {
      create.mutate({ name: item.name, type: item.type })
    }
    return 'handled'
  }

  /**
   * The install landed — turn the recommendation into the source the user came
   * for, then let `create.onSuccess` route to the connector page (where the setup
   * stepper owns the Connect step).
   *
   * The catalog invalidation matters even though we navigate away: if the create
   * fails, the row must come back as an INSTALLED app connector, not as a
   * recommendation to install something already installed.
   *
   * Ordering is safe on the server — `apps.install` emits `app.installed`, which
   * busts the `installedApps` org cache, before it returns. `dataConnector.create`
   * reads that cache to seed the connector's streams from the app's catalog, and
   * a stale read there fails SILENTLY (it falls through to a bare connector with
   * no streams rather than erroring), so the ordering is load-bearing.
   */
  function continueAfterInstall(item: Extract<SourceItem, { kind: 'recommended-app' }>) {
    setBusyItemId(item.id)
    void utils.dataConnector.catalog.invalidate()
    create.mutate({ name: item.name, type: item.type })
  }

  function createBlankRest() {
    create.mutate({ name: name.trim() || 'New REST source', type: 'generic-rest' })
  }

  return (
    <TemplateGalleryDialog<SourceItem>
      open={open}
      onOpenChange={onOpenChange}
      title='Connect a source'
      description='Sync external structured records into your entity system.'
      crumbLabel='Connect a source'
      crumbIcon={<Plug />}
      items={items}
      isLoading={catalog.isLoading}
      categories={categories}
      itemNoun='source'
      renderIcon={(item) => (
        <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background'>
          <AppIcon
            iconId={
              item.kind === 'app' || item.kind === 'recommended-app'
                ? item.appIconId
                : (item.iconKey ?? DEFAULT_SOURCE_ICON)
            }
            size='lg'
          />
        </div>
      )}
      renderBadges={(item) => (
        <>
          {/* "Not installed" and "needs a connection" are independent facts — a
              recommended row states both up front rather than surprising the user
              with the second one after the install. */}
          {item.kind === 'recommended-app' && (
            <span className='rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border'>
              Not installed
            </span>
          )}
          {'requiresConnection' in item && item.requiresConnection && (
            <span className='flex items-center gap-1 text-[11px] text-muted-foreground'>
              <Plug className='size-3' />
              Needs a connection
            </span>
          )}
        </>
      )}
      onSelectItem={handleSelect}
      busyItemId={busyItemId}
      detailSize='lg'
      detailCrumb={(item) => (item.kind === 'builtin' ? 'Custom REST API' : item.name)}
      detailBusy={create.isPending}
      onDetailExit={() => setName('')}
      renderDetail={(item) => {
        if (item.kind === 'builtin') {
          return (
            <ScrollArea className='max-h-[60vh]'>
              <div className='flex flex-col gap-4 p-5'>
                <p className='text-sm text-muted-foreground'>{item.description}</p>
                <div className='flex flex-col gap-1.5'>
                  <span className='text-xs font-medium text-muted-foreground'>Source name</span>
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder='Source name (e.g. Acme CRM)'
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createBlankRest()
                    }}
                  />
                </div>
              </div>
            </ScrollArea>
          )
        }
        if (item.kind === 'recommended-app') {
          return (
            <ScrollArea className='max-h-[60vh]'>
              <div className='flex flex-col gap-4 p-5'>
                <div className='flex items-center gap-3'>
                  <div className='flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background'>
                    <AppIcon iconId={item.appIconId} size='lg' />
                  </div>
                  <div className='min-w-0'>
                    <div className='truncate text-sm font-medium'>{item.appTitle}</div>
                    {item.developerTitle && (
                      <div className='truncate text-xs text-muted-foreground'>
                        by {item.developerTitle}
                      </div>
                    )}
                  </div>
                </div>
                <p className='text-sm text-muted-foreground'>{item.description}</p>
                <p className='text-xs text-muted-foreground'>
                  Installing the {item.appTitle} app adds this source to your workspace.
                  {item.requiresConnection
                    ? ` You'll connect your ${item.appTitle} account on the next screen, before the first sync.`
                    : ''}
                </p>
              </div>
            </ScrollArea>
          )
        }
        return null
      }}
      renderDetailFooter={(item) =>
        item.kind === 'recommended-app' ? (
          // Once the install lands, `InlineAppInstallButton` flips to its
          // "Installed" badge — which would read as *finished* while the source is
          // still being created. Keep a pending CTA in that window instead.
          create.isPending ? (
            <Button size='sm' variant='outline' loading loadingText='Adding source...' disabled>
              Adding source...
            </Button>
          ) : (
            <InlineAppInstallButton
              appSlug={item.appSlug}
              onInstalled={() => continueAfterInstall(item)}
              // `h-7` undoes the component's compact inline sizing, restoring the
              // standard `size='sm'` height the other gallery footers use.
              className='h-7'
              data-dialog-submit>
              Install &amp; add source <KbdSubmit variant='outline' size='sm' />
            </InlineAppInstallButton>
          )
        ) : (
          <Button
            size='sm'
            variant='outline'
            onClick={createBlankRest}
            loading={create.isPending}
            loadingText='Creating...'
            data-dialog-submit>
            Create <KbdSubmit variant='outline' size='sm' />
          </Button>
        )
      }
    />
  )
}
