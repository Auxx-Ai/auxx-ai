// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/versions/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { format } from 'date-fns'
import { Check, Copy, Loader2, PackageOpen } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useConfirm } from '@/hooks/use-confirm'
import { PromoteDialog } from '~/components/apps/promote-dialog'
import { PublishAppDialog } from '~/components/apps/publish-app-dialog'
import { toastError } from '~/components/global/toast'
import { useApp } from '~/components/providers/dehydrated-state-provider'
import { api, type RouterOutputs } from '~/trpc/react'

/**
 * Command to create a new deployment
 */
const CREATE_DEPLOYMENT_COMMAND = 'npx auxx version create'
type Deployment = RouterOutputs['versions']['list'][number]

/**
 * Get badge variant for deployment status
 */
function getStatusVariant(
  status: string
): 'outline' | 'secondary' | 'default' | 'destructive' | 'green' {
  switch (status) {
    case 'active':
      return 'default'
    case 'pending-review':
    case 'in-review':
      return 'secondary'
    case 'approved':
      return 'green'
    case 'published':
      return 'default'
    case 'rejected':
      return 'destructive'
    case 'withdrawn':
    case 'deprecated':
      return 'outline'
    default:
      return 'outline'
  }
}

/**
 * Get developer label for a development deployment
 */
function getDevLabel(deployment: Deployment): string {
  const creator = deployment.createdBy
  const org = deployment.targetOrganization

  let label = 'Dev'
  if (creator?.name) {
    label = `Dev (${creator.name})`
  } else if (creator?.email) {
    label = `Dev (${creator.email})`
  } else if (deployment.createdById) {
    label = `Dev (${deployment.createdById.slice(0, 8)})`
  }

  if (org?.name) {
    label += ` · ${org.name}`
  }

  return label
}

/**
 * Status badge that shows a popover with rejection reason when clicked on rejected deployments
 */
function StatusBadge({ deployment }: { deployment: Deployment }) {
  const label = deployment.status === 'pending-review' ? 'pending review' : deployment.status

  if (deployment.status === 'rejected' && deployment.rejectionReason) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type='button' className='cursor-pointer'>
            <Badge variant={getStatusVariant(deployment.status)}>{label}</Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-80'>
          <div className='space-y-2'>
            <p className='text-sm font-medium'>Rejection reason</p>
            <p className='text-sm text-muted-foreground'>{deployment.rejectionReason}</p>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  return <Badge variant={getStatusVariant(deployment.status)}>{label}</Badge>
}

const COLUMN_COUNT = 4

/**
 * Section header row for the deployment table
 */
function SectionHeaderRow({ title }: { title: string }) {
  return (
    <TableRow className='bg-primary-100 hover:bg-primary-100'>
      <TableCell colSpan={COLUMN_COUNT} className='py-2'>
        <span className='text-sm font-semibold text-muted-foreground'>{title}</span>
      </TableCell>
    </TableRow>
  )
}

/**
 * Empty row for a section with no deployments
 */
function SectionEmptyRow({ message }: { message: string }) {
  return (
    <TableRow className='hover:bg-transparent'>
      <TableCell colSpan={COLUMN_COUNT} className='py-4 text-center text-sm text-muted-foreground'>
        {message}
      </TableCell>
    </TableRow>
  )
}

/**
 * Versions page component
 */
