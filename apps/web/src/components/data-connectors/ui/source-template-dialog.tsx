// apps/web/src/components/data-connectors/ui/source-template-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { Boxes, CreditCard, Database, Github, Globe, Plug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ComponentType, useMemo, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { type TemplateGalleryCategory, TemplateGalleryDialog } from '~/components/templates/ui'
import { api } from '~/trpc/react'

interface SourceTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** A selectable source — the blank REST builtin, a first-party template, or an app connector. */
type SourceItem = {
  id: string
  name: string
  description: string
  categories: string[]
  iconKey: string | null
} & (
  | { kind: 'builtin'; type: 'generic-rest' }
  | { kind: 'template'; templateId: string; requiresConnection: boolean }
  | { kind: 'app'; type: string; requiresConnection: boolean; appIconId: string }
)

/** Map a catalog `iconKey` to a lucide icon (server sends a stable key, not a component). */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  globe: Globe,
  'credit-card': CreditCard,
  github: Github,
  database: Database,
}
function iconFor(key: string | null | undefined): ComponentType<{ className?: string }> {
  return (key && ICONS[key]) || Boxes
}

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
    return [...(builtinItem ? [builtinItem] : []), ...templateItems, ...appItems]
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
   * Templates/apps create one-click (`'handled'` keeps the shell on the list);
   * Custom REST falls through so the shell opens its detail page to name the source.
   */
  function handleSelect(item: SourceItem): 'handled' | undefined {
    if (item.kind === 'builtin') {
      setName(item.name)
      return undefined
    }
    setBusyItemId(item.id)
    if (item.kind === 'template') {
      create.mutate({ name: item.name, type: 'generic-rest', templateId: item.templateId })
    } else {
      create.mutate({ name: item.name, type: item.type })
    }
    return 'handled'
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
      renderIcon={(item) => {
        const Icon = iconFor(item.iconKey)
        return (
          <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background'>
            {item.kind === 'app' ? (
              <AppIcon iconId={item.appIconId} size='lg' />
            ) : (
              <Icon className='size-4' />
            )}
          </div>
        )
      }}
      renderBadges={(item) =>
        'requiresConnection' in item && item.requiresConnection ? (
          <span className='flex items-center gap-1 text-[11px] text-muted-foreground'>
            <Plug className='size-3' />
            Needs a connection
          </span>
        ) : null
      }
      onSelectItem={handleSelect}
      busyItemId={busyItemId}
      detailSize='lg'
      detailCrumb={() => 'Custom REST API'}
      detailBusy={create.isPending}
      onDetailExit={() => setName('')}
      renderDetail={(item) =>
        item.kind === 'builtin' ? (
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
        ) : null
      }
      renderDetailFooter={() => (
        <Button
          size='sm'
          variant='outline'
          onClick={createBlankRest}
          loading={create.isPending}
          loadingText='Creating...'
          data-dialog-submit>
          Create <KbdSubmit variant='outline' size='sm' />
        </Button>
      )}
    />
  )
}
