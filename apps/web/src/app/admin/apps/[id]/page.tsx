// apps/web/src/app/admin/apps/[id]/page.tsx
'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { ArrowLeft, Trash2, ExternalLink, CheckCircle, XCircle, Ban } from 'lucide-react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { Badge } from '@auxx/ui/components/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Textarea } from '@auxx/ui/components/textarea'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'

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
 * Get badge variant for review status
 */
function getReviewStatusVariant(
  status: string | null
): 'outline' | 'secondary' | 'default' | 'destructive' {
  switch (status) {
    case 'pending-review':
    case 'in-review':
      return 'secondary'
    case 'approved':
      return 'default'
    case 'rejected':
      return 'destructive'
    case 'withdrawn':
      return 'outline'
    default:
      return 'outline'
  }
}

/**
 * Get badge variant for lifecycle status
 */
function getLifecycleVariant(status: string | null): 'outline' | 'default' | 'secondary' {
  switch (status) {
    case 'draft':
      return 'outline'
    case 'active':
      return 'default'
    case 'deprecated':
      return 'secondary'
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
  const [rejectVersionId, setRejectVersionId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const utils = api.useUtils()

  const deleteApp = api.admin.apps.deleteApp.useMutation()
  const approveVersion = api.admin.apps.approveVersion.useMutation()
  const rejectVersion = api.admin.apps.rejectVersion.useMutation()
  const unpublishVersion = api.admin.apps.unpublishVersion.useMutation()
  const deleteVersion = api.admin.apps.deleteVersion.useMutation()
  const toggleAutoApprove = api.admin.apps.toggleAutoApprove.useMutation()

  /**
   * Handle delete app
   */
  const handleDeleteApp = async () => {
    const confirmed = await confirm({
      title: 'Delete this app?',
      description:
        'This will permanently delete the app and all its versions. This action cannot be undone.',
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
   * Handle approve version
   */
  const handleApproveVersion = async (versionId: string) => {
    const confirmed = await confirm({
      title: 'Approve this version?',
      description: 'This will make the version available in the marketplace.',
      confirmText: 'Approve',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    try {
      await approveVersion.mutateAsync({ versionId })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
      // Invalidate build app cache so developers see updated status
      // await utils.apps.get.invalidate()
    } catch (error: any) {
      toastError({ title: 'Failed to approve version', description: error.message })
    }
  }

  /**
   * Handle reject version - opens dialog
   */
  const handleRejectVersionClick = (versionId: string) => {
    setRejectVersionId(versionId)
    setRejectionReason('')
    setRejectDialogOpen(true)
  }

  /**
   * Handle reject version submit
   */
  const handleRejectVersionSubmit = async () => {
    if (!rejectVersionId || rejectionReason.length < 10) return

    try {
      await rejectVersion.mutateAsync({
        versionId: rejectVersionId,
        reason: rejectionReason,
      })
      setRejectDialogOpen(false)
      setRejectVersionId(null)
      setRejectionReason('')
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
      // Invalidate build app cache so developers see updated status
      // await utils.apps.get.invalidate()
    } catch (error: any) {
      toastError({ title: 'Failed to reject version', description: error.message })
    }
  }

  /**
   * Handle unpublish version
   */
  const handleUnpublishVersion = async (versionId: string) => {
    const confirmed = await confirm({
      title: 'Unpublish this version?',
      description:
        'This will remove the version from the marketplace. Existing installations will continue to work.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await unpublishVersion.mutateAsync({ versionId })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
      // Invalidate build app cache so developers see updated status
      // await utils.apps.get.invalidate()
    } catch (error: any) {
      toastError({ title: 'Failed to unpublish version', description: error.message })
    }
  }

  /**
   * Handle delete version
   */
  const handleDeleteVersion = async (versionId: string) => {
    const confirmed = await confirm({
      title: 'Delete this version?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deleteVersion.mutateAsync({ versionId })
      router.refresh()
      await utils.admin.apps.getApp.invalidate({ id })
    } catch (error: any) {
      toastError({ title: 'Failed to delete version', description: error.message })
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
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Apps" href="/admin/apps" />
            <MainPageBreadcrumbItem title="Loading..." href="#" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="space-y-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-96 w-full" />
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
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Apps" href="/admin/apps" />
            <MainPageBreadcrumbItem title="Not Found" href="#" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="flex flex-col items-center justify-center h-full py-12">
            <p className="text-muted-foreground">App not found</p>
            <Button variant="outline" className="mt-4" onClick={() => router.push('/admin/apps')}>
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
            <DialogTitle>Reject Version</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this version. The developer will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason</Label>
              <Textarea
                id="reason"
                placeholder="Explain why this version is being rejected..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="min-h-[100px]"
              />
              {rejectionReason.length < 10 && rejectionReason.length > 0 && (
                <p className="text-sm text-destructive">Reason must be at least 10 characters</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectVersionSubmit}
              disabled={rejectionReason.length < 10 || rejectVersion.isPending}
              loading={rejectVersion.isPending}
              loadingText="Rejecting...">
              Reject Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MainPage>
        <MainPageHeader
          action={
            <div className="flex items-center gap-2">
              {app.autoApprove && (
                <Badge
                  variant="secondary"
                  className="bg-green-500/10 text-green-500 border-green-500/20">
                  Auto-Approve
                </Badge>
              )}
              {app.reviewStatus && (
                <Badge variant={getReviewStatusVariant(app.reviewStatus)}>{app.reviewStatus}</Badge>
              )}
              <Badge variant={getPublicationStatusVariant(app.publicationStatus)}>
                {app.publicationStatus}
              </Badge>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteApp}
                loading={deleteApp.isPending}
                loadingText="Deleting...">
                <Trash2 />
                Delete App
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Apps" href="/admin/apps" />
            <MainPageBreadcrumbItem
              title={app.title}
              href={`/admin/apps/${id}`}
              last
            />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="grid lg:grid-cols-3">
            <Card className="border-none rounded-none shadow-none">
          <CardHeader>
            <CardTitle>App Information</CardTitle>
            <CardDescription>Details about this app</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border bg-background">
              <Table>
                <TableBody>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      Developer Account
                    </TableCell>
                    <TableCell className="py-2">{app.developerAccount?.title || '-'}</TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Slug</TableCell>
                    <TableCell className="py-2 font-mono text-sm">{app.slug}</TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Category</TableCell>
                    <TableCell className="py-2">{app.category || '-'}</TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">
                      Publication Status
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={getPublicationStatusVariant(app.publicationStatus)}>
                        {app.publicationStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {app.reviewStatus && (
                    <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                      <TableCell className="bg-muted/50 py-2 font-medium">Review Status</TableCell>
                      <TableCell className="py-2">
                        <Badge variant={getReviewStatusVariant(app.reviewStatus)}>
                          {app.reviewStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Auto-Approve</TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={app.autoApprove || false}
                          onCheckedChange={handleToggleAutoApprove}
                          disabled={toggleAutoApprove.isPending}
                        />
                        <span className="text-sm text-muted-foreground">
                          {app.autoApprove ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Website</TableCell>
                    <TableCell className="py-2">
                      {app.websiteUrl ? (
                        <Button variant="link" className="h-auto p-0" asChild>
                          <a href={app.websiteUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink />
                            Link
                          </a>
                        </Button>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Documentation</TableCell>
                    <TableCell className="py-2">
                      {app.documentationUrl ? (
                        <Button variant="link" className="h-auto p-0" asChild>
                          <a href={app.documentationUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink />
                            Link
                          </a>
                        </Button>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Support Site</TableCell>
                    <TableCell className="py-2">
                      {app.supportSiteUrl ? (
                        <Button variant="link" className="h-auto p-0" asChild>
                          <a href={app.supportSiteUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink />
                            Link
                          </a>
                        </Button>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Has OAuth</TableCell>
                    <TableCell className="py-2">{app.hasOauth ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Has Bundle</TableCell>
                    <TableCell className="py-2">{app.hasBundle ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Scopes</TableCell>
                    <TableCell className="py-2">
                      {app.scopes.length > 0 ? app.scopes.join(', ') : '-'}
                    </TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Created</TableCell>
                    <TableCell className="py-2">
                      {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                  <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                    <TableCell className="bg-muted/50 py-2 font-medium">Updated</TableCell>
                    <TableCell className="py-2">
                      {formatDistanceToNow(new Date(app.updatedAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                  {app.description && (
                    <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                      <TableCell className="bg-muted/50 py-2 font-medium">Description</TableCell>
                      <TableCell className="py-2 text-sm">{app.description}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 border-none rounded-none shadow-none">
          <CardHeader>
            <CardTitle>Versions</CardTitle>
            <CardDescription>Manage app versions</CardDescription>
          </CardHeader>
          <CardContent>
            {app.versions.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                No versions found
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {app.versions.map((version) => (
                      <TableRow key={version.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium font-mono">{version.versionString}</div>
                            <div className="text-xs text-muted-foreground">
                              <Badge variant={getLifecycleVariant(version.status)} className="mr-2">
                                {version.status}
                              </Badge>
                              {version.releasedAt &&
                                formatDistanceToNow(new Date(version.releasedAt), {
                                  addSuffix: true,
                                })}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {version.reviewStatus && (
                              <Badge variant={getReviewStatusVariant(version.reviewStatus)}>
                                {version.reviewStatus}
                              </Badge>
                            )}
                            <Badge
                              variant={getPublicationStatusVariant(
                                version.publicationStatus || 'unpublished'
                              )}>
                              {version.publicationStatus || 'unpublished'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-between">
                            <div className="flex gap-0.5">
                              {(version.reviewStatus === 'pending-review' ||
                                version.reviewStatus === 'in-review') && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleApproveVersion(version.id)}
                                    loading={approveVersion.isPending}>
                                    <CheckCircle />
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRejectVersionClick(version.id)}
                                    loading={rejectVersion.isPending}>
                                    <XCircle />
                                    Reject
                                  </Button>
                                </>
                              )}
                              {version.publicationStatus === 'published' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleUnpublishVersion(version.id)}
                                  loading={unpublishVersion.isPending}>
                                  <Ban />
                                  Unpublish
                                </Button>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="destructive-hover"
                              onClick={() => handleDeleteVersion(version.id)}
                              loading={deleteVersion.isPending}>
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
        </MainPageContent>
      </MainPage>
    </>
  )
}
