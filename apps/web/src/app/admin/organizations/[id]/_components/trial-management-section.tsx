// apps/web/src/app/admin/organizations/[id]/_components/trial-management-section.tsx
'use client'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@auxx/ui/components/accordion'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { addDays, format } from 'date-fns'
import { AlertTriangle, Calendar, CheckCircle, Clock } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** Sentinel for "don't change the plan" — Radix `SelectItem` rejects an empty value. */
const KEEP_CURRENT_PLAN = '__keep_current__'

/**
 * Stripe rejects a `trial_end` under 48 hours out. The floor is 3 days rather than 2 so a
 * value computed at submit time can't land on the wrong side of the boundary; the server
 * validates it again before touching either side.
 */
const MIN_EXTEND_DAYS = 3

interface TrialManagementSectionProps {
  organizationId: string
  organizationName: string | null
  /** `'stripe' | 'shopify'`, or null when the subscription is unlinked. */
  billingProvider: string | null
  shopifyShopDomain: string | null
  subscription: {
    trialEnd: Date | null
    hasTrialEnded: boolean
    status: string
    trialConversionStatus: string | null
  } | null
}

/**
 * Trial management section for admin billing actions
 */
export function TrialManagementSection({
  organizationId,
  organizationName,
  billingProvider,
  shopifyShopDomain,
  subscription,
}: TrialManagementSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [extendDays, setExtendDays] = useState('7')
  const [reason, setReason] = useState('')
  /** `KEEP_CURRENT_PLAN` = convert in place; anything else also moves them to that plan. */
  const [convertPlan, setConvertPlan] = useState(KEEP_CURRENT_PLAN)
  const utils = api.useUtils()

  const plansQuery = api.admin.getPlans.useQuery()

  const endTrial = api.admin.billing.endTrial.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setReason('')
    },
    onError: (error) => toastError({ title: 'Failed to end trial', description: error.message }),
  })

  const extendTrial = api.admin.billing.extendTrial.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
      setExtendDays('7')
      setReason('')
    },
    onError: (error) => toastError({ title: 'Failed to extend trial', description: error.message }),
  })

  const convertTrial = api.admin.billing.convertTrialToPaid.useMutation({
    onSuccess: () => {
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to convert trial', description: error.message }),
  })

  /**
   * Handle end trial immediately
   */
  const handleEndTrial = async () => {
    const confirmed = await confirm({
      title: 'End Trial Immediately?',
      description: `This will immediately end the trial for "${organizationName}". They will need to upgrade to continue using the service. This takes the subscription out of the billing provider's control until you return it.`,
      confirmText: 'End Trial',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      endTrial.mutate({ organizationId, reason: reason || undefined })
    }
  }

  /**
   * Handle extend trial
   */
  const handleExtendTrial = async () => {
    const days = parseInt(extendDays, 10) || 7

    if (days < MIN_EXTEND_DAYS) {
      toastError({
        title: 'Extension too short',
        description: `Stripe requires the new trial end to be at least 48 hours out. Extend by ${MIN_EXTEND_DAYS} days or more.`,
      })
      return
    }

    const newEndDate = addDays(new Date(), days)

    const confirmed = await confirm({
      title: 'Extend Trial Period?',
      description: `This will extend the trial for "${organizationName}" to ${format(newEndDate, 'PPP')}.`,
      confirmText: 'Extend Trial',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      extendTrial.mutate({
        organizationId,
        newEndDate,
        reason: reason || undefined,
      })
    }
  }

  /**
   * Handle convert trial to paid
   */
  const handleConvertToPaid = async () => {
    const planName = convertPlan === KEEP_CURRENT_PLAN ? undefined : convertPlan

    const confirmed = await confirm({
      title: 'Convert Trial to Paid?',
      description: planName
        ? `This will convert "${organizationName}" from trial to paid status on the "${planName}" plan, without requiring payment. The subscription leaves the billing provider's control until you return it.`
        : `This will convert "${organizationName}" from trial to paid status without requiring payment, keeping their current plan. The subscription leaves the billing provider's control until you return it.`,
      confirmText: 'Convert to Paid',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      convertTrial.mutate({
        organizationId,
        planName,
        skipPayment: true,
      })
    }
  }

  // Status is stored lowercase; normalize so a legacy uppercase row still resolves.
  const status = subscription?.status?.toLowerCase() ?? null
  const hasTrialEnded = subscription?.hasTrialEnded ?? false
  const isOnTrial = status === 'trialing' && !hasTrialEnded
  /**
   * Trial ended but the subscription never left `trialing` — the state that locks members
   * out of the app (`isTrialExpired` in app-layout-wrapper). Extend/convert must stay
   * reachable here, or ending a trial early strands the org with no way back.
   */
  const isTrialExpired = status === 'trialing' && hasTrialEnded
  /**
   * Shopify owns the trial outright — trial days come from the plan in the Partner
   * Dashboard, and our provider never issues a billing mutation. Any local edit is
   * reverted within 15 minutes by the Admin API sync, so the actions are hidden rather
   * than shown disabled or left to fail server-side.
   */
  const isShopifyBilled = billingProvider === 'shopify'
  const canManageTrial = (isOnTrial || isTrialExpired) && !isShopifyBilled

  return (
    <>
      <ConfirmDialog />
      <Card>
        <CardHeader>
          <CardTitle>Trial Management</CardTitle>
          <CardDescription>Manage trial period and conversion status</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Current Trial Status */}
          <div className='p-4 rounded-lg border bg-muted/50'>
            <div className='grid grid-cols-3 gap-4'>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>Trial Status</div>
                <div className='flex items-center gap-2'>
                  {isOnTrial ? (
                    <>
                      <Clock className='size-4 text-blue-500' />
                      <span className='font-medium text-blue-500'>Active</span>
                    </>
                  ) : isTrialExpired ? (
                    <>
                      <AlertTriangle className='size-4 text-destructive' />
                      <span className='font-medium text-destructive'>
                        Ended — members locked out
                      </span>
                    </>
                  ) : hasTrialEnded ? (
                    <>
                      <CheckCircle className='size-4 text-green-500' />
                      <span className='font-medium text-green-500'>Ended</span>
                    </>
                  ) : (
                    <span className='font-medium text-muted-foreground'>N/A</span>
                  )}
                </div>
              </div>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>Trial End Date</div>
                <div className='font-medium'>
                  {subscription?.trialEnd ? format(subscription.trialEnd, 'PPP') : '-'}
                </div>
              </div>
              <div>
                <div className='text-sm font-medium text-muted-foreground mb-1'>
                  Conversion Status
                </div>
                <div className='font-medium'>{subscription?.trialConversionStatus || '-'}</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          {canManageTrial ? (
            <Accordion type='single' collapsible className='rounded-lg border'>
              {/* End Trial Immediately */}
              {isOnTrial && (
                <AccordionItem value='end-trial' className='border-b px-4 last:border-b-0'>
                  <AccordionTrigger>End Trial Immediately</AccordionTrigger>
                  <AccordionContent className='space-y-3'>
                    <p className='text-sm text-muted-foreground'>
                      Force trial to end now, requiring organization to upgrade
                    </p>
                    <div>
                      <Label htmlFor='end-reason'>Reason (Optional)</Label>
                      <Textarea
                        id='end-reason'
                        placeholder='Why are you ending this trial early?'
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                      />
                    </div>
                    <Button
                      variant='destructive'
                      size='sm'
                      onClick={handleEndTrial}
                      loading={endTrial.isPending}>
                      End Trial Now
                    </Button>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Extend Trial */}
              <AccordionItem value='extend-trial' className='border-b px-4 last:border-b-0'>
                <AccordionTrigger>Extend Trial Period</AccordionTrigger>
                <AccordionContent className='space-y-3'>
                  <p className='text-sm text-muted-foreground'>
                    {isTrialExpired
                      ? 'Reopen the ended trial — restores access with the trial feature limits'
                      : 'Give customer more time to evaluate the product'}
                  </p>
                  <div>
                    <Label htmlFor='extend-days'>Extend by (days)</Label>
                    <Input
                      id='extend-days'
                      type='number'
                      min={MIN_EXTEND_DAYS}
                      max='365'
                      value={extendDays}
                      onChange={(e) => setExtendDays(e.target.value)}
                      placeholder='7'
                    />
                    <p className='text-xs text-muted-foreground mt-1'>
                      New end date:{' '}
                      {format(addDays(new Date(), parseInt(extendDays, 10) || 7), 'PPP')} — Stripe
                      requires at least 48 hours, so the minimum is {MIN_EXTEND_DAYS} days.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor='extend-reason'>Reason (Optional)</Label>
                    <Textarea
                      id='extend-reason'
                      placeholder='Why are you extending this trial?'
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button onClick={handleExtendTrial} loading={extendTrial.isPending} size='sm'>
                    <Calendar />
                    Extend Trial
                  </Button>
                </AccordionContent>
              </AccordionItem>

              {/* Convert to Paid */}
              <AccordionItem value='convert-paid' className='border-b px-4 last:border-b-0'>
                <AccordionTrigger>Convert Trial to Paid</AccordionTrigger>
                <AccordionContent className='space-y-3'>
                  <p className='text-sm text-muted-foreground'>
                    {isTrialExpired
                      ? 'Restore access on the full plan without payment (admin override)'
                      : 'Manually convert trial to paid without payment (admin override)'}
                  </p>
                  <div>
                    <Label htmlFor='convert-plan'>Plan</Label>
                    <Select value={convertPlan} onValueChange={setConvertPlan}>
                      <SelectTrigger id='convert-plan'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={KEEP_CURRENT_PLAN}>Keep current plan</SelectItem>
                        {plansQuery.data?.map((plan) => (
                          <SelectItem key={plan.id} value={plan.name}>
                            {plan.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className='text-xs text-muted-foreground mt-1'>
                      Picking a plan moves them to it as part of the conversion.
                    </p>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleConvertToPaid}
                    loading={convertTrial.isPending}>
                    <CheckCircle />
                    Convert to Paid
                  </Button>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : isShopifyBilled ? (
            <div className='p-4 rounded-lg border bg-muted/50 space-y-2'>
              <div className='font-medium'>Shopify owns this trial</div>
              <p className='text-sm text-muted-foreground'>
                Trial length is set per plan in the Shopify Partner Dashboard, and the billing sync
                overwrites any local change within 15 minutes. Change the trial on the plan itself,
                or have the merchant manage the subscription in their Shopify Admin.
              </p>
              {shopifyShopDomain && (
                <p className='text-sm text-muted-foreground'>
                  Shop: <span className='font-medium text-foreground'>{shopifyShopDomain}</span>
                </p>
              )}
            </div>
          ) : (
            <div className='text-center py-8 text-muted-foreground'>
              Organization is not currently on trial
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
