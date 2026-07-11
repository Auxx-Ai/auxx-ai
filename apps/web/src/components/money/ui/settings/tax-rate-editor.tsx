// apps/web/src/components/money/ui/settings/tax-rate-editor.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import type { TaxRate } from './tax-rate-types'

interface TaxRateEditorProps {
  taxRate: TaxRate | null
  onUpdate: (patch: Partial<TaxRate>) => void
  onSetDefault: () => void
}

/**
 * Right column of the Tax rates tab: name / rate / is-default for the
 * selected rate. Every edit rewrites the whole `documents.taxRates` array
 * atomically (see `products-services-page.tsx`) — text fields are debounced
 * locally so typing doesn't fire a setting write per keystroke.
 */
export function TaxRateEditor({ taxRate, onUpdate, onSetDefault }: TaxRateEditorProps) {
  if (!taxRate) {
    return <div className='p-4 text-sm text-muted-foreground'>Select a tax rate to edit.</div>
  }

  return (
    <TaxRateEditorForm
      key={taxRate.id}
      taxRate={taxRate}
      onUpdate={onUpdate}
      onSetDefault={onSetDefault}
    />
  )
}

interface TaxRateEditorFormProps {
  taxRate: TaxRate
  onUpdate: (patch: Partial<TaxRate>) => void
  onSetDefault: () => void
}

function TaxRateEditorForm({ taxRate, onUpdate, onSetDefault }: TaxRateEditorFormProps) {
  const [name, setName] = useState(taxRate.name)
  const [rate, setRate] = useState(taxRate.rate)

  const commitName = useDebouncedCallback((value: string) => onUpdate({ name: value }), 500)
  const commitRate = useDebouncedCallback((value: number) => onUpdate({ rate: value }), 500)

  return (
    <div className='p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='tax-rate-form'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            onChange={(value) => {
              setName(value as string)
              commitName(value as string)
            }}
            placeholder='Tax rate name'
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Rate'
          description='Percent applied to taxable lines'
          type={BaseType.NUMBER}
          showIcon
          isRequired>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={rate}
            onChange={(value) => {
              const next = Number(value) || 0
              setRate(next)
              commitRate(next)
            }}
            placeholder='0'
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Default'
          description='Preselected on new quotes and invoices'
          type={BaseType.BOOLEAN}
          showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={!!taxRate.isDefault}
            onChange={(value) => {
              // Set-only toggle: turning it on makes this the default; it can't be unset here.
              if (value) onSetDefault()
            }}
            disabled={taxRate.isDefault}
          />
        </FieldPanelRow>
      </FieldPanel>
    </div>
  )
}
