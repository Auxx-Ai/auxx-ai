// app/(protected)/app/settings/plans/_components/plan-change-summary.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CountrySelect } from '@auxx/ui/components/country-select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { InputGroup } from '@auxx/ui/components/input-group'
import { NumberInput, NumberInputArrows, NumberInputField } from '@auxx/ui/components/input-number'
import { Label } from '@auxx/ui/components/label'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { Building2, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useAnalytics } from '~/hooks/use-analytics'
import { getStripePromise } from '~/lib/stripe'
import { useDehydratedSubscription } from '~/providers/dehydrated-state-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { type Plan, PlanComparison } from './plan-comparison'

/** Initialize Stripe */
const stripePromise = getStripePromise()

/** Billing address form data type */
type BillingAddressFormData = {
  email: string
  companyName: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

/** Props for PlanChangeSummary dialog */
interface PlanChangeSummaryProps {
  /** Controls whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Initial plan to display (optional) */
  initialPlan?: Plan | null
}

/**
 * Dialog for changing subscription plan with billing and payment information
 * Shows plan selection, billing period, seats, billing info, payment, and cost summary
 */
export function PlanChangeSummary({ open, onOpenChange, initialPlan }: PlanChangeSummaryProps) {
  const [view, setView] = useState<'summary' | 'plan-selection'>('summary')
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(initialPlan || null)
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY')
  const [seats, setSeats] = useState(1)

  // Shopify is monthly-only; default a missing capability to `true` (Stripe/unknown). Plan 15.
  const annualBillingCycle = useDehydratedSubscription()?.capabilities.annualBillingCycle ?? true

  const { data: subscription } = api.billing.getCurrentSubscription.useQuery(undefined, {
    enabled: open,
  })
  const { data: billingDetails } = api.billing.getBillingDetails.useQuery(undefined, {
    enabled: open,
  })
  const { data: plans } = api.billing.getPlans.useQuery(undefined, {
    enabled: open,
  })
  const { data: paymentMethods } = api.billing.getPaymentMethods.useQuery(undefined, {
    enabled: open,
  })

  // Set initial plan, billing cycle, and seats from current subscription
  useEffect(() => {
    if (subscription && plans) {
      // Always update billing cycle and seats from subscription to prevent race conditions.
      // Monthly-only providers (Shopify) hard-pin MONTHLY so a stale ANNUAL row can't leak in.
      setBillingCycle(annualBillingCycle ? subscription.billingCycle || 'MONTHLY' : 'MONTHLY')
      setSeats(subscription.seats || 1)

      // Only set plan if not already selected
      if (!selectedPlan) {
        const currentPlan = plans.find((p) => p.id === subscription.planId)
        if (currentPlan) {
          setSelectedPlan(currentPlan as Plan)
        }
      }
    }
  }, [subscription, plans, selectedPlan, annualBillingCycle])

  /** Handle plan selection from PlanComparison */
  const handlePlanSelect = (plan: Plan) => {
    setSelectedPlan(plan)
    setView('summary')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='3xl' className='max-h-screen overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            <div className='flex flex-row gap-1 items-center'>
              {view === 'plan-selection' && (
                <Button variant='ghost' size='sm' onClick={() => setView('summary')} className=''>
                  Back
                </Button>
              )}
              <span>{view === 'summary' ? 'Change Summary' : 'Choose Your Plan'}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        {view === 'plan-selection' ? (
          <PlanComparison inDialog onPlanSelect={handlePlanSelect} />
        ) : (
          <Elements stripe={stripePromise}>
            <PlanChangeSummaryContent
              selectedPlan={selectedPlan}
              currentSubscription={subscription}
              billingDetails={billingDetails}
              paymentMethods={paymentMethods}
              billingCycle={billingCycle}
              setBillingCycle={setBillingCycle}
              seats={seats}
              setSeats={setSeats}
              onChangePlan={() => setView('plan-selection')}
              onClose={() => onOpenChange(false)}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Props for PlanChangeSummaryContent */
interface PlanChangeSummaryContentProps {
  selectedPlan: Plan | null
  currentSubscription: any
  billingDetails: any
  paymentMethods: RouterOutputs['billing']['getPaymentMethods'] | undefined
  billingCycle: 'MONTHLY' | 'ANNUAL'
  setBillingCycle: (cycle: 'MONTHLY' | 'ANNUAL') => void
  seats: number
  setSeats: (seats: number) => void
  onChangePlan: () => void
  onClose: () => void
}

/**
 * Main content of the plan change summary dialog
 * Wrapped in Stripe Elements provider
 */
function PlanChangeSummaryContent({
  selectedPlan,
  currentSubscription,
  billingDetails,
  paymentMethods,
  billingCycle,
  setBillingCycle,
  seats,
  setSeats,
  onChangePlan,
  onClose,
}: PlanChangeSummaryContentProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const stripe = useStripe()
  const elements = useElements()

  // Shopify is monthly-only; default a missing capability to `true` (Stripe/unknown). Plan 15.
  const annualBillingCycle = useDehydratedSubscription()?.capabilities.annualBillingCycle ?? true

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    reset,
  } = useForm<BillingAddressFormData>({
    defaultValues: {
      email: billingDetails?.email || '',
      companyName: billingDetails?.companyName || '',
      line1: billingDetails?.address?.line1 || '',
      line2: billingDetails?.address?.line2 || '',
      city: billingDetails?.address?.city || '',
      state: billingDetails?.address?.state || '',
      postalCode: billingDetails?.address?.postal_code || '',
      country: billingDetails?.address?.country || '',
    },
  })

  // Calculate preview whenever plan, cycle, or seats change
  const calculatePreview = api.billing.calculateSubscriptionPreview.useMutation()

  // Trigger calculation when dependencies change
  // biome-ignore lint/correctness/useExhaustiveDependencies: calculatePreview.mutate is stable from useMutation
  useEffect(() => {
    if (selectedPlan) {
      calculatePreview.mutate({
        planName: selectedPlan.name,
        billingCycle,
        seats,
      })
    }
  }, [selectedPlan, billingCycle, seats])

  // Update form when billing details load
  useEffect(() => {
    if (billingDetails) {
      reset({
        email: billingDetails.email || '',
        companyName: billingDetails.companyName || '',
        line1: billingDetails.address?.line1 || '',
        line2: billingDetails.address?.line2 || '',
        city: billingDetails.address?.city || '',
        state: billingDetails.address?.state || '',
        postalCode: billingDetails.address?.postal_code || '',
        country: billingDetails.address?.country || '',
      })
    }
  }, [billingDetails, reset])

  const updateSubscriptionDirect = api.billing.updateSubscriptionDirect.useMutation({
    onSuccess: () => {
      utils.billing.getCurrentSubscription.invalidate()
      onClose()
      // Soft refresh to pick up server-side subscription changes
      router.refresh()
    },
    onError: (error) => {
      toastError({
        title: 'Error updating subscription',
        description: error.message,
      })
    },
  })
  const upgradeSubscription = api.billing.upgradeSubscription.useMutation({
    onError: (error) => {
      toastError({
        title: 'Error starting upgrade',
        description: error.message,
      })
    },
  })
  const updateBillingAddress = api.billing.updateBillingAddress.useMutation()
  const createSetupIntent = api.billing.createSetupIntent.useMutation()
  const hasManuallySelectedPayment = useRef(false)
  const [useExistingPaymentMethod, setUseExistingPaymentMethod] = useState(false)

  const defaultPaymentMethod = useMemo(() => {
    if (!paymentMethods || paymentMethods.length === 0) {
      return null
    }

    const explicitDefault = paymentMethods.find((pm) => pm.isDefault)
    return explicitDefault || paymentMethods[0]!
  }, [paymentMethods])

  const shouldCollectNewPaymentMethod = !defaultPaymentMethod || !useExistingPaymentMethod

  useEffect(() => {
    if (!defaultPaymentMethod) {
      setUseExistingPaymentMethod(false)
      return
    }

    if (!hasManuallySelectedPayment.current) {
      setUseExistingPaymentMethod(true)
    }
  }, [defaultPaymentMethod])

  const isShopify = currentSubscription?.billingProvider === 'shopify'

  /** Handle form submission */
  const onSubmit = async (data: BillingAddressFormData) => {
    // Shopify orgs skip the Stripe-only payment collection — the merchant
    // approves the new AppSubscription on Shopify's hosted confirmation page.
    if (isShopify) {
      if (!selectedPlan) return
      posthog?.capture('plan_change_initiated', {
        from_plan: currentSubscription?.plan?.name ?? 'none',
        to_plan: selectedPlan.name,
        provider: 'shopify',
      })
      try {
        const result = await upgradeSubscription.mutateAsync({
          planName: selectedPlan.name,
          billingCycle,
          seats,
          successUrl: `${window.location.origin}/billing/subscription/activated`,
          cancelUrl: window.location.href,
        })
        if (result.url) window.location.assign(result.url)
      } catch {
        // toast handled by mutation onError
      }
      return
    }

    if (!stripe || !elements) {
      toastError({ title: 'Error', description: 'Payment system not ready' })
      return
    }

    posthog?.capture('plan_change_initiated', {
      from_plan: currentSubscription?.plan?.name ?? 'none',
      to_plan: selectedPlan?.name ?? 'unknown',
    })

    try {
      // 1. Update billing address
      await updateBillingAddress.mutateAsync({
        email: data.email,
        companyName: data.companyName,
        address: {
          line1: data.line1,
          line2: data.line2 || null,
          city: data.city,
          state: data.state || null,
          postalCode: data.postalCode,
          country: data.country,
        },
      })

      let paymentMethodId = defaultPaymentMethod?.id as string | undefined
      const previousPaymentMethodId = defaultPaymentMethod?.id as string | undefined

      if (shouldCollectNewPaymentMethod) {
        const { clientSecret } = await createSetupIntent.mutateAsync()

        if (!clientSecret) {
          throw new Error('Unable to initialize payment method setup')
        }

        const cardElement = elements.getElement(CardElement)
        if (!cardElement) {
          throw new Error('Card element not found')
        }

        const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: data.companyName || data.email,
              email: data.email,
              address: {
                line1: data.line1,
                line2: data.line2 || undefined,
                city: data.city,
                state: data.state || undefined,
                postal_code: data.postalCode,
                country: data.country,
              },
            },
          },
        })

        if (error) {
          toastError({
            title: 'Error setting up payment method',
            description: error.message || 'An error occurred',
          })
          return
        }

        paymentMethodId = setupIntent?.payment_method as string | undefined
      }

      if (!paymentMethodId) {
        throw new Error('Payment method could not be determined')
      }

      await updateSubscriptionDirect.mutateAsync({
        planName: selectedPlan!.name,
        billingCycle,
        seats,
        paymentMethodId,
        previousPaymentMethodId: shouldCollectNewPaymentMethod
          ? previousPaymentMethodId
          : undefined,
      })
    } catch (error: any) {
      toastError({
        title: 'Error processing request',
        description: error.message || 'An unexpected error occurred',
      })
    }
  }

  if (!selectedPlan) {
    return (
      <div className='text-center py-8 text-muted-foreground'>Please select a plan to continue</div>
    )
  }

  // Get preview data from backend calculation
  const preview = calculatePreview.data
  const isLoadingPreview = calculatePreview.isPending

  // Calculate pricing for display - always use the actual price, not calculated monthly equivalent
  const monthlyPrice = selectedPlan.monthlyPrice
  const annualPrice = selectedPlan.annualPrice
  const selectedPrice = billingCycle === 'MONTHLY' ? monthlyPrice : annualPrice

  // For display in RadioTab - show actual monthly rate vs annual total/12
  const monthlyPricePerMonth = monthlyPrice / 100
  const annualPricePerMonth = annualPrice / 12 / 100

  // Use backend calculations if available, otherwise fallback to local
  const subtotal = preview ? preview.renewal.subtotal / 100 : (selectedPrice * seats) / 100
  const tax = preview ? preview.renewal.tax / 100 : 0
  const total = preview ? preview.renewal.total / 100 : subtotal + tax
  const adjustmentDueToday = preview?.proration?.amount || 0

  // Derive the action from a synchronous plan-hierarchy comparison rather than the async
  // preview's `transition`. `calculatePreview` is a mutation, so its `.data` clears while a
  // new preview is in flight — driving the title off it made the header flicker through
  // "Continue with …" on every seat change. Hierarchy is known instantly and never flickers.
  const currentPlanLevel = currentSubscription?.plan?.hierarchyLevel ?? -1
  const isUpgrade = currentPlanLevel !== -1 && selectedPlan.hierarchyLevel > currentPlanLevel
  const isDowngrade = currentPlanLevel !== -1 && selectedPlan.hierarchyLevel < currentPlanLevel
  const actionTitle = isUpgrade
    ? `Upgrade to ${selectedPlan.name}`
    : isDowngrade
      ? `Downgrade to ${selectedPlan.name}`
      : `Continue with ${selectedPlan.name}`

  // Annual savings calculation
  const monthlyCost = monthlyPrice * 12
  const annualCost = annualPrice
  const annualSavings = monthlyCost - annualCost
  const savingsPercentage = monthlyCost > 0 ? Math.round((annualSavings / monthlyCost) * 100) : 0

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className='grid grid-cols-1 sm:grid-cols-3 gap-6'>
        {/* Column 1: Main Content (2/3 width) */}
        <div className='sm:col-span-2 space-y-4'>
          {/* Plan Selection Card */}
          <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
            <div className='flex flex-row items-center gap-2'>
              <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                <Building2 className='size-4' />
              </div>
              <div className='flex flex-col'>
                <span className='text-sm font-medium'>{actionTitle}</span>
                <span className='text-xs text-muted-foreground'>{selectedPlan.description}</span>
              </div>
            </div>
            <Button type='button' variant='link' size='sm' onClick={onChangePlan}>
              Change plan
            </Button>
          </div>

          {/* Current subscription info */}
          {currentSubscription && (
            <Alert className='p-3' variant='default'>
              <AlertDescription className='text-xs'>
                <div className='space-y-1'>
                  <div>
                    Current: {currentSubscription.seats} seat(s) on{' '}
                    {currentSubscription.plan?.name || 'N/A'}
                  </div>
                  <div>Billing cycle: {currentSubscription.billingCycle}</div>
                  {currentSubscription.endDate && (
                    <div>
                      Next renewal: {new Date(currentSubscription.endDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Billing Period */}
          <div className='space-y-2'>
            <Label>Billing period</Label>
            {annualBillingCycle ? (
              <div className='relative w-full'>
                <RadioTab
                  className='w-full'
                  radioGroupClassName='w-full '
                  value={billingCycle}
                  onValueChange={(v) => setBillingCycle(v as any)}>
                  <RadioTabItem value='MONTHLY'>
                    <span className='hidden sm:inline'>
                      Monthly (${monthlyPricePerMonth.toFixed(0)} / user / month)
                    </span>
                    <span className='sm:hidden'>Monthly ${monthlyPricePerMonth.toFixed(0)}/mo</span>
                  </RadioTabItem>
                  <RadioTabItem value='ANNUAL'>
                    <div className='flex items-center gap-2'>
                      <span className='hidden sm:inline'>
                        Annually (${annualPricePerMonth.toFixed(0)} / user / month)
                      </span>
                      <span className='sm:hidden'>Annual ${annualPricePerMonth.toFixed(0)}/mo</span>
                      {savingsPercentage > 0 && (
                        <Badge size='xs' variant='blue' className='absolute -right-4 -top-4'>
                          {savingsPercentage}% off
                        </Badge>
                      )}
                    </div>
                  </RadioTabItem>
                </RadioTab>
              </div>
            ) : (
              <div className='rounded-2xl border py-2 px-3'>
                <div className='text-sm font-medium'>Billed monthly</div>
                <div className='text-xs text-muted-foreground'>
                  Annual billing isn't available on Shopify plans
                </div>
              </div>
            )}
          </div>

          {/* Seats Card */}
          <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
            <div className='flex flex-row items-center gap-2'>
              <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                <Users className='size-4' />
              </div>
              <div className='flex flex-col'>
                <span className='text-sm font-medium'>Seats</span>
                <span className='text-xs text-muted-foreground'>
                  Purchase additional seats to add more users
                </span>
              </div>
            </div>
            <NumberInput
              value={seats}
              onValueChange={(v) => setSeats(Math.max(selectedPlan.minSeats ?? 1, v ?? 1))}
              min={selectedPlan.minSeats}
              max={selectedPlan.maxSeats}
              step={1}>
              <InputGroup className='w-32'>
                <NumberInputField id='seats' />
                <NumberInputArrows />
              </InputGroup>
            </NumberInput>
          </div>

          {/* Billing Information — hidden for providers that don't manage card-on-file. */}
          {!isShopify && (
            <div className='space-y-3'>
              <Label>Billing information</Label>
              <div className='space-y-3'>
                <div className='grid sm:grid-cols-2 gap-3'>
                  <div>
                    <Input
                      {...register('email', { required: 'Email is required' })}
                      placeholder='Email'
                      type='email'
                    />
                    {errors.email && (
                      <p className='text-xs text-destructive mt-1'>{errors.email.message}</p>
                    )}
                  </div>
                  <div>
                    <Input {...register('companyName')} placeholder='Company' />
                  </div>
                </div>

                <Input
                  {...register('line1', { required: 'Address is required' })}
                  placeholder='Address Line 1'
                />
                {errors.line1 && (
                  <p className='text-xs text-destructive mt-1'>{errors.line1.message}</p>
                )}

                <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
                  <div>
                    <Input
                      {...register('city', { required: 'City is required' })}
                      placeholder='City'
                    />
                    {errors.city && (
                      <p className='text-xs text-destructive mt-1'>{errors.city.message}</p>
                    )}
                  </div>
                  <div>
                    <Input {...register('state')} placeholder='State' />
                  </div>
                  <div>
                    <Input
                      {...register('postalCode', { required: 'Postal code is required' })}
                      placeholder='Postal Code'
                    />
                    {errors.postalCode && (
                      <p className='text-xs text-destructive mt-1'>{errors.postalCode.message}</p>
                    )}
                  </div>
                </div>

                <Controller
                  name='country'
                  control={control}
                  rules={{ required: 'Country is required' }}
                  render={({ field }) => (
                    <CountrySelect value={field.value} onChange={field.onChange} />
                  )}
                />
                {errors.country && (
                  <p className='text-xs text-destructive mt-1'>{errors.country.message}</p>
                )}
              </div>
            </div>
          )}

          {/* Payment Information — hidden for providers that don't manage card-on-file. */}
          {!isShopify && (
            <div className='space-y-3'>
              <Label>Payment information</Label>
              {defaultPaymentMethod ? (
                <div className='flex items-center justify-between rounded-lg border p-3'>
                  <div>
                    <p className='text-sm font-medium'>
                      {defaultPaymentMethod.brand} •••• {defaultPaymentMethod.last4}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      Expires {defaultPaymentMethod.expMonth}/{defaultPaymentMethod.expYear}
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      hasManuallySelectedPayment.current = true
                      setUseExistingPaymentMethod((prev) => !prev)
                    }}>
                    {useExistingPaymentMethod ? 'Use a different card' : 'Use saved card'}
                  </Button>
                </div>
              ) : null}

              {shouldCollectNewPaymentMethod ? (
                <div className='p-3 border rounded-lg'>
                  <CardElement
                    options={{
                      style: {
                        base: {
                          fontSize: '14px',
                          color: 'hsl(var(--foreground))',
                          '::placeholder': {
                            color: 'hsl(var(--muted-foreground))',
                          },
                        },
                        invalid: {
                          color: 'hsl(var(--destructive))',
                        },
                      },
                    }}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Column 2: Summary Card (1/3 width) */}
        <div className='sm:col-span-1'>
          <div className='rounded-2xl border p-4 space-y-4 sticky top-4'>
            <div className='space-y-2 text-sm'>
              {/* Seat change indicator */}
              {currentSubscription && seats !== currentSubscription.seats && (
                <div className='flex h-4 items-center justify-between text-xs text-muted-foreground'>
                  <span>Seat change</span>
                  <span>
                    {currentSubscription.seats} → {seats} (
                    {seats > currentSubscription.seats ? '+' : ''}
                    {seats - currentSubscription.seats})
                  </span>
                </div>
              )}

              {/* Line item */}
              <div className='flex min-h-5 items-center justify-between'>
                <span className='text-muted-foreground'>
                  {isLoadingPreview ? (
                    <Skeleton className='h-3.5 w-32' />
                  ) : (
                    <>
                      {seats} seat × {selectedPlan.name}
                    </>
                  )}
                </span>
                {isLoadingPreview ? (
                  <Skeleton className='h-3.5 w-16' />
                ) : (
                  <span className='font-medium'>${subtotal.toFixed(2)}</span>
                )}
              </div>
              <div className='flex min-h-4 items-center text-xs text-muted-foreground'>
                {isLoadingPreview ? (
                  <Skeleton className='h-3 w-24' />
                ) : (
                  <>
                    at ${(selectedPrice / 100).toFixed(2)} /{' '}
                    {billingCycle === 'MONTHLY' ? 'month' : 'year'}
                  </>
                )}
              </div>

              {/* Subtotal */}
              <div className='border-t pt-2 flex items-center justify-between'>
                <span className='text-muted-foreground'>Subtotal</span>
                {isLoadingPreview ? (
                  <Skeleton className='h-3.5 w-16' />
                ) : (
                  <span className='font-medium'>${subtotal.toFixed(2)}</span>
                )}
              </div>

              {/* Tax */}
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>Tax</span>
                {isLoadingPreview ? (
                  <Skeleton className='h-3.5 w-16' />
                ) : (
                  <span className='font-medium'>${tax.toFixed(2)}</span>
                )}
              </div>

              {/* Total at renewal */}
              <div className='border-t pt-2 flex items-center justify-between font-semibold'>
                <span>Total at renewal</span>
                {isLoadingPreview ? (
                  <Skeleton className='h-3.5 w-16' />
                ) : (
                  <span>${total.toFixed(2)}</span>
                )}
              </div>

              {/* Adjustment due today — only providers that can preview proration. */}
              {currentSubscription?.capabilities?.prorationPreview === false ? (
                <div className='text-[10px] text-muted-foreground'>
                  Exact charge amount will be shown on the Shopify approval page.
                </div>
              ) : (
                <>
                  <div className='flex h-4 items-center justify-between text-xs'>
                    <span className='text-muted-foreground'>
                      {preview?.transition === 'seat_addition' && 'Prorated seat addition'}
                      {preview?.transition === 'seat_reduction' && 'Prorated seat reduction'}
                      {preview?.transition === 'trial_to_paid' && 'Due after trial'}
                      {!preview?.transition?.startsWith('seat_') &&
                        preview?.transition !== 'trial_to_paid' &&
                        'Adjustment due today'}
                    </span>
                    {isLoadingPreview ? (
                      <Skeleton className='h-3 w-12' />
                    ) : (
                      <span>${adjustmentDueToday.toFixed(2)}</span>
                    )}
                  </div>

                  {/* Add explanation for seat additions */}
                  {preview?.transition === 'seat_addition' &&
                    adjustmentDueToday > 0 &&
                    currentSubscription && (
                      <div className='text-[10px] text-muted-foreground'>
                        Adding {seats - currentSubscription.seats} seat(s) prorated for remaining
                        billing period
                      </div>
                    )}

                  {/* Add note for trial subscriptions */}
                  {preview?.transition === 'trial_to_paid' && preview?.proration?.note && (
                    <div className='text-[10px] text-muted-foreground'>
                      {preview.proration.note}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Action-specific messaging */}
            {/* A downgrade takes effect at the end of the paid period — that's
                `period_end`, not anything on `renewal`. */}
            {isDowngrade && preview?.period_end && (
              <Alert className='p-2' variant='comparison'>
                <AlertDescription className='text-xs'>
                  Your plan will downgrade to {selectedPlan.name} on{' '}
                  {new Date(preview.period_end).toLocaleDateString()}. You'll retain your current
                  plan access until then. You can cancel this change anytime.
                </AlertDescription>
              </Alert>
            )}

            {isUpgrade &&
              currentSubscription?.billingCycle === 'MONTHLY' &&
              billingCycle === 'ANNUAL' && (
                <Alert className='p-2' variant='comparison'>
                  <AlertDescription className='text-xs'>
                    Switching to annual billing will credit your unused monthly payment toward the
                    annual plan.{' '}
                    {currentSubscription?.status !== 'trialing' &&
                      "You'll be charged the prorated difference today."}
                  </AlertDescription>
                </Alert>
              )}

            <Button
              type='submit'
              className='w-full'
              loading={
                isShopify
                  ? upgradeSubscription.isPending
                  : updateSubscriptionDirect.isPending ||
                    updateBillingAddress.isPending ||
                    (shouldCollectNewPaymentMethod ? createSetupIntent.isPending : false)
              }
              loadingText={isShopify ? 'Redirecting to Shopify...' : 'Processing...'}
              disabled={isLoadingPreview}>
              {isShopify ? 'Approve in Shopify' : 'Confirm'}
            </Button>

            {currentSubscription?.status === 'trialing' && (
              <Alert className='p-2' variant='comparison'>
                <AlertDescription className='text-xs'>
                  Your card will not be charged until the end of your trial on{' '}
                  {new Date(currentSubscription.trialEnd).toLocaleDateString()}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
