// apps/web/src/components/accounting/ui/setup-wizard/wizard-period-page.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import { isValidTimeZone } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { forwardRef, useImperativeHandle } from 'react'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'
import { useAccountingSetupDraft } from '../../hooks/use-accounting-setup-draft'
import type { WizardStepHandle } from './wizard-step-handle'

const CUTOFF_KEY = 'accounting.cutoffPeriod'
const TIMEZONE_KEY = 'accounting.bookTimeZone'

const DRAFT_KEYS = [CUTOFF_KEY, TIMEZONE_KEY] as const

/**
 * `parsePeriodKey` requires a MONTH key and there is no pattern validation on a `TEXT` setting -
 * `FieldOptions` has no such member - so the shape is checked here on the way in as well as on
 * read, where it fails closed.
 */
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Page 2 of `AccountingSetupWizard` - the two settings that decide which month a piece of
 * subledger activity belongs to.
 *
 * 🛑 There is NO UTC fallback on the timezone, deliberately. A receipt logged at 7pm on January 31
 * in `America/New_York` is already February 1 in UTC, so an org whose zone was quietly assumed
 * posts a month's edge activity into the wrong period - invisible except at a close, and
 * uncorrectable once the period is locked. Unset refuses to post rather than guessing.
 *
 * Edits are held in a local draft and written on leave through the {@link WizardStepHandle}, so
 * Back, Continue and "Set up later" all save. A dirty-but-invalid draft blocks Continue only.
 */
export const WizardPeriodPage = forwardRef<WizardStepHandle>(
  function WizardPeriodPage(_props, ref) {
    const { draft, patch, dirty, save, controlled } = useAccountingSetupDraft(DRAFT_KEYS)

    const cutoff = text(draft[CUTOFF_KEY])
    const zone = text(draft[TIMEZONE_KEY])

    const invalidReason = !cutoff
      ? 'Enter the last month your previous system closed, as YYYY-MM.'
      : !MONTH_KEY.test(cutoff)
        ? `"${cutoff}" is not a YYYY-MM month.`
        : !zone
          ? 'Enter the timezone your books are kept in. There is no UTC fallback.'
          : !isValidTimeZone(zone)
            ? `"${zone}" is not a valid IANA timezone.`
            : null

    useImperativeHandle(ref, () => ({
      tryAdvance: (direction) => {
        if (!dirty) return true
        if (invalidReason) {
          // Back and "Set up later" are never refusable - the user keeps their typing and the
          // wizard keeps its escape hatch. Only Continue is held.
          if (direction !== 'next') return true
          toastError({ title: 'Fix the accounting period', description: invalidReason })
          return false
        }
        save()
        return true
      },
    }))

    const detected = detectTimezone()

    return (
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-muted-foreground text-sm'>
          Everything dated after the cutoff is valued by Auxx. Everything before it is covered by
          the opening balances on the next page.
        </p>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-wizard-period'
          defaultLabelWidth={150}
          className='p-0'>
          <SettingsFieldRow
            settingKey={CUTOFF_KEY}
            title='Cutoff month'
            description='The last month closed in your previous accounting system, as YYYY-MM.'
            placeholder='2026-12'
            {...controlled(CUTOFF_KEY)}
          />
          <SettingsFieldRow
            settingKey={TIMEZONE_KEY}
            title='Book timezone'
            description='The IANA timezone period keys are derived in. Unset refuses to post rather than assuming UTC.'
            placeholder='America/New_York'
            {...controlled(TIMEZONE_KEY)}
          />
        </FieldPanel>

        {zone !== detected && isValidTimeZone(detected) && (
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={() => patch({ [TIMEZONE_KEY]: detected })}>
              Use {detected}
            </Button>
            <span className='text-muted-foreground text-xs'>Your browser&apos;s timezone.</span>
          </div>
        )}

        {invalidReason && <p className='text-muted-foreground text-xs'>{invalidReason}</p>}
      </div>
    )
  }
)
