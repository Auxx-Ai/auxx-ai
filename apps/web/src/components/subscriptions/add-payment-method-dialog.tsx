// app/(protected)/app/settings/plans/_components/add-payment-method-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError } from '@auxx/ui/components/toast'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useEffect, useState } from 'react'
import { getEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

/** Initialize Stripe */
const stripePromise = loadStripe(getEnv()?.stripe.publishableKey || '')

/** Props for add payment method dialog */
type AddPaymentMethodDialogProps = {
  /** Controls whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog for adding a new payment method using Stripe Elements
 * Uses SetupIntent flow for secure payment method attachment
 */
export function AddPaymentMethodDialog({ open, onOpenChange }: AddPaymentMethodDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md'>
        <DialogHeader>
          <DialogTitle>Add Payment Method</DialogTitle>
          <DialogDescription>Add a new card to your account for billing purposes</DialogDescription>
        </DialogHeader>

        <Elements stripe={stripePromise}>
          <PaymentMethodForm onSuccess={() => onOpenChange(false)} />
        </Elements>
      </DialogContent>
    </Dialog>
  )
}

/** Payment method form component with Stripe Elements */
function PaymentMethodForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const utils = api.useUtils()

  const createSetupIntent = api.billing.createSetupIntent.useMutation({
    onSuccess: (data) => {
      setClientSecret(data.clientSecret || null)
    },
    onError: (error) => {
      toastError({ title: 'Error initializing payment', description: error.message })
    },
  })

  /** Create setup intent when form loads */
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount; createSetupIntent.mutate is stable
  useEffect(() => {
    createSetupIntent.mutate()
  }, [])

  /** Handle form submission */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements || !clientSecret) {
      return
    }

    setIsProcessing(true)

    try {
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) {
        throw new Error('Card element not found')
      }

      const { error } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      })

      if (error) {
        toastError({
          title: 'Error adding payment method',
          description: error.message || 'An error occurred',
        })
      } else {
        // Success - refetch payment methods and close dialog
        await utils.billing.getPaymentMethods.invalidate()
        onSuccess()
      }
    } catch (error: any) {
      toastError({
        title: 'Error adding payment method',
        description: error.message || 'An unexpected error occurred',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div className='space-y-2'>
        <label className='text-sm font-medium'>Card Information</label>
        <div className='p-2 border rounded-lg'>
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '12px',
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
      </div>

      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' size='sm' onClick={onSuccess} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          type='submit'
          variant='outline'
          size='sm'
          loading={isProcessing || createSetupIntent.isPending}
          loadingText='Adding...'
          disabled={!stripe || !clientSecret}>
          Add Payment Method
        </Button>
      </div>
    </form>
  )
}
