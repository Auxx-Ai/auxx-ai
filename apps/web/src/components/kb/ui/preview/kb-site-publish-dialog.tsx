// apps/web/src/components/kb/ui/preview/kb-site-publish-dialog.tsx
'use client'

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
import { Check, Copy, ExternalLink, Globe, Link, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useKbPublicUrl } from '~/components/kb/hooks/use-kb-public-url'
import { api } from '~/trpc/react'

interface KBSitePublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kbId: string
}

type PublishMode = 'PUBLISHED' | 'UNLISTED'

export function KBSitePublishDialog({ open, onOpenChange, kbId }: KBSitePublishDialogProps) {
  const utils = api.useUtils()
  const { data: kb } = api.kb.byId.useQuery({ id: kbId }, { enabled: open })
  const { data: articles } = api.kb.getArticles.useQuery(
    { knowledgeBaseId: kbId, includeUnpublished: false },
    { enabled: open }
  )

  const [mode, setMode] = useState<PublishMode>('PUBLISHED')
  const { copied: copiedLink, copy: copyLink } = useCopy({
    toastMessage: 'Public URL copied to clipboard',
  })

  useEffect(() => {
    if (open && kb) {
      setMode(kb.publishStatus === 'UNLISTED' ? 'UNLISTED' : 'PUBLISHED')
    }
  }, [open, kb])

  const publishMutation = api.kb.publishSite.useMutation()

  const publishedCount = articles?.length ?? 0

  const handleConfirm = async () => {
    try {
      await publishMutation.mutateAsync({ id: kbId, status: mode })
      utils.kb.byId.invalidate({ id: kbId })
      utils.kb.list.invalidate()
      toastSuccess({
        title:
          mode === 'PUBLISHED' ? 'Knowledge base is now public' : 'Knowledge base set to unlisted',
      })
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
            {publishedCount === 1
              ? '1 article will be visible at the public URL.'
              : `${publishedCount} articles will be visible at the public URL.`}
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

          <RadioGroup value={mode} onValueChange={(v) => setMode(v as PublishMode)}>
            <RadioGroupItemCard
              value='PUBLISHED'
              id='kb-publish-public'
              icon={<Globe />}
              label='Public'
              description='Anyone can find and read this knowledge base. Search engines may index it.'
            />
            <RadioGroupItemCard
              value='UNLISTED'
              id='kb-publish-unlisted'
              icon={<Lock />}
              label='Unlisted'
              description="Accessible by direct link only. Search engines won't index it."
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
