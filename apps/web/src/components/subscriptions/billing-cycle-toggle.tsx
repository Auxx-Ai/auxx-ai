// app/(protected)/app/settings/plans/_components/billing-cycle-toggle.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'

type BillingCycleToggleProps = {
  value: 'MONTHLY' | 'ANNUAL'
  onChange: (value: 'MONTHLY' | 'ANNUAL') => void
}

export function BillingCycleToggle({ value, onChange }: BillingCycleToggleProps) {
  return (
    <div className='flex items-center space-x-4'>
      <Label
        htmlFor='billing-cycle'
        className={`text-sm font-medium ${
          value === 'MONTHLY' ? 'text-foreground' : 'text-muted-foreground'
        }`}>
        Monthly
      </Label>

      <Switch
        id='billing-cycle'
        checked={value === 'ANNUAL'}
        onCheckedChange={(checked) => onChange(checked ? 'ANNUAL' : 'MONTHLY')}
      />

      <div className='flex items-center'>
        <Label
          htmlFor='billing-cycle'
          className={`text-sm font-medium ${
            value === 'ANNUAL' ? 'text-foreground' : 'text-muted-foreground'
          }`}>
          Annual
        </Label>
        <Badge
          variant='outline'
          className='ml-2 bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200'>
          Save 30%
        </Badge>
      </div>
    </div>
  )
}
