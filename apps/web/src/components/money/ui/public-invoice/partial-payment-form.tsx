// apps/web/src/components/money/ui/public-invoice/partial-payment-form.tsx
'use client'

// Custom/partial pay-page amount (money MP2 §C) — rendered by `public-invoice-document.tsx`
// only when `payload.allowPartialPayments` is true. Still a plain `<form method="post">` to the
// same `./checkout` route handler as the full-balance Pay button — zero client payment JS, the
// amount just rides along as a named form field (`amount`, a decimal currency string the route
// converts to integer cents). Client-side range validation only disables the submit button /
// shows a hint; the server re-validates against the same `[min, balance]` bounds and never
// trusts this value past that (see the route's doc comment).

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { useState } from 'react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'

interface PartialPaymentFormProps {
  token: string
  /** Integer cents — the invoice's current balance, also the max payable amount. */
  balance: number
  /** Integer cents — the smallest amount the pay page will accept. */
  minPaymentAmount: number
  currency: string
}

export function PartialPaymentForm({
  token,
  balance,
  minPaymentAmount,
  currency,
}: PartialPaymentFormProps) {
  const [amount, setAmount] = useState(() => (balance / 100).toFixed(2))

  const cents = Math.round(Number(amount) * 100)
  const isValidNumber = amount.trim() !== '' && Number.isFinite(cents)
  const inRange = isValidNumber && cents >= minPaymentAmount && cents <= balance

  return (
    <form method='post' action={`/pay/${token}/checkout`} className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <Input
          type='number'
          name='amount'
          inputMode='decimal'
          step='0.01'
          min={minPaymentAmount / 100}
          max={balance / 100}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          variant='translucent'
          className='w-32'
          aria-label='Payment amount'
        />
        <Button type='submit' variant='translucent' size='lg' disabled={!inRange}>
          Pay {isValidNumber ? formatCurrency(cents, currency) : ''}
        </Button>
      </div>
      {!inRange && (
        <p className='text-white/60 text-xs'>
          Enter an amount between {formatCurrency(minPaymentAmount, currency)} and{' '}
          {formatCurrency(balance, currency)}.
        </p>
      )}
    </form>
  )
}
