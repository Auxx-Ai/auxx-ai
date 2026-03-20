// apps/web/src/app/admin/developer-accounts/_components/developer-account-drawer.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { Ban, Code, Copy, Download, MoreHorizontal, Trash2, Upload, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { AddMemberDialog } from './add-member-dialog'
import { ImportAppsDialog } from './import-apps-dialog'

interface DeveloperAccount {
  id: string
  slug: string
  title: string
  logoUrl: string | null
  appCount: number
  memberCount: number
  createdAt: Date
}

interface DeveloperAccountDrawerProps {
  account: DeveloperAccount | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Get badge variant for publication status
 */
function getStatusVariant(status: string): 'outline' | 'secondary' | 'default' | 'destructive' {
  switch (status) {
    case 'private':
      return 'outline'
    case 'review':
      return 'secondary'
    case 'published':
      return 'default'
    case 'rejected':
      return 'destructive'
    default:
      return 'outline'
  }
}

/**
 * Right-side drawer showing developer account details and their apps.
 */
export function DeveloperAccountDrawer({
  account,
  open,
  onOpenChange,
}: DeveloperAccountDrawerProps) {
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: apps, isLoading: appsLoading } = api.admin.apps.getApps.useQuery(
    { developerAccountId: account?.id!, limit: 100, offset: 0 },
    { enabled: !!account?.id && open }
  )

  const { data: members, isLoading: membersLoading } =
    api.admin.getDeveloperAccountMembers.useQuery(
      { developerAccountId: account?.id! },
      { enabled: !!account?.id && open }
    )

  const { refetch: fetchExport, isFetching: isExporting } =
    api.admin.apps.exportByDeveloperAccount.useQuery(
      { developerAccountId: account?.id ?? '' },
      { enabled: false }
    )

  const deleteApp = api.admin.apps.deleteApp.useMutation({
    onSuccess: () => {
      utils.admin.apps.getApps.invalidate()
      utils.admin.getDeveloperAccounts.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete app', description: error.message })
    },
  })

  const removeMember = api.admin.removeDeveloperAccountMember.useMutation({
    onSuccess: () => {
      utils.admin.getDeveloperAccountMembers.invalidate()
      utils.admin.getDeveloperAccounts.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to remove member', description: error.message })
    },
  })

  const unpublishApp = api.admin.apps.unpublishApp.useMutation({
    onSuccess: () => {
      utils.admin.apps.getApps.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to unpublish app', description: error.message })
    },
  })

