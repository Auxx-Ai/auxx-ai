// apps/build/src/components/apps/publish-app-dialog.tsx

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
import { CheckCircle2, Circle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'
import { isMainAppListingComplete, isOAuthConfigComplete } from '~/lib/publish-checks'
import { api, type RouterOutputs } from '~/trpc/react'

type Deployment = RouterOutputs['versions']['list'][number]

interface PublishAppDialogProps {
  /** App slug to fetch data for */
  appSlug: string
  /** Context mode */
  mode: 'app' | 'version'
  /** Deployment data (only for version mode) */
  deployment?: Deployment
  /** Optional custom trigger element */
  trigger?: React.ReactNode
  /** Optional callback on successful action */
  onSuccess?: () => void
}

/**
 * Dialog for publishing an app to the Auxx.AI AppStore
 * Shows checklist of requirements before publishing
 */
export function PublishAppDialog({
  appSlug,
  mode,
  deployment,
  trigger,
  onSuccess,
}: PublishAppDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Fetch app data when dialog is opened
  const { data: app } = api.apps.get.useQuery({ slug: appSlug }, { enabled: open })

  // Fetch deployments only when dialog is opened
  const { data: deployments } = api.versions.list.useQuery(
    { appId: app?.id || '' },
    { enabled: open && !!app?.id }
  )

  const utils = api.useUtils()

  // App-level publication mutation
  const updateAppStatus = api.apps.updatePublicationStatus.useMutation()

  // Deployment-level status mutation
  const updateDeploymentStatus = api.versions.updateDeploymentStatus.useMutation()

  const handleAction = async () => {
    if (!app) return

    try {
      if (mode === 'app') {
        // Submit app for review
        await updateAppStatus.mutateAsync({ appId: app.id, targetStatus: 'review' })
        router.refresh()
        await utils.versions.list.invalidate({ appId: app.id })
        await utils.apps.get.invalidate({ slug: appSlug })
        onSuccess?.()
        setOpen(false)
      } else if (mode === 'version' && deployment) {
        // Determine action based on deployment status
        const action = getDeploymentAction(deployment)
        if (!action) return

        await updateDeploymentStatus.mutateAsync({ deploymentId: deployment.id, action })
        router.refresh()
        await utils.apps.get.invalidate({ slug: appSlug })
        onSuccess?.()
        setOpen(false)
      }
    } catch (error: any) {
      if (mode === 'app') {
        toastError({ title: 'Failed to submit for review', description: error.message })
      } else {
        toastError({
          title: getActionErrorTitle(deployment),
          description: error.message,
        })
      }
    }
  }

  // Determine which action to take based on deployment status
  const getDeploymentAction = (
    d: Deployment
  ): 'submit-for-review' | 'withdraw' | 'publish' | 'deprecate' | null => {
    switch (d.status) {
      case 'active':
      case 'withdrawn':
      case 'rejected':
        return 'submit-for-review'
      case 'pending-review':
      case 'in-review':
        return 'withdraw'
      case 'approved':
        return 'publish'
      case 'published':
        return 'deprecate'
      default:
        return null
    }
  }

  const getActionErrorTitle = (d?: Deployment) => {
    if (!d) return 'Failed to update deployment'
    const action = getDeploymentAction(d)
    if (action === 'submit-for-review') return 'Failed to submit for review'
    if (action === 'withdraw') return 'Failed to withdraw'
    if (action === 'publish') return 'Failed to publish deployment'
    if (action === 'deprecate') return 'Failed to deprecate deployment'
    return 'Failed to update deployment'
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
  }

  // Compute derived flags
  const hasProdDeployment = deployments?.some((d) => d.deploymentType === 'production') ?? false

  // Compute checklist states
  const isListingComplete = app ? isMainAppListingComplete(app) : false
  const isOAuthComplete = app ? isOAuthConfigComplete(app) : false
  const hasDeploymentOrOAuth = hasProdDeployment || (app?.hasOauth ?? false)

  // Build checklist
  const checklist = [
    {
      id: 'oauth-or-deployment',
      label: 'Enabled OAuth or created a deployment',
      completed: hasDeploymentOrOAuth,
    },
    {
      id: 'app-listing',
      label: 'Completed your app listing',
      completed: isListingComplete,
    },
    // Only show OAuth settings if OAuth is enabled
    ...(app?.hasOauth
      ? [
          {
            id: 'oauth-settings',
            label: 'Configured all OAuth settings for your app',
            completed: isOAuthComplete,
          },
        ]
      : []),
  ]

  // Determine if can publish
  const canPublish =
    app && isListingComplete && (hasProdDeployment || (app.hasOauth && isOAuthComplete))

  // Determine button text
  const getButtonText = () => {
    if (mode === 'app') return 'Submit for Review'
    if (mode === 'version' && deployment) {
      const action = getDeploymentAction(deployment)
      switch (action) {
        case 'submit-for-review':
          return 'Submit for Review'
        case 'withdraw':
          return 'Withdraw from Review'
        case 'publish':
          return 'Publish Deployment'
        case 'deprecate':
          return 'Deprecate Deployment'
        case null:
          return 'Not Available'
        default:
          return 'Submit'
      }
    }
    return 'Submit'
  }

  const isPending = updateAppStatus.isPending || updateDeploymentStatus.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size='sm' variant='outline'>
            Publish App
          </Button>
        )}
      </DialogTrigger>
      <DialogContent position='tc' size='sm'>
        <DialogHeader>
          <DialogTitle>Publish your app</DialogTitle>
          <DialogDescription>
            Submit your app to the Auxx.AI AppStore for review. We will aim to review your
            submission within 48 hours.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <p className='text-sm font-medium text-foreground'>
            Before publishing, please ensure you have:
          </p>
          <div className='space-y-2'>
            {checklist.map((item) => (
              <div key={item.id} className='flex flex-row items-center gap-3'>
                {item.completed ? (
                  <CheckCircle2 className='size-5 text-green-600 shrink-0' />
                ) : (
                  <Circle className='size-5 text-muted-foreground shrink-0' />
                )}
                <span
                  className={`text-sm ${
                    item.completed ? 'text-foreground' : 'text-muted-foreground'
                  }`}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type='button' variant='ghost' size='sm' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handleAction}
            disabled={!canPublish || !deployments}
            loading={isPending}
            loadingText={mode === 'app' ? 'Submitting...' : 'Processing...'}>
            {getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
