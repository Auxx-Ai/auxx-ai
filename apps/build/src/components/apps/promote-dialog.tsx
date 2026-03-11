// apps/build/src/components/apps/promote-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toastError } from '~/components/global/toast'
import { api, type RouterOutputs } from '~/trpc/react'

type Deployment = RouterOutputs['versions']['list'][number]

interface PromoteDialogProps {
  deployment: Deployment
  trigger: React.ReactNode
  onSuccess?: () => void
}

/**
 * Dialog to promote a development deployment to production.
 * Creates a new production deployment referencing the same bundles.
 */
export function PromoteDialog({ deployment, trigger, onSuccess }: PromoteDialogProps) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const router = useRouter()
  const utils = api.useUtils()

  // Fetch next version when dialog opens
  const { data: nextVersion } = api.versions.nextVersion.useQuery(
    { appId: deployment.appId },
    { enabled: open }
  )

  // Pre-fill version when data loads
  useEffect(() => {
    if (nextVersion && !version) {
      setVersion(nextVersion)
    }
  }, [nextVersion, version])

  const promote = api.versions.promoteToProduction.useMutation({
    onSuccess: async () => {
      router.refresh()
      await utils.versions.list.invalidate({ appId: deployment.appId })
      onSuccess?.()
      setOpen(false)
      setVersion('')
      setReleaseNotes('')
    },
    onError: (error) => {
      toastError({ title: 'Failed to promote deployment', description: error.message })
    },
  })

  const handlePromote = () => {
    promote.mutate({
      deploymentId: deployment.id,
      version: version || undefined,
      releaseNotes: releaseNotes || undefined,
    })
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      setVersion('')
      setReleaseNotes('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent position='tc' size='sm'>
        <DialogHeader>
          <DialogTitle>Make Production</DialogTitle>
          <DialogDescription>
            Create a production deployment from this development build. The original development
            deployment will remain unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='promote-version'>Version</Label>
            <Input
              id='promote-version'
              placeholder='0.1.0'
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              Auto-calculated from the latest production version. You can override this.
            </p>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='promote-release-notes'>Release notes (optional)</Label>
            <Textarea
              id='promote-release-notes'
              placeholder='Describe what changed in this version...'
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type='button' variant='ghost' size='sm' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handlePromote}
            disabled={!version}
            loading={promote.isPending}
            loadingText='Promoting...'>
            Make Production
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
