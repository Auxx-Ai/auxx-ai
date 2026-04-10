// apps/web/src/app/admin/organizations/[id]/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { Table, TableBody, TableCell, TableRow } from '@auxx/ui/components/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronDown,
  Code,
  Contact,
  CreditCard,
  Database,
  FileText,
  HardDrive,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Sliders,
  Ticket,
  Trash2,
  Users,
  Workflow,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { ActionHistoryPanel } from './_components/action-history-panel'
import { EnterpriseManagementSection } from './_components/enterprise-management-section'
import { MembersSection } from './_components/members-section'
import { OrgFeaturesTab } from './_components/org-features-tab'
import { OrganizationAccessSection } from './_components/organization-access-section'

import { SubscriptionManagementSection } from './_components/subscription-management-section'
import { TrialManagementSection } from './_components/trial-management-section'

/**
 * Organization details page for admin
 */
export default function OrganizationDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'overview' })
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: org, isLoading } = api.admin.getOrganization.useQuery({ id })
  const { data: plans } = api.admin.getPlans.useQuery()
  const { data: usage } = api.admin.getOrganizationUsage.useQuery(
    { organizationId: id },
    { enabled: !isLoading && !!org }
  )

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

  const seedOrganization = api.admin.seedOrganization.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: 'Seeding Completed', description: data.message })
    },
    onError: (error) => {
      toastError({
        title: 'Seeding Failed',
        description: error.message,
      })
    },
  })

  const flushCache = api.admin.flushOrgCache.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Cache flushed',
        description: 'All cached data cleared for this organization',
      })
    },
    onError: (error) => {
      toastError({ title: 'Failed to flush cache', description: error.message })
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

  const seedScenarios = [
    { value: 'demo' as const, label: 'Demo (light)' },
    { value: 'superadmin-test' as const, label: 'Test (10x heavy)' },
    { value: 'development' as const, label: 'Development' },
    { value: 'testing' as const, label: 'Testing (minimal)' },
  ]

  /**
   * Handle Reset and Seed action
   */
  const handleResetAndSeed = async (scenario: (typeof seedScenarios)[number]['value']) => {
    const confirmed = await confirm({
      title: 'Reset and Seed Organization?',
      description: `This will delete ALL data for "${org?.name || 'this organization'}" and reseed with "${scenario}" data. Billing data and subscriptions will be preserved. This action cannot be undone.`,
      confirmText: 'Reset and Seed',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await seedOrganization.mutateAsync({
        organizationId: id,
        mode: 'reset',
        scenario,
      })
    }

    setIsDropdownOpen(false)
  }

  /**
   * Handle Add Seed Data action
   */
  const handleAddSeedData = async (scenario: (typeof seedScenarios)[number]['value']) => {
    const confirmed = await confirm({
      title: 'Add Seed Data?',
      description: `This will add "${scenario}" data to "${org?.name || 'this organization'}" without deleting existing data.`,
      confirmText: 'Add Data',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      await seedOrganization.mutateAsync({
        organizationId: id,
        mode: 'additive',
        scenario,
      })
    }

    setIsDropdownOpen(false)
  }

  if (isLoading) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Organizations' href='/admin/organizations' />
            <MainPageBreadcrumbItem title='Loading...' href='#' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='grid gap-4 md:grid-cols-2'>
            <Card className='border-none rounded-none shadow-none'>
              <CardHeader>
                <Skeleton className='h-5 w-24' />
              </CardHeader>
              <CardContent className='space-y-4'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-3/4' />
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
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Organizations' href='/admin/organizations' />
            <MainPageBreadcrumbItem title='Not Found' href='#' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex flex-col items-center justify-center h-full py-12'>
            <p className='text-muted-foreground'>Organization not found</p>
            <Button
              variant='outline'
              className='mt-4'
              onClick={() => router.push('/admin/organizations')}>
              <ArrowLeft />
              Back to Organizations
            </Button>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  /** Metric cards for the StatCards component */
  const metricCards: StatCardData[] = [
    {
      title: 'Users',
      body: org.metrics.userCount,
      icon: <Users className='size-4' />,
      color: 'text-blue-500',
    },
    {
      title: 'Tickets',
      body: org.metrics.ticketCount,
      icon: <Ticket className='size-4' />,
      color: 'text-comparison-500',
    },
    {
      title: 'Messages',
      body: org.metrics.messageCount,
      icon: <MessageSquare className='size-4' />,
      color: 'text-good-500',
    },
    {
      title: 'Contacts',
      body: org.metrics.contactCount,
      icon: <Contact className='size-4' />,
      color: 'text-fuchsia-500',
    },
    {
      title: 'Workflows',
      body: org.metrics.workflowCount,
      icon: <Workflow className='size-4' />,
      color: 'text-blue-500',
    },
    {
      title: 'Datasets',
      body: org.metrics.datasetCount,
      icon: <BookOpen className='size-4' />,
      color: 'text-comparison-500',
    },
    {
      title: 'Documents',
      body: org.metrics.documentCount,
      icon: <FileText className='size-4' />,
      color: 'text-good-500',
    },
  ]

  /** Get color class based on usage percentage */
  const getUsageColor = (percent: number, unlimited: boolean): string => {
    if (unlimited) return 'text-muted-foreground'
    if (percent >= 90) return 'text-red-500'
    if (percent >= 70) return 'text-yellow-500'
    return 'text-blue-500'
  }

  /** Usage stat cards for the second StatCards row */
  const usageCards: StatCardData[] = usage
    ? [
        {
          title: 'Emails',
          icon: <Mail className='size-4' />,
          body: usage.metrics[0].unlimited
            ? usage.metrics[0].current
            : `${usage.metrics[0].current} / ${usage.metrics[0].hardLimit}`,
          description: (
            <span
              className={getUsageColor(usage.metrics[0].percentUsed, usage.metrics[0].unlimited)}>
              {usage.metrics[0].unlimited ? 'Unlimited' : `${usage.metrics[0].percentUsed}%`}
            </span>
          ),
          color: 'text-blue-500',
        },
        {
          title: 'Workflows',
          icon: <Workflow className='size-4' />,
          body: usage.metrics[1].unlimited
            ? usage.metrics[1].current
            : `${usage.metrics[1].current} / ${usage.metrics[1].hardLimit}`,
          description: (
            <span
              className={getUsageColor(usage.metrics[1].percentUsed, usage.metrics[1].unlimited)}>
              {usage.metrics[1].unlimited ? 'Unlimited' : `${usage.metrics[1].percentUsed}%`}
            </span>
          ),
          color: 'text-blue-500',
        },
        {
          title: 'AI Completions',
          icon: <Bot className='size-4' />,
          body: usage.metrics[2].unlimited
            ? usage.metrics[2].current
            : `${usage.metrics[2].current} / ${usage.metrics[2].hardLimit}`,
          description: (
            <span
              className={getUsageColor(usage.metrics[2].percentUsed, usage.metrics[2].unlimited)}>
              {usage.metrics[2].unlimited ? 'Unlimited' : `${usage.metrics[2].percentUsed}%`}
            </span>
          ),
          color: 'text-blue-500',
        },
        {
          title: 'API Calls',
          icon: <Code className='size-4' />,
          body: usage.metrics[3].unlimited
            ? usage.metrics[3].current
            : `${usage.metrics[3].current} / ${usage.metrics[3].hardLimit}`,
          description: (
            <span
              className={getUsageColor(usage.metrics[3].percentUsed, usage.metrics[3].unlimited)}>
              {usage.metrics[3].unlimited ? 'Unlimited' : `${usage.metrics[3].percentUsed}%`}
            </span>
          ),
          color: 'text-blue-500',
        },
        {
          title: 'Storage',
          icon: <HardDrive className='size-4' />,
          body: usage.storage.limitGb
            ? `${usage.storage.currentGb} / ${usage.storage.limitGb} GB`
            : `${usage.storage.currentGb} GB`,
          description: (
            <span className={getUsageColor(usage.storage.percentUsed, !usage.storage.limitGb)}>
              {usage.storage.limitGb ? `${usage.storage.percentUsed}%` : 'Unlimited'}
            </span>
          ),
          color: 'text-blue-500',
        },
      ]
    : []

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <Button
              variant='destructive'
              size='sm'
              onClick={handleDelete}
              loading={deleteOrg.isPending}>
              <Trash2 />
              Delete Organization
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Organizations' href='/admin/organizations' />
            <MainPageBreadcrumbItem
              title={org.name || org.handle || 'Organization'}
              href={`/admin/organizations/${id}`}
              last
            />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          {/* Organization Details */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className='flex-1 flex flex-col min-h-0'>
            <TabsList className='border-b w-full justify-start rounded-b-none bg-primary-150'>
              <TabsTrigger value='overview' variant='outline'>
                <LayoutDashboard />
                Overview
              </TabsTrigger>
              <TabsTrigger value='features' variant='outline'>
                <Sliders />
                Features
              </TabsTrigger>
              <TabsTrigger value='billing' variant='outline'>
                <CreditCard />
                Billing Actions
              </TabsTrigger>
              <div className='ml-auto pe-2'>
                <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={seedOrganization.isPending}
                      loading={seedOrganization.isPending}
                      loadingText='Seeding...'>
                      <Database />
                      Seed Data
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Database />
                        Reset and Seed
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {seedScenarios.map((s) => (
                          <DropdownMenuItem
                            key={s.value}
                            onClick={() => handleResetAndSeed(s.value)}>
                            {s.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Plus />
                        Add Seed Data
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {seedScenarios.map((s) => (
                          <DropdownMenuItem
                            key={s.value}
                            onClick={() => handleAddSeedData(s.value)}>
                            {s.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TabsList>

            {/* Metrics */}
            <StatCards
              cards={metricCards}
              columns={{
                default: 'grid-cols-4',
                md: 'md:grid-cols-7',
              }}
            />

            {/* Usage Metrics */}
            <StatCards
              cards={usageCards}
              loading={!usage}
              columns={{
                default: 'grid-cols-3',
                md: 'md:grid-cols-5',
              }}
            />

            {/* Overview Tab */}
            <TabsContent value='overview' className=' flex-1 flex flex-col min-h-0 overflow-y-auto'>
              <div className='grid md:grid-cols-2'>
                {/* Actions */}

                {/* Overview */}
                <Card className='border-none rounded-none shadow-none'>
                  <CardHeader>
                    <CardTitle>Overview</CardTitle>
                    <CardDescription>Basic organization information</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className='overflow-hidden rounded-md border bg-background'>
                      <Table>
                        <TableBody>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>ID</TableCell>
                            <TableCell className='py-2 font-mono text-sm'>{org.id}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Name</TableCell>
                            <TableCell className='py-2 font-medium'>{org.name || '-'}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Handle</TableCell>
                            <TableCell className='py-2'>{org.handle || '-'}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Type</TableCell>
                            <TableCell className='py-2'>
                              <Badge variant='outline' className='uppercase text-xs'>
                                {org.type}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Website</TableCell>
                            <TableCell className='py-2'>
                              {org.website ? (
                                <a
                                  href={org.website}
                                  target='_blank'
                                  rel='noopener noreferrer'
                                  className='text-blue-600 hover:underline'>
                                  {org.website}
                                </a>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Created</TableCell>
                            <TableCell className='py-2'>{format(org.createdAt, 'PPP p')}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Updated</TableCell>
                            <TableCell className='py-2'>{format(org.updatedAt, 'PPP p')}</TableCell>
                          </TableRow>
                          <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                            <TableCell className='bg-muted/50 py-2 font-medium'>Cache</TableCell>
                            <TableCell className='py-2'>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => flushCache.mutate({ organizationId: org.id })}
                                loading={flushCache.isPending}
                                loadingText='Flushing...'>
                                <RefreshCw />
                                Flush Cache
                              </Button>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Subscription */}
                <Card className='border-none rounded-none shadow-none'>
                  <CardHeader>
                    <CardTitle>Subscription</CardTitle>
                    <CardDescription>Billing and plan details</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {org.subscription ? (
                      <div className='overflow-hidden rounded-md border bg-background'>
                        <Table>
                          <TableBody>
                            <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                              <TableCell className='bg-muted/50 py-2 font-medium'>Plan</TableCell>
                              <TableCell className='py-2'>
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
                            <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                              <TableCell className='bg-muted/50 py-2 font-medium'>
                                Billing Cycle
                              </TableCell>
                              <TableCell className='py-2'>
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
                                    <SelectItem value='MONTHLY'>Monthly</SelectItem>
                                    <SelectItem value='ANNUAL'>Annual</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                            <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                              <TableCell className='bg-muted/50 py-2 font-medium'>Status</TableCell>
                              <TableCell className='py-2'>
                                <Badge
                                  variant={
                                    org.subscription.status === 'ACTIVE' ? 'default' : 'outline'
                                  }
                                  className='uppercase text-xs'>
                                  {org.subscription.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                            <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                              <TableCell className='bg-muted/50 py-2 font-medium'>Seats</TableCell>
                              <TableCell className='py-2'>{org.subscription.seats}</TableCell>
                            </TableRow>
                            <TableRow className='*:border-border hover:bg-transparent [&>:not(:last-child)]:border-r'>
                              <TableCell className='bg-muted/50 py-2 font-medium'>
                                Credits Balance
                              </TableCell>
                              <TableCell className='py-2 font-mono'>
                                {org.subscription.creditsBalance}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className='text-muted-foreground'>
                        No subscription.{' '}
                        <button
                          type='button'
                          className='text-primary underline underline-offset-4 hover:text-primary/80'
                          onClick={() => setActiveTab('billing')}>
                          Create one
                        </button>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Separator />
                {/* Members */}
              </div>
              <MembersSection organizationId={org.id} />
            </TabsContent>

            {/* Features Tab */}
            <TabsContent value='features' className='flex-1 flex flex-col min-h-0 overflow-y-auto'>
              <OrgFeaturesTab
                organizationId={org.id}
                currentPlan={org.subscription?.plan ?? null}
              />
            </TabsContent>

            {/* Billing Actions Tab */}
            <TabsContent
              value='billing'
              className='space-y-4 flex-1 flex flex-col min-h-0 overflow-y-auto p-4'>
              {/* Trial & Access Management - Side by Side */}
              <div className='grid gap-4 md:grid-cols-2'>
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
              <div className='grid gap-4 md:grid-cols-2'>
                <SubscriptionManagementSection
                  organizationId={org.id}
                  organizationName={org.name}
                  subscription={
                    org.subscription
                      ? {
                          id: org.subscription.id,
                          status: org.subscription.status,
                          plan: org.subscription.plan,
                          canceledAt: org.subscription.canceledAt,
                          cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
                          periodEnd: org.subscription.periodEnd,
                          creditsBalance: org.subscription.creditsBalance,
                        }
                      : null
                  }
                />

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
