// apps/web/src/components/kb/ui/editor/crawl-website-wizard.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { Check, Globe } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { CrawlSectionTree, countPages, type SitemapNode } from './crawl-section-picker'
import { type ScheduleConfig, SyncFrequencyPicker } from './sync-frequency-picker'

interface CrawlWebsiteWizardProps {
  /** Optional KB to pre-link the new source into (when opened from a KB editor). */
  knowledgeBaseId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'connect' | 'pages' | 'target' | 'review'

/** Wizard order — drives the header breadcrumb label and Back navigation. */
const STEP_ORDER: Step[] = ['connect', 'pages', 'target', 'review']

const STEP_TITLES: Record<Step, string> = {
  connect: 'Crawl a website',
  pages: 'Pages',
  target: 'Target',
  review: 'Review',
}

/**
 * Website crawler wizard: Connect → Pages → Target → Review. Discovers a sitemap via the
 * crawl provider, lets the user pick top-level sections, then creates a `website`
 * KnowledgeSource (its own hidden KB) and triggers a sync. Crawled pages materialize as
 * Locked managed articles in the source; the Target step optionally links the source into
 * existing knowledge bases.
 */
export function CrawlWebsiteWizard({
  knowledgeBaseId,
  open,
  onOpenChange,
}: CrawlWebsiteWizardProps) {
  const [step, setStep] = useState<Step>('connect')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [tree, setTree] = useState<SitemapNode | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [excludeText, setExcludeText] = useState('')
  const [mainContentOnly, setMainContentOnly] = useState(true)
  const [linkKbIds, setLinkKbIds] = useState<string[]>(knowledgeBaseId ? [knowledgeBaseId] : [])
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null)

  const utils = api.useUtils()
  const knowledgeBases = api.kb.list.useQuery()
  const checkUrl = api.knowledgeSource.checkUrl.useMutation()
  const getSitemapTree = api.knowledgeSource.getSitemapTree.useMutation()
  const createSource = api.knowledgeSource.create.useMutation()
  const syncNow = api.knowledgeSource.syncNow.useMutation()

  const sections = tree?.children ?? []
  const isConnecting = checkUrl.isPending || getSitemapTree.isPending
  const isSubmitting = createSource.isPending || syncNow.isPending

  const selectedPageCount = useMemo(() => {
    if (!tree) return 0
    return sections
      .filter((s) => selectedPaths.includes(s.path))
      .reduce((sum, s) => sum + countPages(s), 0)
  }, [tree, sections, selectedPaths])

  const reset = () => {
    setStep('connect')
    setUrl('')
    setName('')
    setTree(null)
    setSelectedPaths([])
    setExcludeText('')
    setMainContentOnly(true)
    setLinkKbIds(knowledgeBaseId ? [knowledgeBaseId] : [])
    setSchedule(null)
  }

