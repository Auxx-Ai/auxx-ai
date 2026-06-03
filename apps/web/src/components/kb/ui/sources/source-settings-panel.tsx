// apps/web/src/components/kb/ui/sources/source-settings-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { Cog, ScrollText, X } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { CrawlSectionTree, type SitemapNode } from '../editor/crawl-section-picker'
import { type ScheduleConfig, SyncFrequencyPicker } from '../editor/sync-frequency-picker'
import type { KnowledgeSource, SourceStatus } from './sources-provider'

const PANEL_VALUES = ['general', 'runs'] as const

const STATUS_PILL: Record<SourceStatus, { label: string; className: string }> = {
  live: { label: 'Live', className: 'bg-good-500/15 text-good-600' },
  syncing: { label: 'Syncing', className: 'bg-warning-500/15 text-warning-600' },
  error: { label: 'Error', className: 'bg-destructive/15 text-destructive' },
  paused: { label: 'Paused', className: 'bg-muted text-muted-foreground' },
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
}

/** Read the stored schedule (untyped jsonb) back into the picker's shape. */
function readSchedule(source: KnowledgeSource): ScheduleConfig | null {
  if (source.syncBehavior !== 'scheduled' || !source.scheduleConfig) return null
  return source.scheduleConfig as ScheduleConfig
}

/**
 * Left-panel of the source workspace — a standard header tab strip over the panel:
 * **General** (the wizard questions, editable, styled with the KB editor's `Section`
 * + var-editor rows) and **Runs** (sync history). The right pane shows the article
 * content. Saves through `knowledgeSource.update`.
 */
export function SourceSettingsPanel({ source }: { source: KnowledgeSource }) {
  const [panel, setPanel] = useQueryState(
    'panel',
    parseAsStringLiteral(PANEL_VALUES).withDefault('general')
  )

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <Tabs value={panel} onValueChange={(v) => setPanel(v as (typeof PANEL_VALUES)[number])}>
        <TabsList className='w-full justify-start rounded-b-none border-b bg-primary-150'>
          <TabsTrigger value='general' variant='outline'>
            <Cog />
            General
          </TabsTrigger>
          <TabsTrigger value='runs' variant='outline'>
            <ScrollText />
            Runs
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {panel === 'general' ? <GeneralPanel source={source} /> : <RunsPanel source={source} />}
    </div>
  )
}

