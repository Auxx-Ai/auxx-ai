'use client'

import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@auxx/ui/components/empty'
import { Button } from '@auxx/ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Badge } from '@auxx/ui/components/badge'
import { PackageOpen, Copy, Check, Loader2 } from 'lucide-react'
import React, { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useApp } from '~/components/providers/dehydrated-state-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatVersion } from '@auxx/services/shared/utils'
import { format } from 'date-fns'
import { PublishAppDialog } from '~/components/apps/publish-app-dialog'
import { useConfirm } from '@/hooks/use-confirm'
import { toastError } from '~/components/global/toast'

type Props = {}

/**
 * Command to create a new version
 */
const CREATE_VERSION_COMMAND = 'npx auxx version create'
type Version = RouterOutputs['versions']['list'][number]

/**
 * Versions page component
 */
function VersionsPage({}: Props) {
  // Get app context from URL params
  const params = useParams<{ slug: string; app_slug: string }>()
  const app = useApp(params.slug, params.app_slug)
  const router = useRouter()

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  // Fetch versions
  const {
    data: versions,
    isLoading,
    refetch,
  } = api.versions.list.useQuery({ appId: app?.id || '' }, { enabled: !!app?.id })

  const updateVersionStatus = api.versions.updatePublicationStatus.useMutation({
    onSuccess: () => {
      router.refresh()
      void refetch()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update version status', description: error.message })
    },
  })

  const [copied, setCopied] = useState(false)

  /**
   * Handle unpublishing a version
   */
  const handleUnpublish = async (version: Version) => {
    const confirmed = await confirm({
      title: 'Unpublish version?',
      description: 'This version will no longer be available for new installations.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      updateVersionStatus.mutate({ versionId: version.id, action: 'unpublish' })
    }
  }

  /**
   * Handle withdrawing version from review
   */
  const handleWithdraw = async (version: Version) => {
    const confirmed = await confirm({
      title: 'Withdraw from review?',
      description: 'This version will return to draft status.',
      confirmText: 'Withdraw',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      updateVersionStatus.mutate({ versionId: version.id, action: 'withdraw' })
    }
  }

  /**
   * Handle publishing an approved version
   */
  const handlePublish = async (version: Version) => {
    const confirmed = await confirm({
      title: 'Publish version?',
      description:
        'This version will be published to the marketplace and available for installation.',
      confirmText: 'Publish',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      updateVersionStatus.mutate({ versionId: version.id, action: 'publish' })
    }
  }

  /**
   * Copy command to clipboard
   */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CREATE_VERSION_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 overflow-y-auto">
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Loading versions...</EmptyTitle>
            <EmptyDescription>Fetching version history</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // Empty state
  if (!versions || versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 overflow-y-auto">
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageOpen />
            </EmptyMedia>
            <EmptyTitle>No versions yet</EmptyTitle>
            <EmptyDescription>
              Run this command in your project's directory to create a version and upload your code:
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="bg-primary-150 px-4 py-4 rounded-2xl relative">
            <code className="font-mono text-sm flex-1">{CREATE_VERSION_COMMAND}</code>
            <Button
              className="absolute right-3 top-1/2 -translate-y-1/2"
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}>
              {copied ? <Check /> : <Copy />}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  // Data state - display table
  return (
    <>
      <ConfirmDialog />
      <div className="flex flex-col flex-1 overflow-y-auto p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Created at</TableHead>
              <TableHead>Installations</TableHead>
              <TableHead>State</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((version) => (
              <TableRow key={version.id}>
                <TableCell className="font-mono">
                  <div className="truncate">
                    {formatVersion(version.major, version.minor ?? 0, version.patch ?? 0)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="truncate">
                    {format(new Date(version.createdAt), 'MMM dd, yyyy')}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="truncate">{version.numInstallations || 0}</div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    {version.reviewStatus ? (
                      <Badge
                        variant={
                          version.reviewStatus === 'approved'
                            ? 'green'
                            : version.reviewStatus === 'rejected'
                              ? 'destructive'
                              : version.reviewStatus === 'pending-review' ||
                                  version.reviewStatus === 'in-review'
                                ? 'secondary'
                                : 'outline'
                        }>
                        {version.reviewStatus === 'pending-review'
                          ? 'pending review'
                          : version.reviewStatus}
                      </Badge>
                    ) : (
                      <Badge variant="outline">draft</Badge>
                    )}
                    {version.publicationStatus === 'published' && (
                      <Badge variant="default">published</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {version.publicationStatus === 'published' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnpublish(version)}
                      loading={updateVersionStatus.isPending}>
                      Unpublish
                    </Button>
                  ) : version.reviewStatus === 'pending-review' ||
                    version.reviewStatus === 'in-review' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleWithdraw(version)}
                      loading={updateVersionStatus.isPending}>
                      Withdraw
                    </Button>
                  ) : version.reviewStatus === 'approved' ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handlePublish(version)}
                      loading={updateVersionStatus.isPending}>
                      Publish
                    </Button>
                  ) : (
                    <PublishAppDialog
                      mode="version"
                      appSlug={params.app_slug}
                      version={version}
                      trigger={
                        <Button variant="outline" size="sm">
                          Submit for Review
                        </Button>
                      }
                      onSuccess={() => void refetch()}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

export default VersionsPage
