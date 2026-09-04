// apps/web/src/components/accounting/ui/banking/review/review-bulk-bar.tsx

'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Textarea } from '@auxx/ui/components/textarea'
import { Ban, Sparkles, Tags } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { GlAccountPicker } from '../../gl-account-picker'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'

interface ReviewBulkBarProps {
  selectedIds: string[]
  onClear: () => void
  onDone: () => void
}

/**
 * The bulk bar (plans/accounting/ui-plan.md §2.8): Accept suggested, Exclude,
 * Assign account.
 *
 * 🛑 **Accept and Assign both POST**, one entry per line, so both are
 * `ledgerPost` and both report every refusal by name. A bulk bar that says
 * "3 failed" with no reasons sends the operator back through the list one row
 * at a time, which is the opposite of what a bulk bar is for.
 *
 * ⚠️ Accept applies whatever slot 3C's miner proposed and nothing else. It never
 * guesses: a plausible-looking wrong default accepted in bulk by a bookkeeper
 * clearing a backlog is the specific trap the bank plan names, and every one of
 * those acceptances is a posting.
 */
export function ReviewBulkBar({ selectedIds, onClear, onDone }: ReviewBulkBarProps) {
  const utils = api.useUtils()
  const [dialog, setDialog] = useState<'exclude' | 'assign' | null>(null)
  const [reason, setReason] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<LedgerBlocker[]>([])

  const count = selectedIds.length

  const refresh = async () => {
    await Promise.all([
      utils.bankingReview.list.invalidate(),
      utils.bankingReview.stats.invalidate(),
    ])
  }

  const report = (result: {
    failed: number
    succeeded: number
    failures: { id: string; status?: string; message?: string }[]
  }) => {
    if (result.failed === 0) {
      setBlockers([])
      setDialog(null)
      onDone()
      return
    }
    setBlockers(
      result.failures.map((failure) => ({
        status: (failure.status ?? 'error') as LedgerBlocker['status'],
        error: `${failure.id}: ${failure.message ?? 'Refused.'}`,
      }))
    )
  }

  const acceptSuggested = api.bankingReview.bulkAcceptSuggested.useMutation({
    onSuccess: async (result) => {
      await refresh()
      report(result)
    },
    onError: (error) => setBlockers([{ status: 'error', error: error.message }]),
  })
  const bulkExclude = api.bankingReview.bulkExclude.useMutation({
    onSuccess: async (result) => {
      await refresh()
      report(result)
    },
    onError: (error) => setBlockers([{ status: 'error', error: error.message }]),
  })
  const bulkAssign = api.bankingReview.bulkAssignAccount.useMutation({
    onSuccess: async (result) => {
      await refresh()
      report(result)
    },
    onError: (error) => setBlockers([{ status: 'error', error: error.message }]),
  })

  const busy = acceptSuggested.isPending || bulkExclude.isPending || bulkAssign.isPending

  const actions: ActionBarAction[] = [
    {
      id: 'accept',
      label: 'Accept suggested',
      icon: Sparkles,
      tooltip: 'Code every selected line to the account that was suggested for it',
      disabled: busy || count === 0,
      onClick: () => acceptSuggested.mutate({ ids: selectedIds.slice(0, 100) }),
    },
    {
      id: 'assign',
      label: 'Assign account',
      icon: Tags,
      tooltip: 'Code every selected line to one account',
      disabled: busy || count === 0,
      onClick: () => {
        setBlockers([])
        setDialog('assign')
      },
    },
    {
      id: 'exclude',
      label: 'Exclude',
      icon: Ban,
      tooltip: 'Take every selected line out of the queue with one reason',
      disabled: busy || count === 0,
      onClick: () => {
        setBlockers([])
        setDialog('exclude')
      },
    },
  ]

  return (
    <>
      <ActionBar
        open={count > 0}
        onOpenChange={(open) => !open && onClear()}
        selectedCount={count}
        selectedLabel='selected'
        actions={actions}
        showClose
      />

      <Dialog open={dialog === 'exclude'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exclude {count} bank lines</DialogTitle>
            <DialogDescription>
              The reason is recorded on every one of them. An exclusion with no reason reads exactly
              like an unreviewed line to the next person.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            rows={3}
            placeholder='Personal charges on the company card'
            onChange={(event) => setReason(event.target.value)}
          />
          <EntryBlockers blockers={blockers} />
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={!reason.trim() || busy}
              loading={bulkExclude.isPending}
              onClick={() =>
                bulkExclude.mutate({ ids: selectedIds.slice(0, 200), reason: reason.trim() })
              }>
              Exclude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'assign'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Code {count} bank lines</DialogTitle>
            <DialogDescription>
              Each line posts its own entry: the account below on one side, its bank account on the
              other. Money out debits the account; money in credits it.
            </DialogDescription>
          </DialogHeader>
          <GlAccountPicker value={code} onChange={setCode} placeholder='Choose an account…' />
          <EntryBlockers blockers={blockers} />
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={!code || busy}
              loading={bulkAssign.isPending}
              onClick={() =>
                bulkAssign.mutate({ ids: selectedIds.slice(0, 100), glAccountCode: code ?? '' })
              }>
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
