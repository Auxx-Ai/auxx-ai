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
import { CheckCircle2, Circle, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'
import {
  type AppForPublishCheck,
  type ConnectionForPublishCheck,
  isConnectionsConfigComplete,
  isMainAppListingComplete,
  isOAuthConfigComplete,
} from '~/lib/publish-checks'
import { api, type RouterOutputs } from '~/trpc/react'

type Deployment = RouterOutputs['versions']['list'][number]
type DeploymentAction = 'submit-for-review' | 'withdraw' | 'publish' | 'deprecate'

/**
 * Dialog action selected after looking at the current app and deployment state.
 */
type PublishDialogAction =
  | { type: 'app-review' }
  | { type: 'manage-versions' }
  | { type: 'deployment'; deployment: Deployment; action: DeploymentAction }
  | { type: 'none' }

/**
 * Resolve the dialog action for version mode.
 */
function getVersionDialogAction(deployment?: Deployment): PublishDialogAction {
  if (!deployment) return { type: 'none' }

  switch (deployment.status) {
    case 'active':
    case 'withdrawn':
    case 'rejected':
      return { type: 'deployment', deployment, action: 'submit-for-review' }
    case 'pending-review':
    case 'in-review':
      return { type: 'deployment', deployment, action: 'withdraw' }
    case 'approved':
      return { type: 'deployment', deployment, action: 'publish' }
    case 'published':
      return { type: 'deployment', deployment, action: 'deprecate' }
    default:
      return { type: 'none' }
  }
}

/**
 * Normalize nullable app fields from the API into the publish-check shape used by the UI.
 */
function toPublishCheckApp(app: {
  description: string | null
  category: string | null
  avatarUrl: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  termsOfServiceUrl: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null
  hasOauth: boolean | null
  oauthExternalEntrypointUrl: string | null
  scopes: string[] | null
}): AppForPublishCheck {
  return {
    description: app.description,
    category: app.category,
    avatarUrl: app.avatarUrl,
    websiteUrl: app.websiteUrl,
    documentationUrl: app.documentationUrl,
    contactUrl: app.contactUrl,
    termsOfServiceUrl: app.termsOfServiceUrl,
    contentOverview: app.contentOverview,
    contentHowItWorks: app.contentHowItWorks,
    contentConfigure: app.contentConfigure,
    hasOauth: Boolean(app.hasOauth),
    oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
    scopes: app.scopes ?? [],
  }
}

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
  const [autoApproved, setAutoApproved] = useState(false)
  const router = useRouter()

  // Fetch app data when dialog is opened
  const { data: app } = api.apps.get.useQuery({ slug: appSlug }, { enabled: open })

  // Fetch deployments only when dialog is opened
  const { data: deployments } = api.versions.list.useQuery(
    { appId: app?.id || '' },
    { enabled: open && !!app?.id }
  )

  // Fetch connection definitions when dialog is opened
  const { data: connections } = api.connections.list.useQuery(
    { appId: app?.id || '' },
    { enabled: open && !!app?.id }
  )

  const utils = api.useUtils()

  // App-level publication mutation
  const updateAppStatus = api.apps.updatePublicationStatus.useMutation()

  // Deployment-level status mutation
  const updateDeploymentStatus = api.versions.updateDeploymentStatus.useMutation()

  /**
   * Resolve the app-level action using the current deployment list.
   * If multiple deployments are eligible, route the user to Versions instead of guessing.
   */
  const getAppAction = (): PublishDialogAction => {
    if (!app || !deployments) return { type: 'none' }

    const productionDeployments = deployments
      .filter((item) => item.deploymentType === 'production')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const activeDeployments = productionDeployments.filter((item) => item.status === 'active')
    const resubmittableDeployments = productionDeployments.filter(
      (item) => item.status === 'rejected' || item.status === 'withdrawn'
    )
    const approvedDeployments = productionDeployments.filter((item) => item.status === 'approved')

    if (app.reviewStatus === 'approved' && app.publicationStatus === 'unpublished') {
      if (approvedDeployments.length === 1) {
        return {
          type: 'deployment',
          deployment: approvedDeployments[0],
          action: 'publish',
        }
      }

      return approvedDeployments.length > 1 ? { type: 'manage-versions' } : { type: 'none' }
    }

    if (app.reviewStatus === 'rejected' || app.reviewStatus === 'withdrawn') {
      if (resubmittableDeployments.length === 1) {
        return {
          type: 'deployment',
          deployment: resubmittableDeployments[0],
          action: 'submit-for-review',
        }
      }

      return resubmittableDeployments.length > 1 ? { type: 'manage-versions' } : { type: 'none' }
    }

    if (activeDeployments.length > 1) {
      return { type: 'manage-versions' }
    }

    return { type: 'app-review' }
  }

  const dialogAction = mode === 'version' ? getVersionDialogAction(deployment) : getAppAction()

  const handleAction = async () => {
    if (!app) return

    try {
      if (dialogAction.type === 'app-review') {
        const result = await updateAppStatus.mutateAsync({
          appId: app.id,
          targetStatus: 'review',
        })
        router.refresh()
        await utils.versions.list.invalidate({ appId: app.id })
        await utils.apps.get.invalidate({ slug: appSlug })

        if (result.autoApproved) {
          setAutoApproved(true)
          return
        }

        onSuccess?.()
        setOpen(false)
      } else if (dialogAction.type === 'deployment') {
        const result = await updateDeploymentStatus.mutateAsync({
          deploymentId: dialogAction.deployment.id,
          action: dialogAction.action,
        })

        router.refresh()
        await utils.versions.list.invalidate({ appId: app.id })
        await utils.apps.get.invalidate({ slug: appSlug })

        if (result.autoApproved) {
          setAutoApproved(true)
          return
        }

        onSuccess?.()
        setOpen(false)
      } else if (dialogAction.type === 'manage-versions') {
        router.push(`/${app.developerAccount.slug}/apps/${app.slug}/versions`)
        setOpen(false)
      }
    } catch (error: any) {
      if (dialogAction.type === 'app-review') {
        toastError({ title: 'Failed to submit for review', description: error.message })
      } else {
        toastError({
          title: getActionErrorTitle(dialogAction),
          description: error.message,
        })
      }
    }
  }

  /**
   * Resolve the dialog error title from the selected action.
   */
  const getActionErrorTitle = (action: PublishDialogAction) => {
    if (action.type !== 'deployment') return 'Failed to update deployment'
    if (action.action === 'submit-for-review') return 'Failed to submit for review'
    if (action.action === 'withdraw') return 'Failed to withdraw'
    if (action.action === 'publish') return 'Failed to publish deployment'
    if (action.action === 'deprecate') return 'Failed to deprecate deployment'
    return 'Failed to update deployment'
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      if (autoApproved) {
        onSuccess?.()
      }
      setAutoApproved(false)
    }
  }

  // Compute derived flags
  const hasProdDeployment = deployments?.some((d) => d.deploymentType === 'production') ?? false
  const publishCheckApp = app ? toPublishCheckApp(app) : null
  const connectionCheckData: ConnectionForPublishCheck[] = (connections ?? []).map((c) => ({
    connectionType: c.connectionType,
    label: c.label,
    oauth2AuthorizeUrl: c.oauth2AuthorizeUrl,
    oauth2AccessTokenUrl: c.oauth2AccessTokenUrl,
    oauth2ClientId: c.oauth2ClientId,
    oauth2ClientSecret: c.oauth2ClientSecret,
    oauth2Scopes: c.oauth2Scopes,
  }))

  // Compute checklist states
  const isListingComplete = publishCheckApp ? isMainAppListingComplete(publishCheckApp) : false
  const isOAuthComplete = publishCheckApp ? isOAuthConfigComplete(publishCheckApp) : false
  const hasOAuthConnections = connectionCheckData.some((c) => c.connectionType === 'oauth2-code')
  const isConnectionsComplete = isConnectionsConfigComplete(connectionCheckData)
  const hasDeploymentOrOAuth = hasProdDeployment || Boolean(app?.hasOauth)

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
    // Only show connection OAuth check if at least one oauth2-code connection exists
    ...(hasOAuthConnections
      ? [
          {
            id: 'connection-oauth',
            label: 'Configured OAuth settings for all connections',
            completed: isConnectionsComplete,
          },
        ]
      : []),
  ]

  // Determine if submission requirements are complete
  const canSubmitForReview = Boolean(
    app &&
      isListingComplete &&
      isConnectionsComplete &&
      (hasProdDeployment || (Boolean(app.hasOauth) && isOAuthComplete))
  )

  /**
   * Determine button text for the selected action.
   */
  const getButtonText = () => {
    if (dialogAction.type === 'app-review') return 'Submit for Review'
    if (dialogAction.type === 'manage-versions') return 'Manage Versions'
    if (dialogAction.type === 'deployment') {
      switch (dialogAction.action) {
        case 'submit-for-review':
          return mode === 'app' ? 'Resubmit for Review' : 'Submit for Review'
        case 'withdraw':
          return 'Withdraw from Review'
        case 'publish':
          return 'Publish Deployment'
        case 'deprecate':
          return 'Deprecate Deployment'
      }
    }
    return 'Not Available'
  }

  const isPending = updateAppStatus.isPending || updateDeploymentStatus.isPending
  const requiresSubmissionChecklist =
    dialogAction.type === 'app-review' ||
    (dialogAction.type === 'deployment' && dialogAction.action === 'submit-for-review')
  const isActionDisabled =
    !deployments ||
    dialogAction.type === 'none' ||
    (requiresSubmissionChecklist && !canSubmitForReview)

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
        {autoApproved ? (
          <>
            <DialogHeader>
              <DialogTitle>App approved</DialogTitle>
              <DialogDescription>
                Your app has been automatically approved and is ready to publish.
              </DialogDescription>
            </DialogHeader>

            <div className='flex items-center gap-3 rounded-md border border-green-500/20 bg-green-500/10 p-3'>
              <Zap className='size-5 text-green-500 shrink-0' />
              <p className='text-sm text-green-700 dark:text-green-400'>
                Auto-approve is enabled for this app. You can now publish it to the marketplace.
              </p>
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' size='sm' onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Publish your app</DialogTitle>
              <DialogDescription>
                Submit your app to the Auxx.AI AppStore for review. We will aim to review your
                submission within 48 hours.
              </DialogDescription>
            </DialogHeader>

            {dialogAction.type === 'manage-versions' && (
              <p className='text-sm text-muted-foreground'>
                Multiple production versions match this action. Choose the exact version from the
                Versions page.
              </p>
            )}

            {dialogAction.type === 'none' && (
              <p className='text-sm text-muted-foreground'>
                No eligible production deployment is available for this action.
              </p>
            )}

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
                disabled={isActionDisabled}
                loading={isPending}
                loadingText={requiresSubmissionChecklist ? 'Submitting...' : 'Processing...'}>
                {getButtonText()}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
