// app/(protected)/app/settings/plans/_components/billing-address-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { CountrySelect } from '@auxx/ui/components/country-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { api } from '~/trpc/react'

/** Props for billing address dialog */
type BillingAddressDialogProps = {
  /** Controls whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Existing billing details to pre-fill form */
  billingDetails:
    | {
        email: string | null
        companyName: string | null
        address: {
          line1?: string | null
          line2?: string | null
          city?: string | null
          state?: string | null
          postal_code?: string | null
          country?: string | null
        } | null
      }
    | null
    | undefined
}

/** Form data type for billing address */
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

/**
 * Dialog for editing billing address
 * Saves address to Stripe customer object
 */
export function BillingAddressDialog({
  open,
  onOpenChange,
  billingDetails,
}: BillingAddressDialogProps) {
  const utils = api.useUtils()

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

  const updateAddress = api.billing.updateBillingAddress.useMutation({
    onSuccess: () => {
      utils.billing.getBillingDetails.invalidate()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Error updating address', description: error.message })
    },
  })

  /** Reset form with current billing details when dialog opens */
  useEffect(() => {
    if (open && billingDetails) {
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
  }, [open, billingDetails, reset])

  /** Handle form submission */
  const onSubmit = (data: BillingAddressFormData) => {
    updateAddress.mutate({
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='lg' position='tc'>
        <DialogHeader>
          <DialogTitle>Update Billing Address</DialogTitle>
          <DialogDescription>
            Update your billing information for invoices and receipts
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='email'>
              Billing Email <span className='text-red-500'>*</span>
            </Label>
            <Input
              id='email'
              type='email'
              {...register('email', { required: 'Email is required' })}
              placeholder='billing@company.com'
            />
            {errors.email && <p className='text-sm text-destructive'>{errors.email.message}</p>}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='companyName'>Company Name</Label>
            <Input id='companyName' {...register('companyName')} placeholder='Acme Corporation' />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='line1'>
              Address Line 1 <span className='text-red-500'>*</span>
            </Label>
            <Input
              id='line1'
              {...register('line1', { required: 'Address is required' })}
              placeholder='123 Main Street'
            />
            {errors.line1 && <p className='text-sm text-destructive'>{errors.line1.message}</p>}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='line2'>Address Line 2</Label>
            <Input id='line2' {...register('line2')} placeholder='Suite 100' />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='city'>
                City <span className='text-red-500'>*</span>
              </Label>
              <Input
                id='city'
                {...register('city', { required: 'City is required' })}
                placeholder='San Francisco'
              />
              {errors.city && <p className='text-sm text-destructive'>{errors.city.message}</p>}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='state'>State/Province</Label>
              <Input id='state' {...register('state')} placeholder='CA' />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='postalCode'>
                Postal Code <span className='text-red-500'>*</span>
              </Label>
              <Input
                id='postalCode'
                {...register('postalCode', { required: 'Postal code is required' })}
                placeholder='94102'
              />
              {errors.postalCode && (
                <p className='text-sm text-destructive'>{errors.postalCode.message}</p>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='country'>
                Country <span className='text-red-500'>*</span>
              </Label>
              <Controller
                name='country'
                control={control}
                rules={{ required: 'Country is required' }}
                render={({ field }) => (
                  <CountrySelect value={field.value} onChange={field.onChange} />
                )}
              />
              {errors.country && (
                <p className='text-sm text-destructive'>{errors.country.message}</p>
              )}
            </div>
          </div>

          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => onOpenChange(false)}
              disabled={updateAddress.isPending}>
              Cancel
            </Button>
            <Button
              size='sm'
              variant='outline'
              type='submit'
              loading={updateAddress.isPending}
              loadingText='Saving...'>
              Save Address
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
