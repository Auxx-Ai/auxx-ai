// apps/web/src/components/accounting/ui/setup-wizard/wizard-done-page.tsx
'use client'

import { resolveSetupReadiness, SETUP_READINESS_SETTING_KEYS } from '@auxx/lib/postings/client'
import type { SettingKey } from '@auxx/lib/settings/client'
import { Button } from '@auxx/ui/components/button'
import { AlertTriangle, Check, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'

interface WizardDonePageProps {
  /** Stamps `setWizardCompleted` and closes the dialog. */
  onFinish: () => void
}

/**
 * Page 6 (last) of `AccountingSetupWizard` - the readiness verdict and one of the two Finalize
 * doors.
 *
 * ✅ Finalize lives BOTH here and on `settings/general`, deliberately. The settings page is its
 * primary home because this wizard has "Set up later" on every page and stamps completion either
 * way, so a Finalize that existed only inside it could be walked straight past.
 *
 * 🛑 Finalizing freezes the opening baseline. After it, a mistake is corrected with a reversal and
 * a re-entry, never by editing setup history - changing an opening balance or the book timezone
 * afterwards would rewrite the arithmetic behind a journal entry that has already been posted.
 *
 * Readiness is the shared pure predicate over the settings record
 * (`packages/lib/src/postings/setup-readiness.ts`), not a query: `useSettings` rides the org cache
 * hydrated by the provider, so this costs nothing and can never disagree with the settings pages
 * or the checklist.
 */
export function WizardDonePage({ onFinish }: WizardDonePageProps) {
  const { user } = useUser()
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })

  const record: Record<string, unknown> = {}
  for (const key of SETUP_READINESS_SETTING_KEYS) record[key] = getSetting(key as SettingKey)

  const readiness = resolveSetupReadiness(record)
  const unmet = readiness.requirements.filter((requirement) => !requirement.met)

  const finalize = () => {
    batchUpdateOrganizationSettings([
      { key: 'accounting.setupState', value: 'finalized' },
      { key: 'accounting.setupFinalizedAt', value: new Date().toISOString() },
      { key: 'accounting.setupFinalizedByUserId', value: user?.id ?? null },
    ])
  }

  return (
    <div className='flex flex-col items-center gap-3 px-4 py-6 text-center'>
      <PartyPopper className='size-8 text-muted-foreground' />
      <h2 className='font-medium text-base text-foreground'>
        {readiness.finalized ? "You're set" : 'One last step'}
      </h2>

      {readiness.finalized ? (
        <p className='max-w-sm text-muted-foreground text-sm'>
          Your opening baseline is frozen and the ledger is open for business. Head to Accounting
          when you are ready to close your first month.
        </p>
      ) : unmet.length === 0 ? (
        <p className='max-w-sm text-muted-foreground text-sm'>
          Everything checks out. Finalizing freezes your opening baseline so the ledger can start.
          After that, a correction is a reversal and a re-entry, never an edit.
        </p>
      ) : (
        <div className='flex max-w-sm flex-col gap-2'>
          <p className='text-muted-foreground text-sm'>
            Not ready to finalize yet. You can finish these now or come back to them in Accounting
            settings.
          </p>
          <ul className='flex flex-col gap-1 rounded-lg border p-2 text-left'>
            {unmet.map((requirement) => (
              <li
                key={requirement.key}
                className='flex items-start gap-1.5 text-muted-foreground text-xs'>
                <AlertTriangle className='mt-0.5 size-3.5 shrink-0 text-amber-500' />
                <span>{requirement.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
        <Button variant='ghost' size='sm' onClick={onFinish}>
          Close
        </Button>
        {readiness.finalized ? (
          <Button variant='outline' size='sm' asChild onClick={onFinish}>
            <Link href='/app/accounting'>Open the ledger</Link>
          </Button>
        ) : (
          <Button
            variant='outline'
            size='sm'
            disabled={unmet.length > 0}
            loading={isBatchUpdatingOrgSettings}
            loadingText='Finalizing...'
            onClick={finalize}>
            <Check />
            Finalize setup
          </Button>
        )}
      </div>

      {!readiness.finalized && (
        <p className='max-w-sm text-muted-foreground text-xs'>
          You can also finalize from Accounting settings later.
        </p>
      )}
    </div>
  )
}