/** Editable source settings. */
function GeneralPanel({ source }: { source: KnowledgeSource }) {
  const utils = api.useUtils()
  const isWebsite = source.type === 'website'
  const config = source.config as Record<string, unknown>
  const originalPaths = useMemo(
    () => (Array.isArray(config.selectedPaths) ? (config.selectedPaths as string[]) : []),
    [config.selectedPaths]
  )

  const [name, setName] = useState(source.name)
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(() => readSchedule(source))
  const [url, setUrl] = useState(String(config.url ?? ''))
  const [mainContentOnly, setMainContentOnly] = useState(config.mainContentOnly !== false)
  const [excludeText, setExcludeText] = useState(
    Array.isArray(config.excludeUrls) ? (config.excludeUrls as string[]).join('\n') : ''
  )
  const [selectedPaths, setSelectedPaths] = useState<string[]>(originalPaths)
  // Re-mapped sitemap (null until the user re-maps); its `children` are the
  // selectable sections.
  const [sitemap, setSitemap] = useState<SitemapNode | null>(null)

  const update = api.knowledgeSource.update.useMutation({
    onSuccess: () => {
      void utils.knowledgeSource.getById.invalidate({ id: source.id })
      void utils.knowledgeSource.list.invalidate()
    },
    onError: (e) => toastError({ title: 'Could not save source', description: e.message }),
  })
  const getSitemapTree = api.knowledgeSource.getSitemapTree.useMutation()

  const handleRemap = async () => {
    try {
      const tree = await getSitemapTree.mutateAsync({ url: url.trim() })
      setSitemap(tree as SitemapNode)
    } catch (e) {
      toastError({
        title: "Couldn't map the site",
        description: e instanceof Error ? e.message : 'Unknown error occurred',
      })
    }
  }

  const toggleSection = (path: string, checked: boolean) =>
    setSelectedPaths((prev) =>
      checked ? [...new Set([...prev, path])] : prev.filter((p) => p !== path)
    )

  const excludeUrls = useMemo(
    () =>
      excludeText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [excludeText]
  )

  // Dirty check — keep Save disabled until something actually changed.
  const isDirty = useMemo(() => {
    if (name !== source.name) return true
    if (JSON.stringify(schedule) !== JSON.stringify(readSchedule(source))) return true
    if (isWebsite) {
      if (url !== String(config.url ?? '')) return true
      if (mainContentOnly !== (config.mainContentOnly !== false)) return true
      const original = Array.isArray(config.excludeUrls) ? (config.excludeUrls as string[]) : []
      if (JSON.stringify(excludeUrls) !== JSON.stringify(original)) return true
      if (JSON.stringify([...selectedPaths].sort()) !== JSON.stringify([...originalPaths].sort()))
        return true
    }
    return false
  }, [
    name,
    schedule,
    url,
    mainContentOnly,
    excludeUrls,
    selectedPaths,
    originalPaths,
    source,
    config,
    isWebsite,
  ])

  const handleSave = () => {
    const nextConfig = isWebsite
      ? { ...config, url: url.trim(), mainContentOnly, excludeUrls, selectedPaths }
      : undefined

    update.mutate({
      id: source.id,
      name: name.trim() || source.name,
      ...(nextConfig ? { config: nextConfig } : {}),
      syncBehavior: schedule ? 'scheduled' : 'manual',
      scheduleConfig: schedule,
    })
  }

  return (
    <>
      <ScrollArea className='flex min-h-0 flex-1 flex-col'>
        <div className='pb-20 [&_[data-slot=section]]:pr-5'>
          <Section title='Source' description='What this source ingests and how it’s named.'>
            <VarEditorField orientation='vertical' className='p-0'>
              <VarEditorFieldRow
                title='Name'
                description='Shown in the Sources list.'
                type={BaseType.STRING}
                showIcon
                isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={name}
                  onChange={(v) => setName((v as string) ?? '')}
                  placeholder='Source name'
                  disabled={update.isPending}
                />
              </VarEditorFieldRow>

              {isWebsite && (
                <>
                  <VarEditorFieldRow
                    title='Website URL'
                    description='The site root the crawler maps and re-syncs.'
                    type={BaseType.STRING}
                    showIcon>
                    <FieldInputAdapter
                      fieldType={FieldType.URL}
                      value={url}
                      onChange={(v) => setUrl((v as string) ?? '')}
                      placeholder='https://docs.example.com'
                      disabled={update.isPending}
                    />
                  </VarEditorFieldRow>

                  <VarEditorFieldRow
                    title='Only main content'
                    description='Strip nav, headers, and footers from each page.'
                    type={BaseType.STRING}
                    showIcon>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      value={mainContentOnly}
                      onChange={(v) => setMainContentOnly(Boolean(v))}
                      disabled={update.isPending}
                    />
                  </VarEditorFieldRow>

                  <VarEditorFieldRow
                    title='Exclude URLs'
                    description='One path or URL per line — never ingested.'
                    type={BaseType.STRING}
                    showIcon>
                    <Textarea
                      value={excludeText}
                      onChange={(e) => setExcludeText(e.target.value)}
                      placeholder='/blog&#10;/changelog'
                      rows={2}
                      className='font-mono text-sm'
                      disabled={update.isPending}
                    />
                  </VarEditorFieldRow>
                </>
              )}
            </VarEditorField>
          </Section>

          {isWebsite && (
            <Section
              title='Sections'
              description='The site sections this source crawls. Re-map to change them.'>
              {sitemap ? (
                <div className='flex flex-col gap-2'>
                  <CrawlSectionTree
                    sections={sitemap.children ?? []}
                    selectedPaths={selectedPaths}
                    onToggle={toggleSection}
                  />
                  <p className='text-muted-foreground text-xs'>
                    Toggle sections, then Save changes to apply on the next sync.
                  </p>
                </div>
              ) : (
                <div className='flex flex-col items-start gap-2'>
                  {selectedPaths.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>Whole site.</p>
                  ) : (
                    <div className='flex flex-wrap gap-1.5'>
                      {selectedPaths.map((path) => (
                        <span
                          key={path}
                          className='rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground'>
                          {path}
                        </span>
                      ))}
                    </div>
                  )}
                  <Button
                    variant='outline'
                    size='sm'
                    loading={getSitemapTree.isPending}
                    loadingText='Mapping...'
                    disabled={!url.trim()}
                    onClick={handleRemap}>
                    Re-map site
                  </Button>
                </div>
              )}
            </Section>
          )}

          <Section title='Sync schedule' description='How often this source re-syncs.'>
            <SyncFrequencyPicker value={schedule} onChange={setSchedule} />
          </Section>

          <Section
            title='Linked knowledge bases'
            description='This source is its own knowledge base. Link it into others to surface its content there.'>
            <LinkedKnowledgeBases source={source} />
          </Section>

          <Section title='About' description='Source type and surface.'>
            <div className='flex flex-col gap-2 text-sm'>
              <Row label='Type' value={source.type} />
              <Row label='Surface' value={source.surface === 'ai-only' ? 'AI-only' : 'Articles'} />
            </div>
          </Section>
        </div>
      </ScrollArea>

      <div className='flex justify-end border-t bg-background p-3'>
        <Button
          loading={update.isPending}
          loadingText='Saving...'
          disabled={!isDirty}
          onClick={handleSave}>
          Save changes
        </Button>
      </div>
    </>
  )
}

