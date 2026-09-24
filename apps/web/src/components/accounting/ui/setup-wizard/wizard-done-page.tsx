// apps/web/src/components/accounting/ui/setup-wizard/wizard-done-page.tsx
'use client'

import type { PostResultStatus } from '@auxx/lib/accounting/ledger/client'
import {
  didLedgerAccept,
  readOpeningFromNothing,
  resolveSetupReadiness,
  SETUP_READINESS_SETTING_KEYS,
} from '@auxx/lib/accounting/ledger/client'
import type { SettingKey } from '@auxx/lib/settings/client'
import { Button } from '@auxx/ui/components/button'
import { AlertTriangle, Check, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSettings } from '~/hooks/use-settings'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../ledger/entry-blockers'
import { EntryJournal } from '../ledger/entry-journal'
import { OpeningFillButton } from '../settings/opening-fill-button'

interface WizardDonePageProps {
  /** Stamps `setWizardCompleted` and closes the dialog. */
  onFinish: () => void
}

/**
 * Last page of `AccountingSetupWizard`: what is about to post, the readiness verdict, and
 * Finalize - which is `ledger.finalizeSetup`, the same server door the settings page uses.
 * A refused post renders as an `EntryBlockers` card, never a toast; pressing Finalize again
 * retries only the post.
 */
export function WizardDonePage({ onFinish }: WizardDonePageProps) {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const utils = api.useUtils()

  const finalizeSetup = api.ledger.finalizeSetup.useMutation()
  const opening = api.ledgerOpening.get.useQuery()
  const preview = api.ledgerOpening.preview.useMutation()

  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  const record: Record<string, unknown> = {}
  for (const key of SETUP_READINESS_SETTING_KEYS) record[key] = getSetting(key as SettingKey)
  const fromNothing = readOpeningFromNothing(record)

  const entry = opening.data?.entry ?? null
  const posted = entry?.status === 'posted'
  // An absent opening reads as met while loading; the server re-checks on Finalize.
  const readiness = resolveSetupReadiness(record, {
    ...(opening.data ? { opening: { posted, summary: opening.data.summary } } : {}),
  })
  const unmet = readiness.requirements.filter((requirement) => !requirement.met)
  // Finalized with the opening still a draft: a previous post was refused, so offer the retry.
  const awaitingPost = readiness.finalized && !fromNothing && !!entry && !posted

  // The preview's own arithmetic refusal is already reported by the readiness row above.
  const previewData = preview.data
  const entryId = entry?.id ?? null
  const runPreview = preview.mutate
  useEffect(() => {
    if (entryId) runPreview({})
  }, [entryId, runPreview])

  const finalize = async () => {
    setBlockers([])
    try {
      const result = await finalizeSetup.mutateAsync()
      if (organizationId) patchSettings(organizationId, { 'accounting.setupState': 'finalized' })
      // `didLedgerAccept`, not `posted`: the opening entry never exports, so a good one can
      // come back `not_exported`.
      if (result.opening && !didLedgerAccept(result.opening)) {
        setBlockers([
          {
            status: result.opening.status as PostResultStatus,
            error: result.opening.error ?? `The opening entry came back ${result.opening.status}.`,
          },
        ])
      }
    } catch (error) {
      setBlockers([{ status: 'error', error: messageOf(error) }])
    } finally {
      await utils.ledgerOpening.get.invalidate()
    }
  }

  const done = readiness.finalized && !awaitingPost

  return (
    <div className='flex flex-col gap-3 px-4 py-6'>
      <div className='flex flex-col items-center gap-3 text-center'>
        <PartyPopper className='size-8 text-muted-foreground' />
        <h2 className='font-medium text-base text-foreground'>
          {done ? "You're set" : 'One last step'}
        </h2>

        {done ? (
          <p className='max-w-sm text-muted-foreground text-sm'>
            Your opening balances are frozen and the ledger is open for business. Head to Accounting
            when you are ready to close your first month.
          </p>
        ) : awaitingPost ? (
          <p className='max-w-sm text-muted-foreground text-sm'>
            Setup is finalized, but the opening entry has not posted yet. Fix what is named below
            and post it again.
          </p>
        ) : unmet.length === 0 ? (
          <p className='max-w-sm text-muted-foreground text-sm'>
            Everything checks out. Finalizing freezes your opening balances and posts the opening
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

      {/* With an accounting system connected, the opening is filled from its balance sheet. */}
      {!readiness.finalized && !fromNothing && (
        <div className='flex justify-center'>
          <OpeningFillButton
            frozen={opening.data?.frozen ?? false}
            cutoverDate={opening.data?.cutoverDate ?? null}
          />
        </div>
      )}

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
        {done ? (
          <Button variant='outline' size='sm' asChild onClick={onFinish}>
            <Link href='/app/accounting'>Open the ledger</Link>
          </Button>
        ) : (
          <Button
            variant='outline'
            size='sm'
            disabled={unmet.length > 0}
            loading={finalizeSetup.isPending}
            loadingText='Finalizing...'
            onClick={finalize}>
            <Check />
            {awaitingPost ? 'Post the opening entry' : 'Finalize setup'}
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
