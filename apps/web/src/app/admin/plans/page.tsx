// apps/web/src/app/admin/plans/page.tsx
/**
 * Plans list page for admin
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { Label } from '@auxx/ui/components/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { Search, Plus, Archive, ArchiveRestore, Sparkles } from 'lucide-react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { toast } from 'sonner'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
  MainPageSubheader,
} from '@auxx/ui/components/main-page'

/**
 * Plans list page for admin
 */
export default function PlansPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [includeLegacy, setIncludeLegacy] = useState(false)

  const { data: plans, isLoading } = api.admin.plans.getAll.useQuery({
    search: search || undefined,
    includeLegacy,
  })

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const markAsLegacy = api.admin.plans.markAsLegacy.useMutation({
    onSuccess: () => {
      utils.admin.plans.getAll.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to mark plan as legacy',
        description: error.message,
      })
    },
  })

  const restoreLegacy = api.admin.plans.restoreLegacy.useMutation({
    onSuccess: () => {
      utils.admin.plans.getAll.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to restore plan',
        description: error.message,
      })
    },
  })

  const seedInitialPlans = api.admin.plans.seedInitialPlans.useMutation({
    onSuccess: (data) => {
      utils.admin.plans.getAll.invalidate()
      toast.success('Plans seeded successfully', {
        description: data.message,
      })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to seed plans',
        description: error.message,
      })
    },
  })

  /**
   * Handle mark as legacy
   */
  const handleMarkAsLegacy = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: `Mark "${name}" as legacy?`,
      description:
        'This will hide the plan from active lists but preserve existing subscriptions. You can restore it later.',
      confirmText: 'Mark as Legacy',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await markAsLegacy.mutateAsync({ id })
    }
  }

  /**
   * Handle restore legacy
   */
  const handleRestoreLegacy = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: `Restore "${name}"?`,
      description: 'This will make the plan active again and visible in plan lists.',
      confirmText: 'Restore',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      await restoreLegacy.mutateAsync({ id })
    }
  }

  /**
   * Format price in cents to dollars
   */
  const formatPrice = (cents: number) => {
    if (cents === 0) return 'Free'
    return `$${(cents / 100).toFixed(2)}`
  }

  /**
   * Navigate to plan details
   */
  const handleRowClick = (id: string) => {
    router.push(`/admin/plans/${id}`)
  }

  /**
   * Handle seed initial plans
   */
  const handleSeedPlans = async () => {
    const confirmed = await confirm({
      title: 'Seed Initial Plans?',
      description:
        'This will create the default plans (Free, Starter, Growth, Enterprise) and their Stripe resources. Existing plans will be replaced.',
      confirmText: 'Seed Plans',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await seedInitialPlans.mutateAsync()
    }
  }

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeedPlans}
                loading={seedInitialPlans.isPending}
                loadingText="Seeding...">
                <Sparkles />
                Seed Initial Plans
              </Button>
              <Button size="sm" onClick={() => router.push('/admin/plans/new')}>
                <Plus />
                Create Plan
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Plans" href="/admin/plans" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          {/* Search and Filters */}
          <MainPageSubheader>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-1.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search plans..."
                value={search}
                size="sm"
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="include-legacy"
                checked={includeLegacy}
                onCheckedChange={setIncludeLegacy}
              />
              <Label htmlFor="include-legacy" className="text-sm cursor-pointer">
                Show legacy plans
              </Label>
            </div>
          </MainPageSubheader>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Monthly</TableHead>
                  <TableHead>Annual</TableHead>
                  <TableHead>Hierarchy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trial</TableHead>
                  <TableHead>Stripe</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  // Loading skeleton
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-8" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-8 w-16 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : plans && plans.length > 0 ? (
                  plans.map((plan) => (
                    <TableRow key={plan.id} className="hover:bg-muted/50">
                      <TableCell
                        className="font-medium cursor-pointer"
                        onClick={() => handleRowClick(plan.id)}>
                        <div className="flex items-center gap-2">
                          {plan.name}
                          {plan.isMostPopular && (
                            <Badge variant="secondary" className="text-xs">
                              Popular
                            </Badge>
                          )}
                          {plan.isFree && (
                            <Badge variant="outline" className="text-xs">
                              Free
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground max-w-xs truncate cursor-pointer"
                        onClick={() => handleRowClick(plan.id)}>
                        {plan.description}
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => handleRowClick(plan.id)}>
                        {plan.isCustomPricing ? (
                          <span className="text-sm text-muted-foreground">Custom</span>
                        ) : (
                          <span className="text-sm">{formatPrice(plan.monthlyPrice)}</span>
                        )}
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => handleRowClick(plan.id)}>
                        {plan.isCustomPricing ? (
                          <span className="text-sm text-muted-foreground">Custom</span>
                        ) : (
                          <span className="text-sm">{formatPrice(plan.annualPrice)}</span>
                        )}
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => handleRowClick(plan.id)}>
                        <Badge variant="outline">{plan.hierarchyLevel}</Badge>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => handleRowClick(plan.id)}>
                        {plan.isLegacy ? (
                          <Badge variant="secondary">Legacy</Badge>
                        ) : (
                          <Badge variant="default">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => handleRowClick(plan.id)}>
                        {plan.hasTrial ? (
                          <span className="text-sm">{plan.trialDays}d</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => handleRowClick(plan.id)}>
                        {plan.stripeProductId ? (
                          <Badge variant="outline" className="text-xs">
                            Synced
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Local
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground cursor-pointer"
                        onClick={() => handleRowClick(plan.id)}>
                        {formatDistanceToNow(plan.updatedAt, { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {plan.isLegacy ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRestoreLegacy(plan.id, plan.name)}
                            loading={restoreLegacy.isPending}>
                            <ArchiveRestore />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMarkAsLegacy(plan.id, plan.name)}
                            loading={markAsLegacy.isPending}>
                            <Archive />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      {search ? 'No plans found matching your search' : 'No plans'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </MainPageContent>
      </MainPage>
    </>
  )
}
