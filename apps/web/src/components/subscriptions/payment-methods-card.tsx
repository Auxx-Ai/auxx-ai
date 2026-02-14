// app/(protected)/app/settings/plans/_components/payment-methods-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CreditCard, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { AddPaymentMethodDialog } from './add-payment-method-dialog'

/** Card component displaying payment methods with add/delete functionality */
export function PaymentMethodsCard() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: paymentMethods, isLoading } = api.billing.getPaymentMethods.useQuery()

  const setDefault = api.billing.setDefaultPaymentMethod.useMutation({
    onSuccess: () => {
      utils.billing.getPaymentMethods.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error setting default', description: error.message })
    },
  })

  const deleteMethod = api.billing.deletePaymentMethod.useMutation({
    onSuccess: () => {
      utils.billing.getPaymentMethods.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting payment method', description: error.message })
    },
  })

  /** Get card brand icon */
  const getCardBrand = (brand: string) => {
    const brandMap: Record<string, string> = {
      visa: 'Visa',
      mastercard: 'Mastercard',
      amex: 'American Express',
      discover: 'Discover',
      unknown: 'Card',
    }
    return brandMap[brand.toLowerCase()] || brand
  }

  /** Handle delete payment method */
  const handleDelete = async (paymentMethodId: string) => {
    const confirmed = await confirm({
      title: 'Delete payment method?',
      description: 'This payment method will be permanently removed from your account.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteMethod.mutate({ paymentMethodId })
    }
  }

  return (
    <>
      <div className='rounded-2xl border p-3 space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
              <CreditCard className='size-4' /> Payment
            </div>
            <p className='text-sm text-muted-foreground'>Manage your payment methods</p>
          </div>
          <Button
            variant='outline'
            size='icon-sm'
            className='-mt-7 -mr-2 rounded-full'
            onClick={() => setDialogOpen(true)}
            disabled={isLoading}>
            <Plus />
          </Button>
        </div>

        {isLoading ? (
          <div className='space-y-3'>
            {[1, 2].map((i) => (
              <div key={i} className='flex items-center justify-between rounded-lg border p-3'>
                <div className='flex items-center gap-3'>
                  <Skeleton className='size-10 rounded' />
                  <div className='space-y-2'>
                    <Skeleton className='h-4 w-32' />
                    <Skeleton className='h-3 w-20' />
                  </div>
                </div>
                <Skeleton className='h-8 w-20' />
              </div>
            ))}
          </div>
        ) : paymentMethods && paymentMethods.length > 0 ? (
          <div className='space-y-3'>
            {paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className='flex items-center justify-between rounded-lg border p-3 hover:bg-muted transition-colors'>
                <div className='flex items-center gap-3'>
                  <div className='size-10 rounded bg-muted flex items-center justify-center'>
                    <CreditCard className='size-5 text-muted-foreground' />
                  </div>
                  <div>
                    <div className='flex items-center gap-2'>
                      <span className='text-sm font-medium'>
                        {getCardBrand(pm.brand)} •••• {pm.last4}
                      </span>
                      {pm.isDefault && (
                        <Badge size='xs' variant='secondary'>
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      Expires {pm.expMonth}/{pm.expYear}
                    </p>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  {!pm.isDefault && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setDefault.mutate({ paymentMethodId: pm.id })}
                      disabled={setDefault.isPending}>
                      Set Default
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-8 text-destructive hover:text-destructive'
                    onClick={() => handleDelete(pm.id)}
                    disabled={deleteMethod.isPending}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='text-center py-8 text-sm text-muted-foreground'>
            No payment methods added yet
          </div>
        )}
      </div>

      <AddPaymentMethodDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog />
    </>
  )
}
