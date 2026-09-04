// apps/web/src/components/accounting/ui/setup-wizard/wizard-opening-page.tsx
'use client'

import {
  ACCOUNT_ROLE_LABELS,
  openingDifference,
  openingDifferenceRows,
  readSettingMinorUnits,
} from '@auxx/lib/postings/client'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Check } from 'lucide-react'
import { forwardRef, useImperativeHandle } from 'react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { formatMoney } from '~/components/money/ui/settings/format-money'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import type { WizardStepHandle } from './wizard-step-handle'

const AUXX_KEYS = [
  'accounting.openingRawMaterials',
  'accounting.openingWip',
  'accounting.openingFinishedGoods',
] as const

const QBO_KEYS = [
  'accounting.qboOpeningRawMaterials',
  'accounting.qboOpeningWip',
  'accounting.qboOpeningFinishedGoods',
] as const

const JOURNAL_REF_KEY = 'accounting.qboOpeningJournalRef'

const DRAFT_KEYS = [...AUXX_KEYS, ...QBO_KEYS, JOURNAL_REF_KEY] as const

const ROW_TITLES = ['Raw materials', 'Work in process', 'Finished goods'] as const

/**
 * Page 3 of `AccountingSetupWizard` ("Opening inventory") - the two opening inventory snapshots, side by side, and the difference
 * between them.
 *
 * 🛑 Neither number silently overrides the other, which is why this is a DIFFERENCE rather than a
 * fallback. A difference falling into the first month's balancing plug would classify a cutover
 * problem as that month's COGS; the Auxx number alone would let the provider and the subledger
 * disagree from day one. So the page refuses Continue until they agree.
 *
 * ⚠️ `0` and unset are not interchangeable. A business with no work in process at cutover has
 * exactly zero; a business that never entered the figure has nothing. The catalog stores `null`
 * for the second and every readiness check treats it as unconfigured.
 *
 * ⚠️ Values are integer MINOR units and `CURRENCY` does not enforce that -
 * `normalizeSettingValue` routes it through `fieldValueSchemas.number`, which accepts `12.5`.
 * `readOpeningBaseline` refuses a fractional value on the read side, so without the check here
 * the failure mode is a setup that SAVES and then cannot close.
 */
export const WizardOpeningPage = forwardRef<WizardStepHandle>(
  function WizardOpeningPage(_props, ref) {
    const { draft, dirty, save, controlled, getSetting } = useAccountingSetupDraft(DRAFT_KEYS)

    const currency = (getSetting('organization.currency') as string) || 'USD'
    const rows = openingDifferenceRows(draft)
    const difference = openingDifference(draft)

    const allPresent = [...AUXX_KEYS, ...QBO_KEYS].every(
      (k) => readSettingMinorUnits(draft[k]) !== null
    )
    const fractional = [...AUXX_KEYS, ...QBO_KEYS].some((k) => {
      const n = readSettingMinorUnits(draft[k])
      return n !== null && !Number.isInteger(n)
    })

    const blockingReason = fractional
      ? 'An opening balance is not a whole number of cents. Enter the amount to two decimal places.'
      : allPresent && difference !== 0
        ? 'The Auxx and provider snapshots do not agree. Correct one of them before continuing.'
        : null

    useImperativeHandle(ref, () => ({
      tryAdvance: (direction) => {
        if (blockingReason && direction === 'next') {
          toastError({ title: 'Opening balances do not reconcile', description: blockingReason })
          return false
        }
        // Back and "Set up later" always save whatever is valid and let the user out. A page that
        // can trap somebody has no escape hatch, and unlike a dirty-draft check this condition can
        // be true on a page nobody touched.
        if (dirty && !fractional) save()
        return true
      },
    }))

    return (
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-muted-foreground text-sm'>
          What you were carrying at the cutoff, from the physical count valued at your CPA-approved
          costs, beside what your accounting provider says. Both, so a cutover problem cannot hide
          inside the first month&apos;s numbers.
        </p>

        <div className='grid grid-cols-1 items-start gap-4 md:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <span className='font-medium text-foreground text-sm'>Auxx snapshot</span>
            <FieldPanel
              orientation='vertical'
              resizeId='accounting-wizard-opening-auxx'
              defaultLabelWidth={140}
              className='p-0'>
              {AUXX_KEYS.map((key, index) => (
                <SettingsFieldRow
                  key={key}
                  settingKey={key}
                  title={ROW_TITLES[index] ?? key}
                  {...controlled(key)}
                />
              ))}
            </FieldPanel>
          </div>

          <div className='flex flex-col gap-1.5'>
            <span className='font-medium text-foreground text-sm'>Accounting provider</span>
            <FieldPanel
              orientation='vertical'
              resizeId='accounting-wizard-opening-qbo'
              defaultLabelWidth={140}
              className='p-0'>
              {QBO_KEYS.map((key, index) => (
                <SettingsFieldRow
                  key={key}
                  settingKey={key}
                  title={ROW_TITLES[index] ?? key}
                  {...controlled(key)}
                />
              ))}
            </FieldPanel>
          </div>
        </div>

        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-foreground text-sm'>Reconciliation</span>
          <div className='overflow-hidden rounded-xl border'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b text-muted-foreground text-xs'>
                  <th className='px-3 py-1.5 text-left font-normal'>Account</th>
                  <th className='px-3 py-1.5 text-right font-normal'>Auxx</th>
                  <th className='px-3 py-1.5 text-right font-normal'>Provider</th>
                  <th className='px-3 py-1.5 text-right font-normal'>Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.role} className='border-b last:border-b-0'>
                    <td className='px-3 py-1.5'>{ACCOUNT_ROLE_LABELS[row.role] ?? row.role}</td>
                    <td className='px-3 py-1.5 text-right tabular-nums'>
                      {formatMoney(row.auxx, currency)}
                    </td>
                    <td className='px-3 py-1.5 text-right tabular-nums'>
                      {formatMoney(row.qbo, currency)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 text-right tabular-nums',
                        row.difference !== null && row.difference !== 0 && 'text-destructive'
                      )}>
                      {formatMoney(row.difference, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allPresent ? (
            difference === 0 ? (
              <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                <Check className='size-3.5 text-good-500' />
                Both snapshots agree.
              </p>
            ) : (
              <p className='flex items-center gap-1.5 text-destructive text-xs'>
                <AlertTriangle className='size-3.5' />
                Off by {formatMoney(difference, currency)}. Setup cannot be finalized until they
                agree.
              </p>
            )
          ) : (
            <p className='text-muted-foreground text-xs'>
              Enter all six figures to reconcile. Zero is a real balance; leaving a field empty is
              not the same thing.
            </p>
          )}
        </div>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-wizard-opening-ref'
          defaultLabelWidth={150}
          className='p-0'>
          <SettingsFieldRow
            settingKey={JOURNAL_REF_KEY}
            title='Opening journal reference'
            description='The journal entry in your provider that booked these balances. Auxx did not post it, so this is a reference for the audit trail rather than a posting.'
            placeholder='JE-1042'
            {...controlled(JOURNAL_REF_KEY)}
          />
        </FieldPanel>
      </div>
    )
  }
)
