// apps/web/src/app/admin/organizations/[id]/_components/enterprise-management-section.tsx
'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Label } from '@auxx/ui/components/label'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Badge } from '@auxx/ui/components/badge'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { Crown, Settings } from 'lucide-react'
import { FeatureLimitsConfigurator } from './feature-limits-configurator'

interface EnterpriseManagementSectionProps {
  organizationId: string
  organizationName: string | null
  subscription: {
    plan: string
  } | null
}

/**
 * Enterprise management section for admin billing actions
 */
export function EnterpriseManagementSection({
  organizationId,
  organizationName,
  subscription,
}: EnterpriseManagementSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [copyLimits, setCopyLimits] = useState(true)
  const utils = api.useUtils()

  const setEnterprise = api.admin.billing.setEnterprisePlan.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to set Enterprise plan', description: error.message }),
  })

  /**
   * Handle set to Enterprise plan
   */
  const handleSetEnterprise = async () => {
    const confirmed = await confirm({
      title: 'Set to Enterprise Plan?',
      description: copyLimits
        ? `Organization "${organizationName}" will be upgraded to Enterprise with their current limits preserved as custom overrides.`
        : `Organization "${organizationName}" will be upgraded to Enterprise with unlimited defaults.`,
      confirmText: 'Set Enterprise',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      setEnterprise.mutate({
        organizationId,
        copyCurrentLimits: copyLimits,
      })
    }
  }

  const isEnterprise = subscription?.plan === 'Enterprise'

  return (
    <>
      <ConfirmDialog />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Crown className="size-5 text-amber-500" />
                Enterprise Plan Management
              </CardTitle>
              <CardDescription>
                Configure custom pricing and feature limits for Enterprise customers
              </CardDescription>
            </div>
            {isEnterprise && (
              <Badge variant="default" className="bg-amber-500">
                <Crown className="size-3" />
                Enterprise
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isEnterprise ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg border bg-muted/50">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">Current Plan</div>
                    <div className="text-2xl font-bold">{subscription?.plan || 'Unknown'}</div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Upgrade this organization to Enterprise to enable custom pricing and feature
                    limits
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium mb-2">Upgrade Options</h4>
                  <div className="flex items-start space-x-3 p-3 rounded-lg border">
                    <Checkbox
                      id="copy-limits"
                      checked={copyLimits}
                      onCheckedChange={(checked) => setCopyLimits(checked === true)}
                    />
                    <div className="space-y-1 flex-1">
                      <Label htmlFor="copy-limits" className="font-normal cursor-pointer">
                        Copy current plan limits as custom overrides
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        This will preserve their current feature limits. Uncheck to start with
                        unlimited defaults.
                      </p>
                    </div>
                  </div>
                </div>

                <Button onClick={handleSetEnterprise} loading={setEnterprise.isPending}>
                  <Crown />
                  Set to Enterprise Plan
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                <div className="flex items-start gap-3">
                  <Crown className="size-5 text-amber-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium text-amber-500 mb-1">Enterprise Plan Active</div>
                    <p className="text-sm text-muted-foreground">
                      This organization is on the Enterprise plan with custom configuration
                      capabilities.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-4">
                  <Settings className="size-4" />
                  <h4 className="text-sm font-medium">Custom Feature Limits</h4>
                </div>
                <FeatureLimitsConfigurator organizationId={organizationId} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
