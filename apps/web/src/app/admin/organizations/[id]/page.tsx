// apps/web/src/app/admin/organizations/[id]/page.tsx
'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { Table, TableBody, TableCell, TableRow } from '@auxx/ui/components/table'
import { TrialManagementSection } from './_components/trial-management-section'
import { OrganizationAccessSection } from './_components/organization-access-section'
import { SubscriptionManagementSection } from './_components/subscription-management-section'
import { EnterpriseManagementSection } from './_components/enterprise-management-section'
import { ActionHistoryPanel } from './_components/action-history-panel'
import { OrganizationActionsSection } from './_components/organization-actions-section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'

/**
 * Organization details page for admin
 */
export default function OrganizationDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [activeTab, setActiveTab] = useState('overview')

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: org, isLoading } = api.admin.getOrganization.useQuery({ id })
  const { data: members, isLoading: membersLoading } = api.admin.getOrganizationMembers.useQuery({
    organizationId: id,
  })
  const { data: plans } = api.admin.getPlans.useQuery()

  const deleteOrg = api.admin.deleteOrganization.useMutation({
    onSuccess: () => {
      utils.admin.getOrganizations.invalidate()
      router.push('/admin/organizations')
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete organization',
        description: error.message,
      })
    },
  })

  const changePlan = api.admin.changePlan.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate()
      utils.admin.getOrganizations.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to change plan',
        description: error.message,
      })
    },
  })

  /**
   * Handle delete organization
   */
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Organization?',
      description: `Are you sure you want to delete "${org?.name || 'this organization'}"? This action cannot be undone and will delete all associated data.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed && org) {
      deleteOrg.mutate({ id: org.id })
    }
  }

  /**
   * Handle plan change
   */
  const handlePlanChange = async (planName: string) => {
    const confirmed = await confirm({
      title: 'Change Plan?',
      description: `Are you sure you want to change this organization's plan to ${planName}?`,
      confirmText: 'Change Plan',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    await changePlan.mutateAsync({
      organizationId: id,
      planName,
    })
  }

  /**
   * Handle billing cycle change
   */
  const handleBillingCycleChange = async (billingCycle: 'MONTHLY' | 'ANNUAL') => {
    const confirmed = await confirm({
      title: 'Change Billing Cycle?',
      description: `Are you sure you want to change the billing cycle to ${billingCycle.toLowerCase()}?`,
      confirmText: 'Change Billing Cycle',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    await changePlan.mutateAsync({
      organizationId: id,
      planName: org?.subscription?.plan || '',
      billingCycle,
    })
  }

  if (isLoading) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Organizations" href="/admin/organizations" />
            <MainPageBreadcrumbItem title="Loading..." href="#" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-none rounded-none shadow-none">
              <CardHeader>
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  if (!org) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Organizations" href="/admin/organizations" />
            <MainPageBreadcrumbItem title="Not Found" href="#" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="flex flex-col items-center justify-center h-full py-12">
            <p className="text-muted-foreground">Organization not found</p>
            <Button variant="outline" className="mt-4" onClick={() => router.push('/admin/organizations')}>
              <ArrowLeft />
              Back to Organizations
            </Button>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              loading={deleteOrg.isPending}>
              <Trash2 />
              Delete Organization
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Organizations" href="/admin/organizations" />
            <MainPageBreadcrumbItem
              title={org.name || org.handle || 'Organization'}
              href={`/admin/organizations/${id}`}
              last
            />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          {/* Organization Details */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="billing">Billing Actions</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid md:grid-cols-2">
              {/* Actions */}

              {/* Overview */}
              <Card className="border-none rounded-none shadow-none">
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                  <CardDescription>Basic organization information</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-md border bg-background">
                    <Table>
                      <TableBody>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">ID</TableCell>
                          <TableCell className="py-2 font-mono text-sm">{org.id}</TableCell>
                        </TableRow>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">Name</TableCell>
                          <TableCell className="py-2 font-medium">{org.name || '-'}</TableCell>
                        </TableRow>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">Handle</TableCell>
                          <TableCell className="py-2">{org.handle || '-'}</TableCell>
                        </TableRow>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">Type</TableCell>
                          <TableCell className="py-2">
                            <Badge variant="outline" className="uppercase text-xs">
                              {org.type}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">Website</TableCell>
                          <TableCell className="py-2">
                            {org.website ? (
                              <a
                                href={org.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline">
                                {org.website}
                              </a>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">Created</TableCell>
                          <TableCell className="py-2">{format(org.createdAt, 'PPP p')}</TableCell>
                        </TableRow>
                        <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                          <TableCell className="bg-muted/50 py-2 font-medium">Updated</TableCell>
                          <TableCell className="py-2">{format(org.updatedAt, 'PPP p')}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Subscription */}
              <Card className="border-none rounded-none shadow-none">
                <CardHeader>
                  <CardTitle>Subscription</CardTitle>
                  <CardDescription>Billing and plan details</CardDescription>
                </CardHeader>
                <CardContent>
                  {org.subscription ? (
                    <div className="overflow-hidden rounded-md border bg-background">
                      <Table>
                        <TableBody>
                          <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                            <TableCell className="bg-muted/50 py-2 font-medium">Plan</TableCell>
                            <TableCell className="py-2">
                              <Select
                                value={org.subscription.plan.toLowerCase()}
                                onValueChange={handlePlanChange}
                                disabled={changePlan.isPending}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {plans?.map((plan) => (
                                    <SelectItem key={plan.id} value={plan.name}>
                                      {plan.name.charAt(0).toUpperCase() + plan.name.slice(1)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                          <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                            <TableCell className="bg-muted/50 py-2 font-medium">
                              Billing Cycle
                            </TableCell>
                            <TableCell className="py-2">
                              <Select
                                value={org.subscription.billingCycle}
                                onValueChange={(value) =>
                                  handleBillingCycleChange(value as 'MONTHLY' | 'ANNUAL')
                                }
                                disabled={changePlan.isPending}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                                  <SelectItem value="ANNUAL">Annual</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                          <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                            <TableCell className="bg-muted/50 py-2 font-medium">Status</TableCell>
                            <TableCell className="py-2">
                              <Badge
                                variant={
                                  org.subscription.status === 'ACTIVE' ? 'default' : 'outline'
                                }
                                className="uppercase text-xs">
                                {org.subscription.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                            <TableCell className="bg-muted/50 py-2 font-medium">Seats</TableCell>
                            <TableCell className="py-2">{org.subscription.seats}</TableCell>
                          </TableRow>
                          <TableRow className="*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r">
                            <TableCell className="bg-muted/50 py-2 font-medium">
                              Credits Balance
                            </TableCell>
                            <TableCell className="py-2 font-mono">
                              {org.subscription.creditsBalance}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No subscription</div>
                  )}
                </CardContent>
              </Card>
              <OrganizationActionsSection organizationId={org.id} organizationName={org.name} />

              {/* Metrics */}
              <Card className="md:col-span-2 border-none rounded-none shadow-none">
                <CardHeader>
                  <CardTitle>Metrics</CardTitle>
                  <CardDescription>Usage statistics and resource counts</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Users</div>
                    <div className="text-3xl font-bold">{org.metrics.userCount}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Tickets</div>
                    <div className="text-3xl font-bold">{org.metrics.ticketCount}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Messages</div>
                    <div className="text-3xl font-bold">{org.metrics.messageCount}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Contacts</div>
                    <div className="text-3xl font-bold">{org.metrics.contactCount}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Workflows</div>
                    <div className="text-3xl font-bold">{org.metrics.workflowCount}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Datasets</div>
                    <div className="text-3xl font-bold">{org.metrics.datasetCount}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Documents</div>
                    <div className="text-3xl font-bold">{org.metrics.documentCount}</div>
                  </div>
                </CardContent>
              </Card>

              {/* Members */}
              <Card className="md:col-span-2 border-none rounded-none shadow-none">
                <CardHeader>
                  <CardTitle>Members</CardTitle>
                  <CardDescription>Organization team members and their roles</CardDescription>
                </CardHeader>
                <CardContent>
                  {membersLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : members && members.length > 0 ? (
                    <div className="space-y-2">
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                              {member.user?.name?.[0]?.toUpperCase() ||
                                member.user?.email?.[0]?.toUpperCase() ||
                                '?'}
                            </div>
                            <div>
                              <div className="font-medium">{member.user?.name || 'Unknown'}</div>
                              <div className="text-sm text-muted-foreground">
                                {member.user?.email}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={member.role === 'OWNER' ? 'default' : 'outline'}>
                              {member.role}
                            </Badge>
                            {member.status !== 'ACTIVE' && (
                              <Badge variant="secondary">{member.status}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">No members found</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Billing Actions Tab */}
          <TabsContent value="billing" className="space-y-4">
            {/* Trial & Access Management - Side by Side */}
            <div className="grid gap-4 md:grid-cols-2">
              {org.subscription && (
                <TrialManagementSection
                  organizationId={org.id}
                  organizationName={org.name}
                  subscription={{
                    trialEnd: org.subscription.trialEnd,
                    hasTrialEnded: org.subscription.hasTrialEnded,
                    status: org.subscription.status,
                    trialConversionStatus: org.subscription.trialConversionStatus,
                  }}
                />
              )}

              <OrganizationAccessSection
                organizationId={org.id}
                organizationName={org.name}
                disabledAt={org.disabledAt}
                disabledReason={org.disabledReason}
                subscription={
                  org.subscription
                    ? {
                        deletionScheduledDate: org.subscription.deletionScheduledDate,
                        deletionReason: org.subscription.deletionReason,
                      }
                    : null
                }
              />
            </div>

            {/* Subscription & Enterprise Management - Side by Side */}
            <div className="grid gap-4 md:grid-cols-2">
              {org.subscription && (
                <SubscriptionManagementSection
                  organizationId={org.id}
                  organizationName={org.name}
                  subscription={{
                    id: org.subscription.id,
                    status: org.subscription.status,
                    plan: org.subscription.plan,
                    canceledAt: org.subscription.canceledAt,
                    cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
                    periodEnd: org.subscription.periodEnd,
                    creditsBalance: org.subscription.creditsBalance,
                  }}
                />
              )}

              {org.subscription && (
                <EnterpriseManagementSection
                  organizationId={org.id}
                  organizationName={org.name}
                  subscription={{
                    plan: org.subscription.plan,
                  }}
                />
              )}
            </div>

            {/* Action History - Full Width */}
            <ActionHistoryPanel organizationId={org.id} />
          </TabsContent>
        </Tabs>
        </MainPageContent>
      </MainPage>
    </>
  )
}
