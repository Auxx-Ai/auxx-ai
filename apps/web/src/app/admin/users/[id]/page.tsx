// apps/web/src/app/admin/users/[id]/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
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
import {
  ArrowLeft,
  Book,
  Building,
  Calendar,
  Mail,
  MessageSquare,
  Phone,
  Shield,
  Ticket,
  Trash2,
  User,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { use } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
/**
 * User detail page for admin
 */
export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data: user, isLoading } = api.admin.getUser.useQuery({ id })
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  /** Manage super admin mutation */
  const setSuperAdmin = api.admin.setUserSuperAdmin.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.admin.getUser.invalidate({ id }), utils.admin.getUsers.invalidate()])
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update super admin status',
        description: error.message,
      })
    },
  })

  const deleteUser = api.admin.deleteUser.useMutation({
    onSuccess: () => {
      router.push('/admin/users')
      utils.admin.getUsers.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete user',
        description: error.message,
      })
    },
  })

  /**
   * Handle delete user
   */
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete user?',
      description: 'Are you sure you want to delete this user? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    await deleteUser.mutateAsync({ id })
  }

  /**
   * Navigate to organization detail
   */
  const handleOrgClick = (orgId: string) => {
    router.push(`/admin/organizations/${orgId}`)
  }

  /**
   * Get display name for user
   */
  const getDisplayName = () => {
    if (!user) return ''
    if (user.name) return user.name
    if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`
    if (user.firstName) return user.firstName
    if (user.lastName) return user.lastName
    return 'Unnamed User'
  }

  /**
   * Get role badge variant
   */
  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'OWNER':
        return 'default'
      case 'ADMIN':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  /**
   * Toggle super admin status for current user
   */
  const handleToggleSuperAdmin = async () => {
    if (!user || setSuperAdmin.isPending) return

    if (!user.isSuperAdmin) {
      const confirmed = await confirm({
        title: 'Grant super admin access?',
        description:
          'Super admins can access all organizations and users. Only grant this to trusted people.',
        confirmText: 'Grant',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (!confirmed) return
    }

    await setSuperAdmin.mutateAsync({ id, isSuperAdmin: !user.isSuperAdmin })
  }

  if (isLoading) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Users' href='/admin/users' />
            <MainPageBreadcrumbItem title='Loading...' href='#' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex flex-col gap-4'>
            <div className='grid gap-4 md:grid-cols-2'>
              <Skeleton className='h-64' />
              <Skeleton className='h-64' />
            </div>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  if (!user) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Users' href='/admin/users' />
            <MainPageBreadcrumbItem title='Not Found' href='#' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex flex-col gap-4 items-center justify-center h-full py-12'>
            <p className='text-muted-foreground'>User not found</p>
            <Button variant='outline' onClick={() => router.push('/admin/users')}>
              <ArrowLeft />
              Back to Users
            </Button>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  /** Metric cards for the StatCards component */
  const metricCards: StatCardData[] = [
    {
      title: 'Organizations',
      body: user.metrics.organizationCount,
      icon: <Building className='size-4' />,
      color: 'text-blue-500',
    },
    {
      title: 'Messages',
      body: user.metrics.messageCount,
      icon: <MessageSquare className='size-4' />,
      color: 'text-good-500',
    },
    {
      title: 'Tickets',
      body: user.metrics.ticketCount,
      icon: <Ticket className='size-4' />,
      color: 'text-comparison-500',
    },
  ]

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <Button
              size='sm'
              variant='destructive'
              onClick={handleDelete}
              loading={deleteUser.isPending}>
              <Trash2 />
              Delete User
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Users' href='/admin/users' />
            <MainPageBreadcrumbItem title={getDisplayName()} href={`/admin/users/${id}`} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex flex-col overflow-y-auto bg-card flex-1'>
            <StatCards
              className='sticky top-0 z-10'
              cards={metricCards}
              columns={{
                default: 'grid-cols-3',
              }}
            />
            {/* Cards */}
            <div className='grid  md:grid-cols-2'>
              {/* User Information */}
              <Card className='border-none rounded-none shadow-none'>
                <CardHeader>
                  <CardTitle>User Information</CardTitle>
                  <CardDescription>Personal details and contact information</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='overflow-hidden rounded-md border bg-background'>
                    <Table>
                      <TableBody>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium flex items-center gap-1'>
                            <User className='size-3.5 text-muted-foreground' />
                            Name
                          </TableCell>
                          <TableCell className='py-2'>
                            {user.firstName || '-'} {user.lastName || '-'}
                          </TableCell>
                        </TableRow>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium'>
                            <div className='flex items-center gap-1'>
                              <Mail className='size-3.5 text-muted-foreground' />
                              Email
                            </div>
                          </TableCell>
                          <TableCell className='py-2'>
                            <div className='flex items-center gap-2'>
                              <span>{user.email || '-'}</span>
                              {user.emailVerified && (
                                <Badge variant='secondary' className='text-xs'>
                                  Verified
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {user.phoneNumber && (
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>
                              <div className='flex items-center gap-1'>
                                <Phone className='size-3.5 text-muted-foreground' />
                                Phone
                              </div>
                            </TableCell>
                            <TableCell className='py-2'>
                              <div className='flex items-center gap-2'>
                                <span>{user.phoneNumber}</span>
                                {user.phoneNumberVerified && (
                                  <Badge variant='outline' className='text-xs'>
                                    Verified
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium flex items-center gap-1'>
                            <Book className='size-3.5 text-muted-foreground' />
                            About
                          </TableCell>
                          <TableCell className='py-2'>{user.about}</TableCell>
                        </TableRow>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium flex items-center gap-1'>
                            <Calendar className='size-3.5 text-muted-foreground' />
                            Created
                          </TableCell>
                          <TableCell className='py-2'>
                            {formatDistanceToNow(user.createdAt, { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium flex items-center gap-1'>
                            <Calendar className='size-3.5 text-muted-foreground' />
                            Last Active
                          </TableCell>
                          <TableCell className='py-2'>
                            {user.lastActiveAt
                              ? formatDistanceToNow(user.lastActiveAt, { addSuffix: true })
                              : 'Never'}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Security & Settings */}
              <Card className='border-none rounded-none shadow-none'>
                <CardHeader>
                  <CardTitle>Security & Settings</CardTitle>
                  <CardDescription>Account security and preferences</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='overflow-hidden rounded-md border bg-background'>
                    <Table>
                      <TableBody>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium'>
                            Email Verified
                          </TableCell>
                          <TableCell className='py-2'>
                            <Badge variant={user.emailVerified ? 'default' : 'outline'}>
                              {user.emailVerified ? 'Yes' : 'No'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium'>
                            Two-Factor Authentication
                          </TableCell>
                          <TableCell className='py-2'>
                            <Badge variant={user.twoFactorEnabled ? 'default' : 'outline'}>
                              {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium'>
                            Onboarding Completed
                          </TableCell>
                          <TableCell className='py-2'>
                            <Badge variant={user.completedOnboarding ? 'default' : 'outline'}>
                              {user.completedOnboarding ? 'Yes' : 'No'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                          <TableCell className='bg-muted/50 py-2 font-medium'>
                            Super Admin
                          </TableCell>
                          <TableCell className='py-2'>
                            <div className='flex flex-col gap-2'>
                              <div className='flex items-center gap-2 justify-between'>
                                <Badge variant={user.isSuperAdmin ? 'destructive' : 'outline'}>
                                  {user.isSuperAdmin ? 'Yes' : 'No'}
                                </Badge>
                                <Button
                                  variant={user.isSuperAdmin ? 'outline' : 'destructive'}
                                  loading={setSuperAdmin.isPending}
                                  size='sm'
                                  loadingText='Saving...'
                                  onClick={handleToggleSuperAdmin}>
                                  <Shield />
                                  {user.isSuperAdmin ? 'Revoke' : 'Grant'}
                                </Button>
                              </div>
                              {!user.isSuperAdmin && (
                                <p className='text-xs text-muted-foreground'>
                                  Granting super admin access provides full visibility and control
                                  across the platform.
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Separator />
            {/* Organizations */}
            <Card className='border-none rounded-none shadow-none'>
              <CardHeader>
                <CardTitle>Organizations</CardTitle>
                <CardDescription>Organizations this user is a member of</CardDescription>
              </CardHeader>
              <CardContent>
                {user.organizations.length > 0 ? (
                  <div className='border rounded-md'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Handle</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Joined</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {user.organizations.map((org) => (
                          <TableRow
                            key={org.id}
                            className='hover:bg-muted/50 cursor-pointer'
                            onClick={() => handleOrgClick(org.id)}>
                            <TableCell className='font-medium'>{org.name || '-'}</TableCell>
                            <TableCell className='text-muted-foreground'>
                              {org.handle || '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getRoleBadgeVariant(org.role)}>{org.role}</Badge>
                            </TableCell>
                            <TableCell className='text-sm text-muted-foreground'>
                              {formatDistanceToNow(org.joinedAt, { addSuffix: true })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground text-center py-8'>
                    This user is not a member of any organizations
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </MainPageContent>
      </MainPage>
    </>
  )
}
