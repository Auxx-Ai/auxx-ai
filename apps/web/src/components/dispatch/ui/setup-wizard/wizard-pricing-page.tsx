// apps/web/src/components/dispatch/ui/setup-wizard/wizard-pricing-page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { Percent, Plus } from 'lucide-react'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useCatalogItems } from '~/components/money/hooks/use-catalog-items'
import { formatMoney } from '~/components/money/ui/settings/format-money'
import type { TaxRate } from '~/components/money/ui/settings/tax-rate-types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import type { WizardStepHandle } from './wizard-step-handle'

/** Dollars typed by the user → the cents a CURRENCY field value stores. `null` when blank. */
function toCents(input: string): number | null {
  const parsed = Number.parseFloat(input.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

/**
 * Page 5 of `DispatchSetupWizard` — the two pricing prerequisites a quote or invoice needs before
 * it can be built, on one page: a first catalog item (Products & Services) and a default tax rate.
 *
 * They write to two different places, exactly as the Products & Services settings page does:
 * a product is a `catalog_item` record (`record.create`, `catalog_item_name` is the only required
 * value), while tax rates are entries in the `documents.taxRates` org setting — a JSON array whose
 * `isDefault` entry `money/gather.ts` reads for every new line. The first rate added is always the
 * default, matching the settings page's exactly-one-default invariant.
 *
 * Both halves commit on their own "Add" button, so nothing is held hostage by navigation; the
 * {@link WizardStepHandle} exists only to flush a row the user typed but never added.
 */
export const WizardPricingPage = forwardRef<WizardStepHandle>(
  function WizardPricingPage(_props, ref) {
    const { items, entityDefinitionId, refresh } = useCatalogItems()
    const { getSetting: getGeneralSetting } = useSettings({ scope: 'GENERAL' })
    const { getSetting: getDocumentsSetting, updateOrganizationSetting } = useSettings({
      scope: 'DOCUMENTS',
    })

    const currency = (getGeneralSetting('organization.currency') as string) || 'USD'
    const taxRates = (getDocumentsSetting('documents.taxRates') as TaxRate[] | null) ?? []

    const [productName, setProductName] = useState('')
    const [productPrice, setProductPrice] = useState('')
    const [taxName, setTaxName] = useState('')
    const [taxRate, setTaxRate] = useState('')

    const createRecord = api.record.create.useMutation({
      onError: (error) => toastError({ title: 'Error adding product', description: error.message }),
    })

    const addProduct = () => {
      const name = productName.trim()
      if (!name || !entityDefinitionId || createRecord.isPending) return
      const cents = toCents(productPrice)
      createRecord.mutate(
        {
          entityDefinitionId,
          values: {
            catalog_item_name: name,
            catalog_item_category: 'service',
            catalog_item_taxable: true,
            catalog_item_active: true,
            ...(cents === null ? {} : { catalog_item_default_unit_price: cents }),
          },
        },
        {
          onSuccess: () => {
            setProductName('')
            setProductPrice('')
            refresh()
          },
        }
      )
    }

    const addTaxRate = () => {
      const name = taxName.trim()
      const rate = Number.parseFloat(taxRate)
      if (!name || !Number.isFinite(rate)) return
      const next: TaxRate[] = [
        ...taxRates,
        { id: generateId('taxrate'), name, rate, isDefault: taxRates.length === 0 },
      ]
      updateOrganizationSetting('documents.taxRates', next)
      setTaxName('')
      setTaxRate('')
    }

    useImperativeHandle(ref, () => ({
      tryAdvance: () => {
        // A typed-but-never-added row is an edit the user expects to survive the page leave —
        // same contract as the address/hours drafts. Never blocks: both halves are optional.
        if (productName.trim()) addProduct()
        if (taxName.trim() && Number.isFinite(Number.parseFloat(taxRate))) addTaxRate()
        return true
      },
    }))

    return (
      <div className='flex flex-col gap-5 p-4'>
        <p className='text-muted-foreground text-sm'>
          What you sell and what you charge tax at — both go straight onto quotes and invoices. You
          can add the rest later in Dispatch settings.
        </p>

        <section className='flex flex-col gap-2'>
          <Label className='text-foreground text-sm'>Products &amp; services</Label>
          {items.length > 0 && (
            <ul className='flex flex-col gap-1 rounded-lg border p-2'>
              {items.slice(0, 4).map((item) => (
                <li key={item.id} className='flex items-center justify-between gap-2 px-1 text-sm'>
                  <span className='truncate'>{item.name}</span>
                  <span className='shrink-0 text-muted-foreground'>
                    {formatMoney(item.defaultUnitPriceCents, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className='flex items-end gap-2'>
            <div className='flex-1'>
              <Input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder='e.g. Standard service call'
              />
            </div>
            <Input
              value={productPrice}
              onChange={(event) => setProductPrice(event.target.value)}
              placeholder='0.00'
              inputMode='decimal'
              className='w-28'
            />
            <Button
              variant='outline'
              size='sm'
              onClick={addProduct}
              disabled={!productName.trim() || !entityDefinitionId}
              loading={createRecord.isPending}>
              <Plus />
              Add
            </Button>
          </div>
        </section>

        <section className='flex flex-col gap-2'>
          <Label className='text-foreground text-sm'>Tax rates</Label>
          {taxRates.length > 0 && (
            <ul className='flex flex-col gap-1 rounded-lg border p-2'>
              {taxRates.map((rate) => (
                <li key={rate.id} className='flex items-center justify-between gap-2 px-1 text-sm'>
                  <span className='truncate'>
                    {rate.name}
                    {rate.isDefault && <span className='text-muted-foreground'> · default</span>}
                  </span>
                  <span className='shrink-0 text-muted-foreground'>{rate.rate}%</span>
                </li>
              ))}
            </ul>
          )}
          <div className='flex items-end gap-2'>
            <div className='flex-1'>
              <Input
                value={taxName}
                onChange={(event) => setTaxName(event.target.value)}
                placeholder='e.g. State sales tax'
              />
            </div>
            <div className='relative w-28'>
              <Input
                value={taxRate}
                onChange={(event) => setTaxRate(event.target.value)}
                placeholder='0'
                inputMode='decimal'
                className='pr-8'
              />
              <Percent className='pointer-events-none absolute top-2.5 right-2 size-4 text-muted-foreground' />
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={addTaxRate}
              disabled={!taxName.trim() || !Number.isFinite(Number.parseFloat(taxRate))}>
              <Plus />
              Add
            </Button>
          </div>
          {taxRates.length === 0 && (
            <p className='text-muted-foreground text-xs'>
              The first rate you add becomes the default applied to new quote and invoice lines.
            </p>
          )}
        </section>
      </div>
    )
  }
)
