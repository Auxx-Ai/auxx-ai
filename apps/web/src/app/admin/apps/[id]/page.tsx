// apps/web/src/app/admin/apps/[id]/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Label } from '@auxx/ui/components/label'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Ban, CheckCircle, ExternalLink, Trash2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/**
 * Get badge variant for publication status
 */
function getPublicationStatusVariant(status: string): 'outline' | 'default' {
  switch (status) {
    case 'published':
      return 'default'
    case 'unpublished':
    default:
      return 'outline'
  }
}

/**
 * Get badge variant for deployment status (unified state machine)
 */
function getDeploymentStatusVariant(
  status: string
): 'outline' | 'secondary' | 'default' | 'destructive' {
  switch (status) {
    case 'active':
      return 'default'
    case 'pending-review':
    case 'in-review':
      return 'secondary'
    case 'approved':
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
 * App detail page for admin
 */
export default function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: app, isLoading } = api.admin.apps.getApp.useQuery({ id })
  const [confirm, ConfirmDialog] = useConfirm()
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectDeploymentId, setRejectDeploymentId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const utils = api.useUtils()

  const deleteApp = api.admin.apps.deleteApp.useMutation()
  const approveDeployment = api.admin.apps.approveDeployment.useMutation()
  const rejectDeployment = api.admin.apps.rejectDeployment.useMutation()
  const deprecateDeployment = api.admin.apps.deprecateDeployment.useMutation()
  const deleteDeployment = api.admin.apps.deleteDeployment.useMutation()
  const toggleAutoApprove = api.admin.apps.toggleAutoApprove.useMutation()

  /**
   * Handle delete app
   */
  const handleDeleteApp = async () => {
    const confirmed = await confirm({
      title: 'Delete this app?',
      description:
        'This will permanently delete the app and all its deployments. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deleteApp.mutateAsync({ id })
      router.push('/admin/apps')
      await utils.admin.apps.getApps.invalidate()
    } catch (error: any) {
      toastError({ title: 'Failed to delete app', description: error.message })
    }
  }

  /**
   * Handle approve deployment
   */
  const handleApproveDeployment = async (deploymentId: string) => {
    const confirmed = await confirm({
      title: 'Approve this deployment?',
      description: 'This will make the deployment available for publishing.',
      confirmText: 'Approve',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    try {
      await approveDeployment.mutateAsync({ deploymentId })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
    } catch (error: any) {
      toastError({ title: 'Failed to approve deployment', description: error.message })
    }
  }

  /**
   * Handle reject deployment - opens dialog
   */
  const handleRejectDeploymentClick = (deploymentId: string) => {
    setRejectDeploymentId(deploymentId)
    setRejectionReason('')
    setRejectDialogOpen(true)
  }

  /**
   * Handle reject deployment submit
   */
  const handleRejectDeploymentSubmit = async () => {
    if (!rejectDeploymentId || rejectionReason.length < 10) return

    try {
      await rejectDeployment.mutateAsync({
        deploymentId: rejectDeploymentId,
        reason: rejectionReason,
      })
      setRejectDialogOpen(false)
      setRejectDeploymentId(null)
      setRejectionReason('')
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
    } catch (error: any) {
      toastError({ title: 'Failed to reject deployment', description: error.message })
    }
  }

  /**
   * Handle deprecate deployment
   */
  const handleDeprecateDeployment = async (deploymentId: string) => {
    const confirmed = await confirm({
      title: 'Deprecate this deployment?',
      description:
        'This will remove the deployment from the marketplace. Existing installations will continue to work.',
      confirmText: 'Deprecate',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deprecateDeployment.mutateAsync({ deploymentId })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
    } catch (error: any) {
      toastError({ title: 'Failed to deprecate deployment', description: error.message })
    }
  }

  /**
   * Handle delete deployment
   */
  const handleDeleteDeployment = async (deploymentId: string) => {
    const confirmed = await confirm({
      title: 'Delete this deployment?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deleteDeployment.mutateAsync({ deploymentId })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
    } catch (error: any) {
      toastError({ title: 'Failed to delete deployment', description: error.message })
    }
  }

  /**
   * Handle toggle auto-approve
   */
  const handleToggleAutoApprove = async (checked: boolean) => {
    try {
      await toggleAutoApprove.mutateAsync({
        appId: id,
        autoApprove: checked,
      })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
    } catch (error: any) {
      toastError({ title: 'Failed to update auto-approve', description: error.message })
    }
  }

  if (isLoading) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Apps' href='/admin/apps' />
            <MainPageBreadcrumbItem title='Loading...' href='#' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='space-y-6'>
            <Skeleton className='h-12 w-full' />
            <Skeleton className='h-96 w-full' />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  if (!app) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Apps' href='/admin/apps' />
            <MainPageBreadcrumbItem title='Not Found' href='#' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex flex-col items-center justify-center h-full py-12'>
            <p className='text-muted-foreground'>App not found</p>
            <Button variant='outline' className='mt-4' onClick={() => router.push('/admin/apps')}>
              <ArrowLeft />
              Back to Apps
            </Button>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <>
      <ConfirmDialog />

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Deployment</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this deployment. The developer will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='reason'>Rejection Reason</Label>
              <Textarea
                id='reason'
                placeholder='Explain why this deployment is being rejected...'
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className='min-h-[100px]'
              />
              {rejectionReason.length < 10 && rejectionReason.length > 0 && (
                <p className='text-sm text-destructive'>Reason must be at least 10 characters</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRejectDeploymentSubmit}
              disabled={rejectionReason.length < 10 || rejectDeployment.isPending}
              loading={rejectDeployment.isPending}
              loadingText='Rejecting...'>
              Reject Deployment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MainPage>
        <MainPageHeader
          action={
            <div className='flex items-center gap-2'>
              {app.autoApprove && (
                <Badge
                  variant='secondary'
                  className='bg-green-500/10 text-green-500 border-green-500/20'>
                  Auto-Approve
                </Badge>
              )}
              <Badge variant={getPublicationStatusVariant(app.publicationStatus)}>
                {app.publicationStatus}
              </Badge>
              <Button
                size='sm'
                variant='destructive'
                onClick={handleDeleteApp}
                loading={deleteApp.isPending}
                loadingText='Deleting...'>
                <Trash2 />
                Delete App
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Apps' href='/admin/apps' />
            <MainPageBreadcrumbItem title={app.title} href={`/admin/apps/${id}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
            <div className='overflow-auto flex-1 relative'>
              <div className='grid lg:grid-cols-3'>
                <Card className='border-none rounded-none shadow-none'>
                  <CardHeader>
                    <CardTitle>App Information</CardTitle>
                    <CardDescription>Details about this app</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className='overflow-hidden rounded-md border bg-background'>
                      <Table>
                        <TableBody>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Developer Account
                            </TableCell>
                            <TableCell className='py-2'>
                              {app.developerAccount?.title || '-'}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Slug</TableCell>
                            <TableCell className='py-2 font-mono text-sm'>{app.slug}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Category</TableCell>
                            <TableCell className='py-2'>{app.category || '-'}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Publication Status
                            </TableCell>
                            <TableCell className='py-2'>
                              <Badge variant={getPublicationStatusVariant(app.publicationStatus)}>
                                {app.publicationStatus}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Auto-Approve
                            </TableCell>
                            <TableCell className='py-2'>
                              <div className='flex items-center gap-2'>
                                <Switch
                                  checked={app.autoApprove || false}
                                  onCheckedChange={handleToggleAutoApprove}
                                  disabled={toggleAutoApprove.isPending}
                                />
                                <span className='text-sm text-muted-foreground'>
                                  {app.autoApprove ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Website</TableCell>
                            <TableCell className='py-2'>
                              {app.websiteUrl ? (
                                <Button variant='link' className='h-auto p-0' asChild>
                                  <a
                                    href={app.websiteUrl}
                                    target='_blank'
                                    rel='noopener noreferrer'>
                                    <ExternalLink />
                                    Link
                                  </a>
                                </Button>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Documentation
                            </TableCell>
                            <TableCell className='py-2'>
                              {app.documentationUrl ? (
                                <Button variant='link' className='h-auto p-0' asChild>
                                  <a
                                    href={app.documentationUrl}
                                    target='_blank'
                                    rel='noopener noreferrer'>
                                    <ExternalLink />
                                    Link
                                  </a>
                                </Button>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Support Site
                            </TableCell>
                            <TableCell className='py-2'>
                              {app.supportSiteUrl ? (
                                <Button variant='link' className='h-auto p-0' asChild>
                                  <a
                                    href={app.supportSiteUrl}
                                    target='_blank'
                                    rel='noopener noreferrer'>
                                    <ExternalLink />
                                    Link
                                  </a>
                                </Button>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Has OAuth
                            </TableCell>
                            <TableCell className='py-2'>{app.hasOauth ? 'Yes' : 'No'}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              Has Bundle
                            </TableCell>
                            <TableCell className='py-2'>{app.hasBundle ? 'Yes' : 'No'}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Scopes</TableCell>
                            <TableCell className='py-2'>
                              {app.scopes.length > 0 ? app.scopes.join(', ') : '-'}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Created</TableCell>
                            <TableCell className='py-2'>
                              {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Updated</TableCell>
                            <TableCell className='py-2'>
                              {formatDistanceToNow(new Date(app.updatedAt), { addSuffix: true })}
                            </TableCell>
                          </TableRow>
                          {app.description && (
                            <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                              <TableCell className='bg-muted/50 py-2 font-medium'>
                                Description
                              </TableCell>
                              <TableCell className='py-2 text-sm'>{app.description}</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <Card className='col-span-2 border-none rounded-none shadow-none'>
                  <CardHeader>
                    <CardTitle>Deployments</CardTitle>
                    <CardDescription>Manage app deployments</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {app.deployments.length === 0 ? (
                      <div className='flex h-40 items-center justify-center text-muted-foreground'>
                        No deployments found
                      </div>
                    ) : (
                      <div className='rounded-md border'>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Deployment</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {app.deployments.map((deployment) => (
                              <TableRow key={deployment.id}>
                                <TableCell>
                                  <div>
                                    <div className='font-medium font-mono'>
                                      {deployment.version || 'Development'}
                                    </div>
                                    <div className='text-xs text-muted-foreground'>
                                      <Badge variant='outline' className='mr-2'>
                                        {deployment.deploymentType}
                                      </Badge>
                                      {formatDistanceToNow(new Date(deployment.createdAt), {
                                        addSuffix: true,
                                      })}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={getDeploymentStatusVariant(deployment.status)}>
                                    {deployment.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className='flex gap-1 justify-between'>
                                    <div className='flex gap-0.5'>
                                      {(deployment.status === 'pending-review' ||
                                        deployment.status === 'in-review') && (
                                        <>
                                          <Button
                                            size='sm'
                                            variant='outline'
                                            onClick={() => handleApproveDeployment(deployment.id)}
                                            loading={approveDeployment.isPending}>
                                            <CheckCircle />
                                            Approve
                                          </Button>
                                          <Button
                                            size='sm'
                                            variant='outline'
                                            onClick={() =>
                                              handleRejectDeploymentClick(deployment.id)
                                            }
                                            loading={rejectDeployment.isPending}>
                                            <XCircle />
                                            Reject
                                          </Button>
                                        </>
                                      )}
                                      {deployment.status === 'published' && (
                                        <Button
                                          size='sm'
                                          variant='outline'
                                          onClick={() => handleDeprecateDeployment(deployment.id)}
                                          loading={deprecateDeployment.isPending}>
                                          <Ban />
                                          Deprecate
                                        </Button>
                                      )}
                                    </div>
                                    <Button
                                      size='sm'
                                      variant='destructive-hover'
                                      onClick={() => handleDeleteDeployment(deployment.id)}
                                      loading={deleteDeployment.isPending}>
                                      <Trash2 />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </MainPageContent>
      </MainPage>
    </>
  )
}
