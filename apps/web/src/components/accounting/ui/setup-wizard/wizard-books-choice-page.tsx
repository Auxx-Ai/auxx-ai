// apps/web/src/components/accounting/ui/setup-wizard/wizard-books-choice-page.tsx
'use client'

import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { BookOpen, Download } from 'lucide-react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'

/** How the books are kept: imported from the accounting system, or by Auxx on its own. */
export type BooksMode = 'import' | 'standalone'

interface WizardBooksChoicePageProps {
  value: BooksMode | null
  onChange: (value: BooksMode) => void
}

/** The wizard's second page; the choice picks which pages follow. */
export function WizardBooksChoicePage({ value, onChange }: WizardBooksChoicePageProps) {
  const providerStatus = useAccountingProviderStatus()
  const providerLabel = providerStatus.connected ? providerStatus.providerLabel : null

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>How do you want to keep your books?</p>
      <RadioGroup
        value={value ?? ''}
        onValueChange={(next) => onChange(next as BooksMode)}
        className='grid gap-2'>
        <RadioGroupItemCard
          value='import'
          label={`Import from ${providerLabel ?? 'your accounting system'}`}
          icon={<Download />}
          description='We import your chart, opening balances and settings, then ask only what we can’t work out.'
        />
        <RadioGroupItemCard
          value='standalone'
          label='Use Auxx on its own'
          icon={<BookOpen />}
          description='Auxx keeps the books. You set the period, pick account templates and enter opening balances.'
        />
      </RadioGroup>
    </div>
  )
}
