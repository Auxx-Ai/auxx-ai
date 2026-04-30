// apps/web/src/components/kb/ui/preview/kb-preview-topbar.tsx
'use client'

import { hasUnpublishedSettings as hasUnpublished } from '@auxx/lib/kb/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import {
  ChevronDown,
  ExternalLink,
  Globe,
  Lock,
  Monitor,
  Moon,
  Settings,
  Smartphone,
  Sun,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useKbPublicUrl } from '~/components/kb/hooks/use-kb-public-url'
import { useKnowledgeBaseMutations } from '~/components/kb/hooks/use-knowledge-base-mutations'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { type KnowledgeBase, selectDraftedSections } from '../../store/knowledge-base-store'
import { KBSitePublishDialog } from './kb-site-publish-dialog'
import { type Device, type Theme, usePreview } from './preview-context'

interface KBPreviewTopBarProps {
  kbId: string
  /** Slug path of the article currently being edited; used to deep-link the new tab. */
  activeSlugPath?: string[]
}

const SECTION_LABELS: Record<string, string> = {
  identity: 'Brand',
  logos: 'Logos',
  theme: 'Theme',
  colors: 'Colors',
  modes: 'Modes',
  styling: 'Site styles',
  header: 'Header',
  footer: 'Footer',
}

export function KBPreviewTopBar({ kbId, activeSlugPath }: KBPreviewTopBarProps) {
  const { isDark, isMobile, setTheme, setDevice } = usePreview()
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: kb } = api.kb.byId.useQuery({ id: kbId })
  const publishMutation = api.kb.publishSite.useMutation()
  const unpublishMutation = api.kb.unpublishSite.useMutation()

  const { publishPendingSettings, discardSettingsDraft, isPublishingPending, isDiscarding } =
    useKnowledgeBaseMutations()

  const draftedKb = kb as KnowledgeBase | undefined
  const drafted = selectDraftedSections(draftedKb)
  const pendingCount = drafted.size
  const hasPending = hasUnpublished((draftedKb?.draftSettings as never) ?? null) || pendingCount > 0

  const handleThemeChange = (value?: string) => {
    if (!value) return
    setTheme(value as Theme)
  }

  const handleDeviceChange = (value?: string) => {
    if (!value) return
    setDevice(value as Device)
  }

  const slugSegment =
    activeSlugPath && activeSlugPath.length > 0
      ? `/${activeSlugPath.map(encodeURIComponent).join('/')}`
      : ''
  const previewHref = `/preview/kb/${kbId}${slugSegment}`
  const publicUrl = useKbPublicUrl(kb?.slug)

  const handleSwitchVisibility = async (status: 'PUBLISHED' | 'UNLISTED') => {
    try {
      await publishMutation.mutateAsync({ id: kbId, status })
      utils.kb.byId.invalidate({ id: kbId })
      utils.kb.list.invalidate()
      toastSuccess({
        title: status === 'PUBLISHED' ? 'Knowledge base is public' : 'Knowledge base is unlisted',
      })
    } catch (error) {
      toastError({
        title: 'Failed to update visibility',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const handleUnpublish = async () => {
    const ok = await confirm({
      title: 'Unpublish site?',
      description:
        'The knowledge base will no longer be accessible at its public URL. You can republish at any time.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    try {
      await unpublishMutation.mutateAsync({ id: kbId })
      utils.kb.byId.invalidate({ id: kbId })
      utils.kb.list.invalidate()
      toastSuccess({ title: 'Knowledge base unpublished' })
    } catch (error) {
      toastError({
        title: 'Failed to unpublish',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const handlePublishPending = async () => {
    await publishPendingSettings(kbId)
  }

  const handleDiscardPending = async () => {
    const ok = await confirm({
      title: 'Discard pending changes?',
      description: 'All unpublished settings changes will be lost. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    await discardSettingsDraft(kbId)
  }

  const isPublished = kb?.publishStatus === 'PUBLISHED'
  const isUnlisted = kb?.publishStatus === 'UNLISTED'
  const isLive = isPublished || isUnlisted
  const externalHref = isLive && publicUrl ? `${publicUrl}${slugSegment}` : previewHref
  const externalLabel =
    isLive && publicUrl ? 'Open public site in new tab' : 'Open preview in new tab'

  return (
    <div className='flex items-center border-b bg-background px-3 py-1'>
      <div className='flex flex-1 items-center gap-2'>
        {!isLive ? (
          <Button
            className='rounded-md'
            size='sm'
            variant='info'
            onClick={() => setIsPublishDialogOpen(true)}>
            Publish site
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size='sm' variant='outline' className='gap-2 rounded-md'>
                <span className='inline-block size-2 rounded-full bg-emerald-500' />
                {isUnlisted ? 'Live · Unlisted' : 'Live'}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='w-56'>
              <DropdownMenuItem onClick={() => setIsPublishDialogOpen(true)}>
                <Settings /> Publish settings
              </DropdownMenuItem>
              {isPublished ? (
                <DropdownMenuItem onClick={() => handleSwitchVisibility('UNLISTED')}>
                  <Lock /> Make unlisted
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => handleSwitchVisibility('PUBLISHED')}>
                  <Globe /> Make public
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleUnpublish} variant='destructive'>
                <Trash2 /> Unpublish site
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {hasPending && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-2 rounded-md border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'>
                  <span className='inline-block size-1.5 animate-pulse rounded-full bg-amber-500' />
                  {pendingCount === 1 ? '1 pending change' : `${pendingCount} pending changes`}
                </Button>
              </PopoverTrigger>
              <PopoverContent align='start' className='w-64 p-3 text-sm'>
                <div className='mb-1 font-medium'>Pending sections</div>
                {drafted.size === 0 ? (
                  <p className='text-muted-foreground text-xs'>No drafted fields.</p>
                ) : (
                  <ul className='space-y-0.5 text-muted-foreground'>
                    {Array.from(drafted).map((s) => (
                      <li key={s}>· {SECTION_LABELS[s] ?? s}</li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            {isLive ? (
              <Button
                size='sm'
                variant='info'
                onClick={handlePublishPending}
                loading={isPublishingPending}
                loadingText='Publishing…'>
                Publish changes
              </Button>
            ) : null}
            <Button
              size='sm'
              variant='ghost'
              onClick={handleDiscardPending}
              loading={isDiscarding}
              loadingText='Discarding…'>
              Discard
            </Button>
          </>
        )}
      </div>

      <div className='flex items-center gap-2'>
        <Button size='icon-sm' variant='ghost' asChild>
          <a
            href={externalHref}
            target='_blank'
            rel='noopener'
            aria-label={externalLabel}
            title={externalLabel}>
            <ExternalLink />
          </a>
        </Button>

        <ToggleGroup
          size='sm'
          type='single'
          value={isDark ? 'dark' : 'light'}
          onValueChange={handleThemeChange}
          aria-label='Theme'>
          <ToggleGroupItem value='light' aria-label='Light mode'>
            <Sun />
          </ToggleGroupItem>
          <ToggleGroupItem value='dark' aria-label='Dark mode'>
            <Moon />
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          size='sm'
          type='single'
          value={isMobile ? 'mobile' : 'desktop'}
          onValueChange={handleDeviceChange}
          aria-label='Screen size'>
          <ToggleGroupItem value='desktop' aria-label='Desktop mode'>
            <Monitor />
          </ToggleGroupItem>
          <ToggleGroupItem value='mobile' aria-label='Mobile mode'>
            <Smartphone />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <KBSitePublishDialog
        open={isPublishDialogOpen}
        onOpenChange={setIsPublishDialogOpen}
        kbId={kbId}
      />
      <ConfirmDialog />
    </div>
  )
}
