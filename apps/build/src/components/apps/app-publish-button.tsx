// apps/build/src/components/apps/app-publish-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ChevronDown, Unplug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/hooks/use-confirm'
import { toastError } from '~/components/global/toast'
import type { AppForPublishCheck } from '~/lib/publish-checks'
import { api } from '~/trpc/react'
import { PublishAppDialog } from './publish-app-dialog'

interface AppPublishButtonProps {
  app: AppForPublishCheck & {
    id: string
    title: string
    publicationStatus: 'unpublished' | 'published'
    reviewStatus: string | null
  }
  size?: 'sm' | 'default'
  onSuccess?: () => void
}

/**
 * Smart button that handles app-level publishing states
 * Shows different UI based on publication status and review status
 */
export function AppPublishButton({ app, size = 'default', onSuccess }: AppPublishButtonProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const router = useRouter()
  const utils = api.useUtils()

  const updateAppStatus = api.apps.updatePublicationStatus.useMutation()

  const handleWithdraw = async () => {
    const confirmed = await confirm({
      title: 'Withdraw from review?',
      description: 'Your app will be withdrawn from review and you can resubmit later.',
      confirmText: 'Withdraw',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await updateAppStatus.mutateAsync({ appId: app.id, targetStatus: 'withdraw' })
        router.refresh()
        await utils.versions.list.invalidate({ appId: app.id })
        onSuccess?.()
      } catch (error: any) {
        toastError({ title: 'Failed to withdraw app', description: error.message })
      }
    }
  }

  const handleUnpublish = async () => {
    const confirmed = await confirm({
      title: 'Unpublish app?',
      description:
        'Your app will be removed from the marketplace. Existing installations will continue to work.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await updateAppStatus.mutateAsync({ appId: app.id, targetStatus: 'unpublish' })
        router.refresh()
        await utils.versions.list.invalidate({ appId: app.id })
        onSuccess?.()
      } catch (error: any) {
        toastError({ title: 'Failed to unpublish app', description: error.message })
      }
    }
  }

  // If app is published
  if (app.publicationStatus === 'published') {
    return (
      <>
        <ConfirmDialog />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='default' size={size} disabled={updateAppStatus.isPending}>
              Published
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={handleUnpublish} variant='destructive'>
              <Unplug />
              Unpublish
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  // If app is in review (pending-review or in-review)
  if (app.reviewStatus === 'pending-review' || app.reviewStatus === 'in-review') {
    return (
      <>
        <ConfirmDialog />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' size={size} disabled={updateAppStatus.isPending}>
              In Review
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={handleWithdraw}>Withdraw from Review</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  // If app was rejected - allow resubmission
  if (app.reviewStatus === 'rejected') {
    return (
      <PublishAppDialog
        mode='app'
        appSlug={app.slug}
        onSuccess={onSuccess}
        trigger={
          <Button size={size} variant='outline'>
            Resubmit for Review
          </Button>
        }
      />
    )
  }

  // If app was withdrawn - allow resubmission
  if (app.reviewStatus === 'withdrawn') {
    return (
      <PublishAppDialog
        mode='app'
        appSlug={app.slug}
        onSuccess={onSuccess}
        trigger={
          <Button size={size} variant='outline'>
            Resubmit for Review
          </Button>
        }
      />
    )
  }

  // If app is approved but not published (awaiting admin publish)
  if (app.reviewStatus === 'approved' && app.publicationStatus === 'unpublished') {
    return (
      <Button size={size} variant='outline' disabled>
        Approved (Awaiting Admin)
      </Button>
    )
  }

  // Default: no review status, allow submission
  return (
    <PublishAppDialog
      mode='app'
      appSlug={app.slug}
      onSuccess={onSuccess}
      trigger={<Button size={size}>Submit for Review</Button>}
    />
  )
}