/** Manage which user-facing KBs this source's content is linked into. */
function LinkedKnowledgeBases({ source }: { source: KnowledgeSource }) {
  const utils = api.useUtils()
  const links = api.knowledgeSource.listLinks.useQuery({ id: source.id })
  const kbList = api.kb.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 })

  const linkedIds = new Set((links.data ?? []).map((l) => l.id))
  const available = (kbList.data ?? []).filter((kb) => !linkedIds.has(kb.id))

  const invalidate = () => {
    void utils.knowledgeSource.listLinks.invalidate({ id: source.id })
  }
  const link = api.knowledgeSource.linkToKnowledgeBases.useMutation({
    onSuccess: invalidate,
    onError: (e) => toastError({ title: 'Could not link', description: e.message }),
  })
  const unlink = api.knowledgeSource.unlinkFromKnowledgeBase.useMutation({
    onSuccess: invalidate,
    onError: (e) => toastError({ title: 'Could not unlink', description: e.message }),
  })
  const busy = link.isPending || unlink.isPending

  return (
    <div className='flex flex-col gap-3'>
      {(links.data ?? []).length > 0 ? (
        <div className='flex flex-wrap gap-1.5'>
          {(links.data ?? []).map((kb) => (
            <Badge key={kb.id} variant='pill' size='sm' className='gap-1'>
              {kb.name}
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground'
                disabled={busy}
                onClick={() => unlink.mutate({ id: source.id, knowledgeBaseId: kb.id })}>
                <X className='size-3' />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>Not linked into any knowledge base yet.</p>
      )}

      {available.length > 0 && (
        <Select
          value=''
          disabled={busy}
          onValueChange={(kbId) => link.mutate({ id: source.id, knowledgeBaseIds: [kbId] })}>
          <SelectTrigger className='w-full'>
            <SelectValue placeholder='Link into a knowledge base…' />
          </SelectTrigger>
          <SelectContent>
            {available.map((kb) => (
              <SelectItem key={kb.id} value={kb.id}>
                {kb.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

/**
 * Sync run history. There's no per-run log table yet, so this shows the last run's
 * status + outcome; a full run log lands once a SourceSyncRun table exists.
 */
function RunsPanel({ source }: { source: KnowledgeSource }) {
  const status = STATUS_PILL[source.status] ?? STATUS_PILL.pending

  return (
    <ScrollArea className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-col gap-2 rounded-xl border p-4 text-sm'>
          <div className='flex items-center justify-between'>
            <span className='font-medium'>Last run</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>
              {status.label}
            </span>
          </div>
          <Row
            label='When'
            value={source.lastSyncedAt ? '' : 'Never synced'}
            valueNode={
              source.lastSyncedAt ? <LastUpdated timestamp={source.lastSyncedAt} prefix='' /> : null
            }
          />
          <Row label='Items' value={String(source.itemCount)} />
          {source.lastJobId && <Row label='Job' value={source.lastJobId} />}
          {source.error && (
            <p className='rounded-md bg-destructive/10 p-2 text-xs text-destructive'>
              {source.error}
            </p>
          )}
        </div>
        <p className='px-1 text-xs text-muted-foreground'>
          Per-run history is coming. For now this shows the most recent sync.
        </p>
      </div>
    </ScrollArea>
  )
}

function Row({
  label,
  value,
  valueNode,
}: {
  label: string
  value: string
  valueNode?: React.ReactNode
}) {
  return (
    <div className='flex items-center justify-between gap-4'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='truncate text-right font-medium capitalize'>{valueNode ?? value}</span>
    </div>
  )
}
