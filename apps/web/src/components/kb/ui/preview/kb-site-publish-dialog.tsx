// apps/web/src/components/kb/ui/preview/kb-site-publish-dialog.tsx
'use client'

import { draftedSections } from '@auxx/lib/kb/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, Copy, ExternalLink, Globe, Link, Link2Off, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useKbPublicUrl } from '~/components/kb/hooks/use-kb-public-url'
import { api } from '~/trpc/react'

interface KBSitePublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kbId: string
}

/**
 * One user-facing choice over two stored columns.
 *
 * `publishStatus` (is the site live / indexable) and `visibility` (must a
 * reader sign in) are orthogonal in the schema but answer one question, and
 * splitting them across two screens let the copy lie — the old "Public" card
 * claimed "anyone can find and read this" even for an INTERNAL KB.
 *
 * `UNLISTED + INTERNAL` is deliberately unreachable: once sign-in is required,
 * unlisted adds nothing, because a crawler cannot authenticate either way.
 */
type AccessMode = 'public' | 'unlisted' | 'internal'

const MODE_WRITES: Record<
  AccessMode,
  { status: 'PUBLISHED' | 'UNLISTED'; visibility: 'PUBLIC' | 'INTERNAL' }
> = {
  public: { status: 'PUBLISHED', visibility: 'PUBLIC' },
  unlisted: { status: 'UNLISTED', visibility: 'PUBLIC' },
  internal: { status: 'PUBLISHED', visibility: 'INTERNAL' },
}

function modeOf(publishStatus?: string | null, visibility?: string | null): AccessMode {
  // Visibility wins: an INTERNAL KB is internal whatever its publish status.
  if (visibility === 'INTERNAL') return 'internal'
  return publishStatus === 'UNLISTED' ? 'unlisted' : 'public'
}

export function KBSitePublishDialog({ open, onOpenChange, kbId }: KBSitePublishDialogProps) {
  const utils = api.useUtils()
  const { data: kb } = api.kb.byId.useQuery({ id: kbId }, { enabled: open })
  const { data: articles } = api.kb.getArticles.useQuery(
    { knowledgeBaseId: kbId, includeUnpublished: false },
    { enabled: open }
  )

  const [mode, setMode] = useState<AccessMode>('public')
  const { copied: copiedLink, copy: copyLink } = useCopy({
    toastMessage: 'Public URL copied to clipboard',
  })

  useEffect(() => {
    if (open && kb) setMode(modeOf(kb.publishStatus, kb.visibility))
  }, [open, kb])

  const publishMutation = api.kb.publishSite.useMutation()

  const publishedCount = articles?.length ?? 0
  const pendingSections = draftedSections((kb?.draftSettings ?? null) as never)
  const pendingCount = pendingSections.size

  // The draft flush happens server-side only when going live from DRAFT, so the
  // warning below must not promise it on an already-live site.
  const willFlushDraft = kb?.publishStatus === 'DRAFT'

  const MODE_TOAST: Record<AccessMode, string> = {
    public: 'Knowledge base is now public',
    unlisted: 'Knowledge base set to unlisted',
    internal: 'Knowledge base set to internal',
  }

  const handleConfirm = async () => {
    try {
      await publishMutation.mutateAsync({ id: kbId, ...MODE_WRITES[mode] })
      utils.kb.byId.invalidate({ id: kbId })
      utils.kb.list.invalidate()
      toastSuccess({ title: MODE_TOAST[mode] })
      onOpenChange(false)
    } catch (error) {
      toastError({
        title: 'Failed to publish',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const publicUrl = useKbPublicUrl(kb?.slug)

  const handleOpenLink = () => {
    if (publicUrl) window.open(publicUrl, '_blank')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md' position='tc'>
        <DialogHeader>
          <DialogTitle>Publish knowledge base</DialogTitle>
          <DialogDescription>
            {publishedCount === 1 ? '1 article' : `${publishedCount} articles`}{' '}
            {mode === 'internal'
              ? 'will be visible to signed-in members of your organization.'
              : 'will be visible at the public URL.'}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          {publicUrl && (
            <InputGroup>
              <InputGroupAddon align='inline-start'>
                <Link />
              </InputGroupAddon>
              <InputGroupInput
                type='text'
                value={publicUrl}
                readOnly
                className='font-mono text-xs'
                onFocus={(e) => e.target.select()}
              />
              <InputGroupAddon align='inline-end' className='gap-0.5'>
                <Tooltip content='Copy'>
                  <InputGroupButton
                    aria-label='Copy public URL'
                    className='rounded-full'
                    size='icon-xs'
                    onClick={() => copyLink(publicUrl)}>
                    {copiedLink ? <Check /> : <Copy />}
                  </InputGroupButton>
                </Tooltip>
                <Tooltip content='Open'>
                  <InputGroupButton
                    aria-label='Open public URL'
                    className='rounded-full'
                    size='icon-xs'
                    onClick={handleOpenLink}>
                    <ExternalLink />
                  </InputGroupButton>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          )}

          {pendingCount > 0 && willFlushDraft && (
            <p className='text-xs text-amber-700 dark:text-amber-400'>
              Publishing will also apply{' '}
              {pendingCount === 1
                ? '1 pending settings change'
                : `${pendingCount} pending settings changes`}
              .
            </p>
          )}

          <RadioGroup value={mode} onValueChange={(v) => setMode(v as AccessMode)}>
            <RadioGroupItemCard
              value='public'
              id='kb-publish-public'
              icon={<Globe />}
              label='Public'
              description='Anyone can find and read this knowledge base. Search engines may index it.'
            />
            <RadioGroupItemCard
              value='unlisted'
              id='kb-publish-unlisted'
              icon={<Link2Off />}
              label='Unlisted'
              description="Accessible by direct link only. Search engines won't index it."
            />
            <RadioGroupItemCard
              value='internal'
              id='kb-publish-internal'
              icon={<Lock />}
              label='Internal'
              description='Visitors must sign in and be a member of your organization. Never indexed.'
            />
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={publishMutation.isPending}>
            Cancel
          </Button>
          <Button
            type='button'
            variant='info'
            size='sm'
            onClick={handleConfirm}
            loading={publishMutation.isPending}
            loadingText='Publishing...'>
            {kb?.publishStatus === 'DRAFT' ? 'Publish' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
