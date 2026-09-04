// apps/web/src/components/accounting/ui/setup-wizard/wizard-done-page.tsx
'use client'

import type { PostResultStatus } from '@auxx/lib/postings/client'
import { resolveSetupReadiness, SETUP_READINESS_SETTING_KEYS } from '@auxx/lib/postings/client'
import type { SettingKey } from '@auxx/lib/settings/client'
import { Button } from '@auxx/ui/components/button'
import { AlertTriangle, Check, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../ledger/entry-blockers'
import { EntryJournal } from '../ledger/entry-journal'

interface WizardDonePageProps {
  /** Stamps `setWizardCompleted` and closes the dialog. */
  onFinish: () => void
}

/**
 * Last page of `AccountingSetupWizard` - what is about to post, the readiness
 * verdict, and one of the two Finalize doors.
 *
 * ✅ Finalize lives BOTH here and on `settings/general`, deliberately. The
 * settings page is its primary home because this wizard has "Set up later" on
 * every page and stamps completion either way, so a Finalize that existed only
 * inside it could be walked straight past.
 *
 * 🛑 Finalizing freezes the opening baseline. After it, a mistake is corrected
 * with a reversal and a re-entry, never by editing setup history - changing an
 * opening balance or the book timezone afterwards would rewrite the arithmetic
 * behind a journal entry that has already been booked.
 *
 * ## Finalize is two writes, in one order, and the order is the point
 *
 * 1. **The settings finalize** flips `accounting.setupState` to `finalized`.
 *    Nothing may post until it reads that: `readOpeningBaseline` refuses on
 *    anything else, and it is the gate the whole module hangs off.
 * 2. **`ledgerOpening.post`** then posts the opening entry, dated the last day
 *    of the cutoff month.
 *
 * The other order would post an entry into books that are still officially in
 * setup, and `assertAccountingSetupUnfrozen` would then refuse the settings
 * write that was supposed to open them - a setup that cannot be finished.
 *
 * 🛑 A refused post is rendered as an `EntryBlockers` card, never a toast
 * (ground rule 9). A toast disappears; the refusal names the account or the
 * period that has to be fixed and is the screen's content until it is.
 */
export function WizardDonePage({ onFinish }: WizardDonePageProps) {
  const { user } = useUser()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const utils = api.useUtils()

  // 🛑 The settings write goes through the tRPC mutation DIRECTLY rather than
  // through `useSettings`, which fires `.mutate` and returns void. The two
  // writes below have to happen in order - see the JSDoc - and there is no
  // ordering to be had from a fire-and-forget call. The local settings store is
  // patched by hand afterwards, which is exactly what `useSettings` does.
  const finalizeSettings = api.setting.batchUpdateOrganizationSettings.useMutation()
  const opening = api.ledgerOpening.get.useQuery()
  const preview = api.ledgerOpening.preview.useMutation()
  const post = api.ledgerOpening.post.useMutation()

  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  const record: Record<string, unknown> = {}
  for (const key of SETUP_READINESS_SETTING_KEYS) record[key] = getSetting(key as SettingKey)

  // The trial balance is the one requirement that is not a setting, so it is
  // passed in. An absent summary reads as met - see `SetupReadinessContext` -
  // which is why the query's own loading state is not a blocker here.
  const readiness = resolveSetupReadiness(
    record,
    opening.data ? { openingTrialBalance: opening.data.summary } : {}
  )
  const unmet = readiness.requirements.filter((requirement) => !requirement.met)

  // Preview once the query has an entry, so the journal below shows the lines
  // that are actually about to post rather than the grid's own arithmetic. An
  // arithmetic refusal (an unbalanced trial balance) throws, and it is already
  // reported by the readiness row above, so the preview's own error is not
  // surfaced a second time here.
  const previewData = preview.data
  const entryId = opening.data?.entry?.id ?? null
  const runPreview = preview.mutate
  useEffect(() => {
    if (entryId) runPreview({})
  }, [entryId, runPreview])

  const finalize = async () => {
    setBlockers([])
    const patch = {
      'accounting.setupState': 'finalized',
      'accounting.setupFinalizedAt': new Date().toISOString(),
      'accounting.setupFinalizedByUserId': user?.id ?? null,
    }
    try {
      await finalizeSettings.mutateAsync({
        settings: Object.entries(patch).map(([key, value]) => ({ key, value })),
      })
      if (organizationId) patchSettings(organizationId, patch)
    } catch (error) {
      setBlockers([{ status: 'error', error: messageOf(error) }])
      return
    }

    if (!entryId) return

    try {
      const result = await post.mutateAsync({})
      // `postEntry` never throws: a closed period, an account that has left the
      // chart and a provider refusal all arrive as a status the card renders.
      if (result.status !== 'posted' && result.status !== 'already_posted') {
        setBlockers([
          {
            status: result.status as PostResultStatus,
            error: result.error ?? `The opening entry came back ${result.status}.`,
          },
        ])
      }
    } catch (error) {
      // An arithmetic refusal - an unbalanced or empty trial balance - throws
      // rather than returning a status, because there is no entry to report on.
      setBlockers([{ status: 'unbalanced', error: messageOf(error) }])
    } finally {
      await utils.ledgerOpening.get.invalidate()
    }
  }

  const isFinalizing = finalizeSettings.isPending || post.isPending
  const posted = opening.data?.entry?.status === 'posted'

  return (
    <div className='flex flex-col gap-3 px-4 py-6'>
      <div className='flex flex-col items-center gap-3 text-center'>
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
            Everything checks out. Finalizing freezes your opening baseline and posts the opening
            entry below. After that, a correction is a reversal and a re-entry, never an edit.
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
      </div>

      {/*
        What is about to post, read-only, above the button that posts it. The
        opening entry is the first thing in the org's ledger and it is
        permanent, so it is shown rather than described. `EntryJournal` is the
        same component the close console renders a month-end entry with, so the
        layout a bookkeeper checks it in is the one they already know.
      */}
      {previewData && previewData.lines.length > 0 && (
        <div className='flex flex-col gap-2'>
          <div className='flex flex-wrap items-baseline justify-between gap-2'>
            <span className='font-medium text-foreground text-sm'>
              {posted ? 'Opening entry' : 'Opening entry, about to post'}
            </span>
            <span className='font-mono text-muted-foreground text-xs'>
              {previewData.docNumber} · {previewData.txnDate}
            </span>
          </div>
          <EntryJournal lines={previewData.lines} currencyCode={opening.data?.currency ?? 'USD'} />
          {previewData.blockedBy && (
            <EntryBlockers
              blockers={[
                { status: previewData.blockedBy.status, error: previewData.blockedBy.error },
              ]}
            />
          )}
        </div>
      )}

      {blockers.length > 0 && <EntryBlockers blockers={blockers} />}

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
            loading={isFinalizing}
            loadingText='Finalizing...'
            onClick={finalize}>
            <Check />
            Finalize setup
          </Button>
        )}
      </div>

      {!readiness.finalized && (
        <p className='mx-auto max-w-sm text-center text-muted-foreground text-xs'>
          You can also finalize from Accounting settings later.
        </p>
      )}
    </div>
  )
}

/** The server's own sentence, which is the only part that names what to fix. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