function VersionsPage() {
  // Get app context from URL params
  const params = useParams<{ slug: string; app_slug: string }>()
  const app = useApp(params.slug, params.app_slug)
  const router = useRouter()

  const [confirm, ConfirmDialog] = useConfirm()

  // Fetch all deployments (no deploymentType filter = both types)
  const {
    data: deployments,
    isLoading,
    refetch,
  } = api.versions.list.useQuery({ appId: app?.id || '' }, { enabled: !!app?.id })

  const updateDeploymentStatus = api.versions.updateDeploymentStatus.useMutation({
    onSuccess: () => {
      router.refresh()
      void refetch()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update deployment status', description: error.message })
    },
  })

  const [copied, setCopied] = useState(false)

  // Split deployments into production and developer sections
  const { productionDeployments, developerDeployments } = useMemo(() => {
    if (!deployments) return { productionDeployments: [], developerDeployments: [] }
    return {
      productionDeployments: deployments.filter((d) => d.deploymentType === 'production'),
      developerDeployments: deployments.filter((d) => d.deploymentType === 'development'),
    }
  }, [deployments])

  /**
   * Handle deprecating a deployment
   */
  const handleDeprecate = async (deployment: Deployment) => {
    const confirmed = await confirm({
      title: 'Deprecate deployment?',
      description: 'This deployment will no longer be available for new installations.',
      confirmText: 'Deprecate',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      updateDeploymentStatus.mutate({ deploymentId: deployment.id, action: 'deprecate' })
    }
  }

  /**
   * Handle withdrawing deployment from review
   */
  const handleWithdraw = async (deployment: Deployment) => {
    const confirmed = await confirm({
      title: 'Withdraw from review?',
      description: 'This deployment will return to active status.',
      confirmText: 'Withdraw',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      updateDeploymentStatus.mutate({ deploymentId: deployment.id, action: 'withdraw' })
    }
  }

  /**
   * Handle publishing an approved deployment
   */
  const handlePublish = async (deployment: Deployment) => {
    const confirmed = await confirm({
      title: 'Publish deployment?',
      description:
        'This deployment will be published to the marketplace and available for installation.',
      confirmText: 'Publish',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      updateDeploymentStatus.mutate({ deploymentId: deployment.id, action: 'publish' })
    }
  }

  /**
   * Copy command to clipboard
   */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CREATE_DEPLOYMENT_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center flex-1 overflow-y-auto'>
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Loader2 className='animate-spin' />
            </EmptyMedia>
            <EmptyTitle>Loading deployments...</EmptyTitle>
            <EmptyDescription>Fetching deployment history</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // Full empty state — no deployments of any type
  if (!deployments || deployments.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center flex-1 overflow-y-auto'>
        <Empty className='border-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <PackageOpen />
            </EmptyMedia>
            <EmptyTitle>No deployments yet</EmptyTitle>
            <EmptyDescription>
              Run this command in your project's directory to create a deployment and upload your
              code:
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className='bg-primary-150 px-4 py-4 rounded-2xl relative'>
            <code className='font-mono text-sm flex-1'>{CREATE_DEPLOYMENT_COMMAND}</code>
            <Button
              className='absolute right-3 top-1/2 -translate-y-1/2'
              variant='ghost'
              size='icon-sm'
              onClick={handleCopy}>
              {copied ? <Check /> : <Copy />}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  // Data state - display sectioned table
  return (
    <>
      <ConfirmDialog />
      <div className='flex flex-col flex-1 overflow-y-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Created at</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Production section */}
            <SectionHeaderRow title='Production' />
            {productionDeployments.length === 0 ? (
              <SectionEmptyRow message='No production deployments yet' />
            ) : (
              productionDeployments.map((deployment) => (
                <TableRow key={deployment.id}>
                  <TableCell className='font-mono'>
                    <div className='truncate'>{deployment.version || '—'}</div>
                  </TableCell>
                  <TableCell>
                    <div className='truncate'>
                      {format(new Date(deployment.createdAt), 'MMM dd, yyyy')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge deployment={deployment} />
                  </TableCell>
                  <TableCell className='text-right'>
                    {deployment.status === 'published' ? (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => handleDeprecate(deployment)}
                        loading={updateDeploymentStatus.isPending}>
                        Deprecate
                      </Button>
                    ) : deployment.status === 'pending-review' ||
                      deployment.status === 'in-review' ? (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => handleWithdraw(deployment)}
                        loading={updateDeploymentStatus.isPending}>
                        Withdraw
                      </Button>
                    ) : deployment.status === 'approved' ? (
                      <Button
                        variant='default'
                        size='sm'
                        onClick={() => handlePublish(deployment)}
                        loading={updateDeploymentStatus.isPending}>
                        Publish
                      </Button>
                    ) : deployment.status === 'active' ||
                      deployment.status === 'withdrawn' ||
                      deployment.status === 'rejected' ? (
                      <PublishAppDialog
                        mode='version'
                        appSlug={params.app_slug}
                        deployment={deployment}
                        trigger={
                          <Button variant='outline' size='sm'>
                            {deployment.status === 'active' ? 'Submit for Review' : 'Resubmit'}
                          </Button>
                        }
                        onSuccess={() => void refetch()}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}

            {/* Developer section */}
            <SectionHeaderRow title='Developer' />
            {developerDeployments.length === 0 ? (
              <SectionEmptyRow message='No developer deployments yet' />
            ) : (
              developerDeployments.map((deployment) => (
                <TableRow key={deployment.id}>
                  <TableCell>
                    <div className='truncate text-sm'>{getDevLabel(deployment)}</div>
                  </TableCell>
                  <TableCell>
                    <div className='truncate'>
                      {format(new Date(deployment.createdAt), 'MMM dd, yyyy')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge deployment={deployment} />
                  </TableCell>
                  <TableCell className='text-right'>
                    <PromoteDialog
                      deployment={deployment}
                      trigger={
                        <Button variant='outline' size='sm'>
                          Make Production
                        </Button>
                      }
                      onSuccess={() => void refetch()}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

export default VersionsPage