  const toggleLink = (kbId: string) =>
    setLinkKbIds((prev) =>
      prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId]
    )

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleConnect = async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      toastError({ title: 'Enter a URL', description: 'Paste the site you want to crawl.' })
      return
    }
    try {
      const [check, sitemap] = await Promise.all([
        checkUrl.mutateAsync({ url: trimmed }),
        getSitemapTree.mutateAsync({ url: trimmed }),
      ])
      if (!check.accessible) {
        toastError({
          title: 'Site not reachable',
          description: `The crawler couldn't reach this URL (status ${check.statusCode}).`,
        })
        return
      }
      setTree(sitemap as SitemapNode)
      // Default to every top-level section selected.
      setSelectedPaths((sitemap.children ?? []).map((s: SitemapNode) => s.path))
      if (!name.trim()) setName(check.title ?? new URL(trimmed).hostname)
      setStep('pages')
    } catch (error) {
      toastError({
        title: "Couldn't map the site",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const toggleSection = (path: string, checked: boolean) => {
    setSelectedPaths((prev) =>
      checked ? [...new Set([...prev, path])] : prev.filter((p) => p !== path)
    )
  }

  const handleCreate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toastError({ title: 'Name required', description: 'Give the source a name.' })
      return
    }
    const excludeUrls = excludeText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      const source = await createSource.mutateAsync({
        name: trimmedName,
        type: 'website',
        surface: 'publishable',
        config: {
          url: url.trim(),
          selectedPaths,
          excludeUrls: excludeUrls.length > 0 ? excludeUrls : undefined,
          mainContentOnly,
        },
        syncBehavior: schedule ? 'scheduled' : 'manual',
        scheduleConfig: schedule,
        ...(linkKbIds.length > 0 ? { linkKnowledgeBaseIds: linkKbIds } : {}),
      })
      await syncNow.mutateAsync({ id: source.id })
      for (const kbId of linkKbIds) void utils.kb.getArticles.invalidate({ knowledgeBaseId: kbId })
      void utils.knowledgeSource.list.invalidate()
      close(false)
    } catch (error) {
      toastError({
        title: "Couldn't create source",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const linkKbNames = (knowledgeBases.data ?? [])
    .filter((kb) => linkKbIds.includes(kb.id))
    .map((kb) => kb.name)

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(step)
    if (idx > 0) setStep(STEP_ORDER[idx - 1]!)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title='Crawl a website'
            description='Discover a site, pick the sections to ingest, and the crawler files each page as a locked, source-managed article in its own source — optionally linked into your knowledge bases.'
            onBack={step === 'connect' ? undefined : goBack}
            backDisabled={isSubmitting}
            crumbs={[{ label: STEP_TITLES[step], icon: <Globe /> }]}
          />

          {/* Body — width/height springs between steps */}
          <DialogNavPages value={step}>
            <DialogNavPage value='connect' size='sm'>
              <div className='flex flex-col gap-1.5 p-3'>
                <Label htmlFor='crawl-url'>Website URL</Label>
                <Input
                  id='crawl-url'
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder='https://docs.example.com'
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConnect()
                  }}
                />
                <p className='text-muted-foreground text-xs'>
                  We map the site and show its sections — no pages are ingested yet.
                </p>
              </div>
            </DialogNavPage>

            <DialogNavPage value='pages' size='lg'>
              <div className='flex flex-col gap-4 p-3'>
                <div className='flex flex-col gap-1.5'>
                  <div className='flex items-center justify-between'>
                    <Label>Sections to crawl</Label>
                    <span className='text-muted-foreground text-xs'>
                      {selectedPageCount} page{selectedPageCount === 1 ? '' : 's'} selected
                    </span>
                  </div>
                  <CrawlSectionTree
                    sections={sections}
                    selectedPaths={selectedPaths}
                    onToggle={toggleSection}
                  />
                </div>

                <ToggleCard
                  title='Only main page content'
                  description='Strip nav, headers, and footers.'
                  checked={mainContentOnly}
                  onCheckedChange={setMainContentOnly}
                />

                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='exclude'>Exclude URLs (optional)</Label>
                  <Textarea
                    id='exclude'
                    value={excludeText}
                    onChange={(e) => setExcludeText(e.target.value)}
                    placeholder='/blog&#10;/changelog'
                    rows={2}
                    className='font-mono text-sm'
                  />
                  <p className='text-muted-foreground text-xs'>
                    One path or URL per line — these are never ingested.
                  </p>
                </div>
              </div>
            </DialogNavPage>

            <DialogNavPage value='target' size='lg'>
              <div className='flex flex-col gap-4 p-3'>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='source-name'>Source name</Label>
                  <Input
                    id='source-name'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder='e.g. Docs site'
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label>Link into knowledge bases (optional)</Label>
                  <p className='text-muted-foreground text-xs'>
                    The crawl becomes its own source. Pick any knowledge bases to surface it in —
                    you can change this anytime in the source settings.
                  </p>
                  <div className='flex max-h-48 flex-col gap-0.5 overflow-auto rounded-md border p-1'>
                    {(knowledgeBases.data ?? []).length === 0 ? (
                      <p className='px-2 py-1.5 text-muted-foreground text-xs'>
                        No knowledge bases yet.
                      </p>
                    ) : (
                      (knowledgeBases.data ?? []).map((kb) => {
                        const checked = linkKbIds.includes(kb.id)
                        return (
                          <button
                            key={kb.id}
                            type='button'
                            onClick={() => toggleLink(kb.id)}
                            className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                              checked ? 'bg-muted' : ''
                            }`}>
                            <span className='truncate'>{kb.name}</span>
                            {checked && <Check className='size-4 text-info' />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
                <SyncFrequencyPicker value={schedule} onChange={setSchedule} />
                <ToggleCard
                  title='AI-only (catalog)'
                  description='Embed without tree articles — coming in a later phase.'
                  checked={false}
                  onCheckedChange={() => {}}
                  disabled
                  className='border-dashed opacity-70'
                />
              </div>
            </DialogNavPage>

            <DialogNavPage value='review' size='sm'>
              <div className='p-3'>
                <div className='flex flex-col gap-2 rounded-md border p-4 text-sm'>
                  <Row label='URL' value={url.trim()} />
                  <Row label='Name' value={name.trim()} />
                  <Row
                    label='Sections'
                    value={`${selectedPaths.length} selected · ~${selectedPageCount} pages`}
                  />
                  <Row
                    label='Link into'
                    value={
                      linkKbNames.length > 0 ? linkKbNames.join(', ') : 'Not linked (source only)'
                    }
                  />
                  <Row label='Sync' value={describeSchedule(schedule)} />
                  <Row label='Main content only' value={mainContentOnly ? 'Yes' : 'No'} />
                  <p className='text-muted-foreground pt-2 text-xs'>
                    The crawl runs in the background. Pages appear as locked articles once the
                    worker finishes.
                  </p>
                </div>
              </div>
            </DialogNavPage>
          </DialogNavPages>

          {/* Footer */}
          <DialogFooter className='mt-0 border-t p-3'>
            <Button size='sm' variant='ghost' onClick={() => close(false)} disabled={isSubmitting}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {step === 'connect' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleConnect}
                loading={isConnecting}
                loadingText='Mapping...'
                data-dialog-submit>
                Map site <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {step === 'pages' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setStep('target')}
                data-dialog-submit>
                Continue <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {step === 'target' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setStep('review')}
                disabled={!name.trim()}
                data-dialog-submit>
                Continue <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {step === 'review' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleCreate}
                loading={isSubmitting}
                loadingText='Starting crawl...'
                data-dialog-submit>
                Create & crawl <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function describeSchedule(schedule: ScheduleConfig | null): string {
  if (!schedule) return 'Manual only'
  const count = schedule.timeBetweenTriggers[schedule.triggerInterval] ?? 1
  const unit = schedule.triggerInterval.replace(/s$/, '')
  return `Every ${count} ${unit}${count === 1 ? '' : 's'}`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <span className='text-muted-foreground shrink-0'>{label}</span>
      <span className='truncate text-right font-medium'>{value}</span>
    </div>
  )
}
