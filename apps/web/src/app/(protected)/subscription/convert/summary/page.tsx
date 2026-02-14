// apps/web/src/app/(protected)/subscription/convert/summary/page.tsx
'use client'

import { Alert, AlertDescription, AlertIcon, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { Building } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '~/trpc/react'
import { useConvert } from '../_components/convert-provider'

/** Initialize Stripe */
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

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

/** Summary page wrapper with Stripe Elements provider */
export default function SummaryConvertPage() {
  return (
    <Elements stripe={stripePromise}>
      <SummaryContent />
    </Elements>
  )
}

/** Summary page content */
function SummaryContent() {
  const router = useRouter()
  const utils = api.useUtils()
  const { state, resetState } = useConvert()
  const stripe = useStripe()
  const elements = useElements()
  const hasManuallySelectedPayment = useRef(false)
  const [useExistingPaymentMethod, setUseExistingPaymentMethod] = useState(false)

  const { data: billingDetails, isLoading: billingLoading } =
    api.billing.getBillingDetails.useQuery()
  const { data: paymentMethods, isLoading: paymentLoading } =
    api.billing.getPaymentMethods.useQuery()

  const defaultPaymentMethod = useMemo(() => {
    if (!paymentMethods || paymentMethods.length === 0) {
      return null
    }

    const explicitDefault = paymentMethods.find((pm) => pm.isDefault)
    return explicitDefault || paymentMethods[0]!
  }, [paymentMethods])

  const shouldCollectNewPaymentMethod = !defaultPaymentMethod || !useExistingPaymentMethod

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<BillingAddressFormData>({
    defaultValues: {
      email: '',
      companyName: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    },
  })

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

  // Calculate preview whenever plan, cycle, or seats change
  const calculatePreview = api.billing.calculateSubscriptionPreview.useMutation()

  useEffect(() => {
    if (state.selectedPlan) {
      calculatePreview.mutate({
        planName: state.selectedPlan.name,
        billingCycle: state.billingCycle,
        seats: state.addons.seats,
      })
    }
  }, [state.selectedPlan, state.billingCycle, state.addons.seats])

  useEffect(() => {
    if (!defaultPaymentMethod) {
      setUseExistingPaymentMethod(false)
      return
    }

    if (!hasManuallySelectedPayment.current) {
      setUseExistingPaymentMethod(true)
    }
  }, [defaultPaymentMethod])

  const updateSubscriptionDirect = api.billing.updateSubscriptionDirect.useMutation({
    onSuccess: () => {
      // Check if this was a reactivation
      const reactivationOrgId = sessionStorage.getItem('reactivation-organization-id')
      if (reactivationOrgId) {
        // Track reactivation success
        console.log('Reactivation successful for org:', reactivationOrgId)
        sessionStorage.removeItem('reactivation-organization-id')
      }

      utils.billing.getCurrentSubscription.invalidate()
      resetState()
      // Use hard navigation to force full page reload including layouts
      // This ensures the dehydrated state is refreshed from the database
      window.location.href = '/app/settings/plans?upgrade=true'
    },
    onError: (error) => {
      toastError({
        title: 'Error updating subscription',
        description: error.message,
      })
    },
  })

  const updateBillingAddress = api.billing.updateBillingAddress.useMutation()
  const createSetupIntent = api.billing.createSetupIntent.useMutation()

  /** Handle form submission */
  const onSubmit = async (data: BillingAddressFormData) => {
    if (!stripe || !elements) {
      toastError({ title: 'Error', description: 'Payment system not ready' })
      return
    }

    if (!state.selectedPlan) {
      toastError({ title: 'Error', description: 'No plan selected' })
      return
    }

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
        // 2. Create setup intent and confirm card when collecting a fresh payment method
        const { clientSecret } = await createSetupIntent.mutateAsync()

        if (!clientSecret) {
          throw new Error('Unable to initialize payment method setup')
        }

        const cardElement = elements.getElement(CardElement)
        if (!cardElement) {
          throw new Error('Card element not found')
        }

        // 3. Confirm card setup with Stripe
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

      // 4. Update subscription directly with Stripe using the resolved payment method
      await updateSubscriptionDirect.mutateAsync({
        planName: state.selectedPlan.name,
        billingCycle: state.billingCycle,
        seats: state.addons.seats,
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

  if (!state.selectedPlan) {
    return (
      <div className='mx-auto max-w-4xl p-6'>
        <div className='text-center py-8 text-muted-foreground'>
          No plan selected. Please go back and select a plan.
        </div>
      </div>
    )
  }

  const isLoadingData = billingLoading || paymentLoading
  const preview = calculatePreview.data
  const isLoadingPreview = calculatePreview.isPending

  const selectedPrice =
    state.billingCycle === 'MONTHLY'
      ? state.selectedPlan.monthlyPrice
      : state.selectedPlan.annualPrice

  const monthlyPrice =
    (state.billingCycle === 'MONTHLY'
      ? state.selectedPlan.monthlyPrice
      : state.selectedPlan.annualPrice / 12) / 100

  const subtotal = preview
    ? preview.renewal.subtotal / 100
    : (selectedPrice * state.addons.seats) / 100
  const tax = preview ? preview.renewal.tax / 100 : 0
  const total = preview ? preview.renewal.total / 100 : subtotal + tax
  const adjustmentDueToday = preview?.proration?.amount || 0

  const isPending =
    updateBillingAddress.isPending ||
    (shouldCollectNewPaymentMethod ? createSetupIntent.isPending : false) ||
    updateSubscriptionDirect.isPending

  return (
    <div className='mx-auto max-w-4xl p-6'>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className='grid grid-cols-3 gap-6'>
          {/* Main Content */}
          <div className='col-span-2 space-y-4'>
            {/* Plan Summary */}
            {/* <Card className="shadow-md shadow-black/20 border-transparent">
              <CardHeader>
                <CardTitle className="text-lg">{state.selectedPlan.name} Plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Billing cycle</span>
                  <span className="font-medium capitalize">{state.billingCycle.toLowerCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Seats</span>
                  <span className="font-medium">{state.addons.seats}</span>
                </div>
              </CardContent>
            </Card> */}

            {/* Billing Information */}
            <Card className='shadow-md shadow-black/20 border-transparent'>
              <div className='p-3 pb-0'>
                <Alert variant='outline' className='flex items-center gap-3 '>
                  <AlertIcon icon={Building}></AlertIcon>
                  <div className='flex flex-col gap-0'>
                    <AlertTitle className='pb-0 mt-0 mb-0'>
                      {state.selectedPlan.name} Plan
                    </AlertTitle>
                    <AlertDescription>${monthlyPrice.toFixed(2)} per user/month</AlertDescription>
                  </div>
                </Alert>
              </div>
              <CardHeader>
                <CardTitle className='text-lg'>Billing Information</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <Input
                      {...register('email', { required: 'Email is required' })}
                      placeholder='Email'
                      type='email'
                      disabled={isLoadingData}
                    />
                    {errors.email && (
                      <p className='text-xs text-destructive mt-1'>{errors.email.message}</p>
                    )}
                  </div>
                  <div>
                    <Input
                      {...register('companyName')}
                      placeholder='Company'
                      disabled={isLoadingData}
                    />
                  </div>
                </div>

                <Input
                  {...register('line1', { required: 'Address is required' })}
                  placeholder='Address Line 1'
                  disabled={isLoadingData}
                />
                {errors.line1 && (
                  <p className='text-xs text-destructive mt-1'>{errors.line1.message}</p>
                )}

                <div className='grid grid-cols-3 gap-3'>
                  <div>
                    <Input
                      {...register('city', { required: 'City is required' })}
                      placeholder='City'
                      disabled={isLoadingData}
                    />
                    {errors.city && (
                      <p className='text-xs text-destructive mt-1'>{errors.city.message}</p>
                    )}
                  </div>
                  <div>
                    <Input {...register('state')} placeholder='State' disabled={isLoadingData} />
                  </div>
                  <div>
                    <Input
                      {...register('postalCode', { required: 'Postal code is required' })}
                      placeholder='Postal Code'
                      disabled={isLoadingData}
                    />
                    {errors.postalCode && (
                      <p className='text-xs text-destructive mt-1'>{errors.postalCode.message}</p>
                    )}
                  </div>
                </div>

                <Input
                  {...register('country', { required: 'Country is required' })}
                  placeholder='Country'
                  disabled={isLoadingData}
                />
                {errors.country && (
                  <p className='text-xs text-destructive mt-1'>{errors.country.message}</p>
                )}
              </CardContent>
            </Card>

            {/* Payment Information */}
            <Card className='shadow-md shadow-black/20 border-transparent'>
              <CardHeader>
                <CardTitle className='text-lg'>Payment Information</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
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
                  <div className='p-2 border rounded-lg border-primary-200 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400 placeholder:text-primary-500'>
                    <CardElement
                      options={{
                        style: {
                          base: {
                            fontSize: '14px',
                            color: 'hsl(var(--foreground))',
                            '::placeholder': {
                              color: 'hsl(var(--primary-500))',
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
              </CardContent>
            </Card>
            <div className=''>
              <Button variant='outline' asChild>
                <Link href='/subscription/convert/addons'>Back</Link>
              </Button>
            </div>
          </div>

          {/* Summary Sidebar */}
          <div className='col-span-1'>
            <div className='rounded-2xl bg-foreground/5 backdrop-blur-sm ring-1 ring-foreground/10 p-4 space-y-4 sticky top-4'>
              <h3 className='font-semibold'>Summary</h3>
              <div className='space-y-2 text-sm'>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>
                    {isLoadingPreview ? (
                      <Skeleton className='h-[20px] w-32' />
                    ) : (
                      <>
                        {state.addons.seats} seat x {state.selectedPlan.name}
                      </>
                    )}
                  </span>
                  {isLoadingPreview ? (
                    <Skeleton className='h-[20px] w-16' />
                  ) : (
                    <span className='font-medium'>${subtotal.toFixed(2)}</span>
                  )}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {isLoadingPreview ? (
                    <Skeleton className='h-[16px] w-24' />
                  ) : (
                    <>
                      at ${(selectedPrice / 100).toFixed(2)} /{' '}
                      {state.billingCycle === 'MONTHLY' ? 'month' : 'year'}
                    </>
                  )}
                </div>

                <div className='border-t border-black/15 pt-2 flex justify-between'>
                  <span className='text-muted-foreground'>Subtotal</span>
                  {isLoadingPreview ? (
                    <Skeleton className='h-[20px] w-16' />
                  ) : (
                    <span className='font-medium'>${subtotal.toFixed(2)}</span>
                  )}
                </div>

                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Tax</span>
                  {isLoadingPreview ? (
                    <Skeleton className='h-[20px] w-16' />
                  ) : (
                    <span className='font-medium'>${tax.toFixed(2)}</span>
                  )}
                </div>

                <div className='border-t border-black/15 pt-2 flex justify-between font-semibold'>
                  <span>Total</span>
                  {isLoadingPreview ? (
                    <Skeleton className='h-[20px] w-16' />
                  ) : (
                    <span>${total.toFixed(2)}</span>
                  )}
                </div>

                <div className='flex justify-between text-xs'>
                  <span className='text-muted-foreground'>Due today</span>
                  {isLoadingPreview ? (
                    <Skeleton className='h-[16px] w-12' />
                  ) : (
                    <span>${adjustmentDueToday.toFixed(2)}</span>
                  )}
                </div>
              </div>

              <Button
                type='submit'
                className='w-full'
                size='lg'
                loading={isPending}
                loadingText='Processing...'>
                Complete Subscription
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
