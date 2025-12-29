// apps/web/src/app/admin/organizations/[id]/_components/organization-actions-section.tsx
'use client'

import { useState } from 'react'
import { api } from '~/trpc/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ChevronDown, Database, Plus } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

interface OrganizationActionsSectionProps {
  organizationId: string
  organizationName: string | null
}

/**
 * Organization Actions Section Component
 * Provides admin actions for seeding demo data
 */
export function OrganizationActionsSection({
  organizationId,
  organizationName,
}: OrganizationActionsSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

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

  /**
   * Handle Reset and Seed action
   * - Disconnects all webhooks
   * - Deletes all organization data (except billing)
   * - Reseeds with demo data
   * - Reconnects webhooks
   */
  const handleResetAndSeed = async () => {
    const confirmed = await confirm({
      title: 'Reset and Seed Organization?',
      description: `This will delete ALL data for "${organizationName || 'this organization'}" and reseed with demo data. Billing data and subscriptions will be preserved. This action cannot be undone.`,
      confirmText: 'Reset and Seed',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await seedOrganization.mutateAsync({
        organizationId,
        mode: 'reset',
      })
    }

    setIsDropdownOpen(false)
  }

  /**
   * Handle Add Seed Data action
   * - Adds additional demo data without deleting existing data
   * - Preserves all existing data
   */
  const handleAddSeedData = async () => {
    const confirmed = await confirm({
      title: 'Add Seed Data?',
      description: `This will add demo data to "${organizationName || 'this organization'}" without deleting existing data.`,
      confirmText: 'Add Data',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      await seedOrganization.mutateAsync({
        organizationId,
        mode: 'additive',
      })
    }

    setIsDropdownOpen(false)
  }

  return (
    <>
      <ConfirmDialog />
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Administrative actions for managing organization data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={seedOrganization.isPending}
                  loading={seedOrganization.isPending}
                  loadingText="Seeding...">
                  <Database />
                  Seed Data
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={handleResetAndSeed}>
                  <Database />
                  Reset and Seed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleAddSeedData}>
                  <Plus />
                  Add Seed Data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <p className="text-xs text-muted-foreground">
              Seeding operations will temporarily disconnect and reconnect webhooks to prevent stale
              data.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