  /** Handle delete app with confirmation */
  const handleDeleteApp = async (appId: string, appTitle: string) => {
    const confirmed = await confirm({
      title: `Delete ${appTitle}?`,
      description:
        'This will permanently delete the app and all its deployments. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await deleteApp.mutateAsync({ id: appId })
    }
  }

  /** Handle unpublish app with confirmation */
  const handleUnpublishApp = async (appId: string, appTitle: string) => {
    const confirmed = await confirm({
      title: `Unpublish ${appTitle}?`,
      description:
        'This will remove the app from the marketplace. Existing installations will continue to work.',
      confirmText: 'Unpublish',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await unpublishApp.mutateAsync({ appId })
    }
  }

  const handleRemoveMember = async (memberId: string, email: string) => {
    const confirmed = await confirm({
      title: `Remove ${email}?`,
      description: 'This will revoke their access to this developer account.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await removeMember.mutateAsync({ memberId, developerAccountId: account!.id })
    }
  }

  const handleExport = async () => {
    const { data } = await fetchExport()
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `auxx-apps-export-${account!.slug}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open || !account) return null

  return (
    <>
      <ConfirmDialog />
      <DockableDrawer
        open={open}
        onOpenChange={onOpenChange}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={600}
        title='Developer Account'>
        <DrawerHeader
          icon={<Code className='h-4 w-4' />}
          title='Developer Account'
          actions={
            <>
              <Tooltip content='Import apps from JSON'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-full'
                  onClick={() => setImportDialogOpen(true)}
                  tabIndex={-1}>
                  <Upload />
                </Button>
              </Tooltip>
              <Tooltip content='Export apps as JSON'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-full'
                  loading={isExporting}
                  onClick={handleExport}
                  tabIndex={-1}>
                  <Download />
                </Button>
              </Tooltip>
              <DockToggleButton />
            </>
          }
          onClose={() => onOpenChange(false)}
        />

        {/* Account header */}
        <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
          <EntityIcon iconId='code' color='gray' className='size-10' />
          <div className='flex flex-col align-start w-full'>
            <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400'>
              {account.title}
            </div>
            <div className='text-xs text-neutral-500'>@{account.slug}</div>
          </div>
        </div>

        <ScrollArea className='flex-1'>
          <div>
            <Section title='Details'>
              <div className='grid grid-cols-2 gap-4 text-sm'>
                <div>
                  <div className='text-muted-foreground'>Members</div>
                  <div className='font-medium'>{account.memberCount}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>Apps</div>
                  <div className='font-medium'>{account.appCount}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>Created</div>
                  <div className='font-medium'>
                    {formatDistanceToNow(new Date(account.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
            </Section>

            <Section title='Apps' description='Apps published by this developer account'>
              {appsLoading ? (
                <div className='space-y-2'>
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className='h-10 w-full' />
                  ))}
                </div>
              ) : !apps || apps.length === 0 ? (
                <div className='text-sm text-muted-foreground py-4 text-center'>No apps found</div>
              ) : (
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className='w-10' />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apps.map((app) => (
                        <TableRow key={app.id}>
                          <TableCell>
                            <div>
                              <Link
                                href={`/admin/apps/${app.id}`}
                                className='font-medium text-sm hover:underline'>
                                {app.title}
                              </Link>
                              <div className='text-xs text-muted-foreground'>@{app.slug}</div>
                            </div>
                          </TableCell>
                          <TableCell className='text-sm'>
                            {app.latestDeployment?.version || (
                              <span className='text-muted-foreground'>-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(app.publicationStatus)}>
                              {app.publicationStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className='text-sm text-muted-foreground'>
                            {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant='ghost' size='icon-sm'>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                {app.publicationStatus === 'published' && (
                                  <DropdownMenuItem
                                    onClick={() => handleUnpublishApp(app.id, app.title)}>
                                    <Ban />
                                    Unpublish
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  variant='destructive'
                                  onClick={() => handleDeleteApp(app.id, app.title)}>
                                  <Trash2 />
                                  Delete App
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>

            <Section
              title='Members'
              description='Users with access to this developer account'
              actions={
                <Button variant='outline' size='sm' onClick={() => setAddMemberOpen(true)}>
                  <UserPlus />
                  Add Member
                </Button>
              }>
              {membersLoading ? (
                <div className='space-y-2'>
                  {[...Array(2)].map((_, i) => (
                    <Skeleton key={i} className='h-10 w-full' />
                  ))}
                </div>
              ) : !members || members.length === 0 ? (
                <div className='text-sm text-muted-foreground py-4 text-center'>
                  No members found
                </div>
              ) : (
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>User ID</TableHead>
                        <TableHead className='w-10' />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className='text-sm'>{member.emailAddress}</TableCell>
                          <TableCell>
                            <Badge variant={member.accessLevel === 'admin' ? 'default' : 'outline'}>
                              {member.accessLevel}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/admin/users/${member.userId}`}
                              className='text-sm font-mono text-muted-foreground hover:underline'>
                              {member.userId.slice(0, 8)}...
                            </Link>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant='ghost' size='icon-sm'>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuItem
                                  onClick={() => navigator.clipboard.writeText(member.userId)}>
                                  <Copy />
                                  Copy User ID
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant='destructive'
                                  onClick={() =>
                                    handleRemoveMember(member.id, member.emailAddress)
                                  }>
                                  <Trash2 />
                                  Remove Member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>
          </div>
        </ScrollArea>
      </DockableDrawer>
      <AddMemberDialog
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        developerAccountId={account?.id ?? ''}
        onMemberAdded={() => {
          utils.admin.getDeveloperAccountMembers.invalidate()
          utils.admin.getDeveloperAccounts.invalidate()
        }}
      />
      <ImportAppsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        targetDeveloperAccountId={account?.id ?? ''}
        onImportComplete={() => {
          utils.admin.apps.getApps.invalidate()
          utils.admin.getDeveloperAccounts.invalidate()
        }}
      />
    </>
  )
}
