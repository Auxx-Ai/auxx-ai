// apps/web/src/components/accounting/ui/setup-wizard/wizard-costing-page.tsx
'use client'

import { readSettingMinorUnits } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { forwardRef, useImperativeHandle } from 'react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import type { WizardStepHandle } from './wizard-step-handle'

const LABOR_KEY = 'manufacturing.assemblyLaborCostPerUnit'
const OVERHEAD_KEY = 'manufacturing.overheadCostPerUnit'

const DRAFT_KEYS = [LABOR_KEY, OVERHEAD_KEY] as const

/**
 * Page 4 of `AccountingSetupWizard` - the two absorption rates, plus a pointer at the
 * standard-cost roll.
 *
 * ⚠️ An unset rate is NOT zero. `loadAbsorptionRates` returns `null` for one and must keep doing
 * so: a `null` collapsing to `0` absorbs nothing while looking like it worked, and the resulting
 * entry understates inventory with no signal anywhere. So this page saves `null` for a cleared
 * field and the readiness predicate reports it as unconfigured.
 *
 * 🛑 The standard-cost roll is an ACTION over part rows, not a settings field, and its full
 * surface - the preview of what would change, the list of parts with no live cost - lives on
 * `settings/general`. This page links there rather than carrying a second copy of it, because the
 * roll needs part-def edit rights that the rest of the wizard does not.
 */
export const WizardCostingPage = forwardRef<WizardStepHandle>(
  function WizardCostingPage(_props, ref) {
    const { draft, dirty, save, controlled } = useAccountingSetupDraft(DRAFT_KEYS)

    const labor = readSettingMinorUnits(draft[LABOR_KEY])
    const overhead = readSettingMinorUnits(draft[OVERHEAD_KEY])

    const fractional = [labor, overhead].some((n) => n !== null && !Number.isInteger(n))

    useImperativeHandle(ref, () => ({
      tryAdvance: (direction) => {
        if (!dirty) return true
        if (fractional) {
          if (direction !== 'next') return true
          toastError({
            title: 'Fix your absorption rates',
            description: 'A rate must be a whole number of cents.',
          })
          return false
        }
        save()
        return true
      },
    }))

    return (
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-muted-foreground text-sm'>
          Every unit you assemble carries labor and overhead on top of its materials. These two
          per-unit figures are what gets absorbed. Leave one empty and nothing is absorbed for it.
        </p>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-wizard-costing'
          defaultLabelWidth={190}
          className='p-0'>
          <SettingsFieldRow
            settingKey={LABOR_KEY}
            title='Assembly labor per unit'
            description='Annual payroll times the assembly share, divided by expected annual units. Empty means no labor absorption at all.'
            {...controlled(LABOR_KEY)}
          />
          <SettingsFieldRow
            settingKey={OVERHEAD_KEY}
            title='Overhead per unit'
            description='Total annual factory overhead divided by expected annual units. Empty means no overhead absorption at all.'
            {...controlled(OVERHEAD_KEY)}
          />
        </FieldPanel>

        {(labor === null || overhead === null) && (
          <p className='text-muted-foreground text-xs'>
            {labor === null && overhead === null
              ? 'Neither rate is set, so an assembled unit is valued at materials only.'
              : labor === null
                ? 'No labor rate, so assembled units carry overhead only.'
                : 'No overhead rate, so assembled units carry labor only.'}
          </p>
        )}

        <div className='flex flex-col gap-2 rounded-xl border p-3'>
          <span className='font-medium text-foreground text-sm'>Standard cost</span>
          <p className='text-muted-foreground text-sm'>
            The rates above only reach your inventory once standard cost is rolled: that walks each
            bill of materials, adds the absorbed labor and overhead, and freezes a cost onto every
            part. Until it runs, an assembled part has no cost to value a movement with and the
            month-end entry refuses rather than guessing.
          </p>
          <div>
            <Button variant='outline' size='sm' asChild>
              <Link href='/app/accounting/settings/general'>
                Roll standard cost
                <ArrowUpRight />
              </Link>
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>
            Opens Accounting settings, where you can preview what the roll would change before
            running it. You can come back to the wizard afterwards.
          </p>
        </div>
      </div>
    )
  }
)
