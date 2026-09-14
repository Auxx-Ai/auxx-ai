// apps/web/src/components/returns/intake/ui/return-intake-review-page.tsx
'use client'

// The review route's body: one card per photographed label, the grouping
// summary underneath, and one Create button
// (plans/money/tasks/57 §5.3 / §6.3 / §7.2 / §7.3).
//
// 🛑 A ROUTE, not a dialog, for `quote-intake-dialog.tsx`'s stated reason:
// `DialogNavPages` springs to a per-page `DialogSize` whose largest token is
// `3xl` = 56rem, and the photo has to sit beside the fields. It also gives the
// dock a URL a second person can open, which a dialog cannot.
//
// 🛑 This component does NOT render `MainPage`. `app/(protected)/app/returns/
// layout.tsx` owns the shell for every path under `/app/returns`, unconditionally
// — so the header actions and the extra crumb are contributed through
// `MainPageAction` / `MainPageCrumbs` rather than by nesting a second `MainPage`.
//
// 🛑 **Partial commit is real and is shown as such** (§6.3). `commit` returns one
// `ReturnIntakeCommitResult` per group; three groups where the second failed
// means TWO REAL RMAs EXIST. A single "failed" toast over that would tell the
// worker the opposite of the truth, so the outcome is reported per group and the
// button then offers to retry only the ones that failed.

import type { RecordId } from '@auxx/lib/resources/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import type {
  ReturnIntakeCommitResult,
  ReturnIntakeDraftView,
  ReturnIntakeGroupView,
  ReturnIntakeLabel,
} from '@auxx/lib/returns/intake/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  MainPageAction,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageCrumbs,
} from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import { Check, Clock, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useRecords } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import {
  buildReturnIntakeGroupViews,
  isLabelDecided,
  ReturnIntakeGroups,
} from './return-intake-groups'
import { ReturnIntakeLabelCard, type ReturnIntakeLabelPatch } from './return-intake-label-card'

/**
 * The draft as this screen reads it.
 *
 * ⚠️ `groups` is optional and preferred when present: the lib's `group.ts` is the
 * authority on the grouping key, and `commit({ groupIds })` names groups by ids
 * it minted. When `get` does not carry them, the same rule is applied client-side
 * by `buildReturnIntakeGroupViews`, which re-exports the server's own `groupLabels` — see it for the key
 * the two sides have to agree on.
 */
type DraftWithGroups = ReturnIntakeDraftView & { groups?: ReturnIntakeGroupView[] }

export function ReturnIntakeReviewPage({ draftId }: { draftId: string }) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirmDialog, ConfirmDialog] = useConfirm()
  const [results, setResults] = useState<ReturnIntakeCommitResult[] | null>(null)

  const draft = api.returnIntake.get.useQuery(
    { draftId },
    {
      // Poll only while the worker is still reading labels. Once it is `ready`
      // a refetch would race nothing, but it is also pointless.
      refetchInterval: (query) => (query.state.data?.status === 'reading' ? 1500 : false),
      // 🛑 No retries. The draft lives in Redis on a TTL, so the only reason this
      // read fails is that it is gone — retrying a not-found three times holds
      // the spinner over an answer that will not change.
      retry: false,
    }
  )

  const confirmLabel = api.returnIntake.confirmLabel.useMutation()
  // §4.6: the label typed in by hand when the model could not read it. Gated on
  // EDIT rather than view, because these values go onto the return verbatim as
  // the only identifying thing an unannounced pallet carries.
  const patchTranscription = api.returnIntake.patchLabelTranscription.useMutation()
  const commit = api.returnIntake.commit.useMutation()
  const discard = api.returnIntake.discard.useMutation()
  // ⚠️ A MUTATION, not a query: it reads the contact's shipped orders AND caches
  // them onto the draft, so the picker survives a reload of this URL. It is
  // therefore fired once per newly confirmed contact, not on every render.
  const loadOrderOptions = api.returnIntake.orderOptions.useMutation()
  const [loadingOptionsFor, setLoadingOptionsFor] = useState<RecordId | null>(null)

  const data = draft.data as DraftWithGroups | undefined
  const labels: ReturnIntakeLabel[] = useMemo(() => data?.payload.labels ?? [], [data])

  const confirmedContactIds = useMemo(
    () =>
      labels
        .map((label) => label.confirmedContactRecordId)
        .filter((id): id is RecordId => id !== null),
    [labels]
  )

  // Names for the summary. A contact picked from a candidate already carries its
  // name, but one picked from the free search does not — so both are hydrated
  // and the candidate name is the fallback, never the only source.
  const contactRecords = useRecords({ recordIds: confirmedContactIds })

  const groups: ReturnIntakeGroupView[] = useMemo(() => {
    if (data?.groups) return data.groups

    const contactNames = new Map<RecordId, string>()
    const orderNumbers = new Map<RecordId, string>()
    for (const label of labels) {
      for (const candidate of label.candidates) {
        contactNames.set(candidate.contactRecordId, candidate.contactName)
        if (candidate.orderRecordId && candidate.orderNumber) {
          orderNumbers.set(candidate.orderRecordId, candidate.orderNumber)
        }
      }
    }
    for (const options of Object.values(data?.payload.orderOptions ?? {})) {
      for (const option of options) {
        if (option.orderNumber) orderNumbers.set(option.orderRecordId, option.orderNumber)
      }
    }
    for (const [recordId, record] of contactRecords.recordsByKey) {
      if (record.displayName) contactNames.set(recordId, record.displayName)
    }

    return buildReturnIntakeGroupViews(labels, { contactNames, orderNumbers })
  }, [data, labels, contactRecords.recordsByKey])

  const succeededGroupIds = useMemo(
    () =>
      new Set(
        (results ?? []).filter((result) => result.error === null).map((result) => result.groupId)
      ),
    [results]
  )
  const pendingGroups = groups.filter((group) => !succeededGroupIds.has(group.id))
  const undecidedCount = labels.filter((label) => !isLabelDecided(label)).length

  const knownOrderOptions = data?.payload.orderOptions ?? {}

  const handleConfirm = useCallback(
    async (input: {
      labelId: string
      contactRecordId?: RecordId | null
      unidentified?: boolean
      orderRecordId?: RecordId | null
    }) => {
      try {
        await confirmLabel.mutateAsync({ draftId, ...input })

        // §4.5 runs only after the contact is a confirmed fact, and only once
        // per contact — the answer is cached onto the draft by the procedure.
        const contactRecordId = input.contactRecordId ?? null
        if (contactRecordId !== null && !knownOrderOptions[contactRecordId]) {
          setLoadingOptionsFor(contactRecordId)
          try {
            await loadOrderOptions.mutateAsync({ draftId, contactRecordId })
          } finally {
            setLoadingOptionsFor(null)
          }
        }

        await utils.returnIntake.get.invalidate({ draftId })
      } catch (error) {
        toastError({
          title: 'Could not save that answer',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [confirmLabel, draftId, knownOrderOptions, loadOrderOptions, utils]
  )

  const handlePatchTranscription = useCallback(
    async (labelId: string, patch: ReturnIntakeLabelPatch) => {
      try {
        await patchTranscription.mutateAsync({ draftId, labelId, ...patch })
        await utils.returnIntake.get.invalidate({ draftId })
      } catch (error) {
        toastError({
          title: 'Could not save what you read',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [draftId, patchTranscription, utils]
  )

  /**
   * Abandon the drop.
   *
   * 🛑 Destructive, so it goes through `useConfirm` — and the wording is the
   * point: nothing was written, so no RMA number was burned and there is
   * nothing to undo. That is the property §6.1 keeps the draft in Redis for.
   */
  const handleDiscard = async () => {
    const confirmed = await confirmDialog({
      title: 'Discard these labels?',
      description:
        'The photos and every match on them are thrown away. Nothing was written, so no RMA number is burned and there is nothing to undo.',
      confirmText: 'Discard',
      cancelText: 'Keep',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await discard.mutateAsync({ draftId })
      router.push('/app/returns')
    } catch (error) {
      toastError({
        title: 'Could not discard the draft',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleCommit = async () => {
    const groupIds = pendingGroups.map((group) => group.id)
    if (groupIds.length === 0) return
    try {
      const created = await commit.mutateAsync({ draftId, groupIds })
      // 🛑 Merge, never replace: a retry returns results only for the groups it
      // was given, and dropping the earlier successes would make already-created
      // RMAs vanish off the screen that reported them.
      setResults((current) => {
        const byId = new Map((current ?? []).map((result) => [result.groupId, result]))
        for (const result of created) byId.set(result.groupId, result)
        return Array.from(byId.values())
      })
      await utils.returnIntake.get.invalidate({ draftId })
    } catch (error) {
      toastError({
        title: 'Could not create the returns',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const createLabel =
    results === null
      ? `Create ${pendingGroups.length} ${pendingGroups.length === 1 ? 'return' : 'returns'}`
      : `Retry ${pendingGroups.length} ${pendingGroups.length === 1 ? 'return' : 'returns'}`

  return (
    <>
      <ConfirmDialog />
      <MainPageCrumbs>
        <MainPageBreadcrumbItem title='Label intake' />
      </MainPageCrumbs>

      <MainPageAction>
        {pendingGroups.length === 0 && results !== null ? (
          <Button variant='ghost' size='sm' onClick={() => router.push('/app/returns')}>
            Done
          </Button>
        ) : (
          <Button
            variant='ghost'
            size='sm'
            disabled={discard.isPending || commit.isPending}
            onClick={() => void handleDiscard()}>
            Discard
          </Button>
        )}
        {pendingGroups.length > 0 && (
          <Button
            variant='outline'
            size='sm'
            loading={commit.isPending}
            loadingText='Creating...'
            disabled={draft.isError || confirmLabel.isPending}
            onClick={() => void handleCommit()}>
            {createLabel}
          </Button>
        )}
      </MainPageAction>

      <MainPageContent>
        {draft.isLoading ? (
          <LoadingSpinner />
        ) : draft.isError ? (
          // An expired draft is a NOT-FOUND, not a row with an old status: the
          // draft and the temp photos share a TTL and go together on purpose.
          // A first-class state with a way forward, never a toast over a blank
          // page.
          <div className='p-6'>
            <Alert>
              <Clock className='size-4' />
              <AlertTitle>This label draft has expired</AlertTitle>
              <AlertDescription className='flex flex-col items-start gap-2'>
                <span>
                  A read that nobody confirms is kept for a day, along with the photos it was read
                  from. Nothing was written, so no RMA number was burned and there is nothing to
                  clean up.
                </span>
                <Button variant='outline' size='sm' onClick={() => router.push('/app/returns')}>
                  Back to returns
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : data?.status === 'failed' ? (
          <div className='p-6'>
            <Alert variant='destructive'>
              <TriangleAlert className='size-4' />
              <AlertTitle>These labels could not be read</AlertTitle>
              <AlertDescription>
                {data.failureReason ?? 'The read failed before it produced a draft.'}
              </AlertDescription>
            </Alert>
          </div>
        ) : !data ? (
          <LoadingSpinner />
        ) : (
          <div className='flex h-full min-h-0 flex-col gap-3 overflow-auto p-3'>
            {data.status === 'reading' && (
              <p className='text-muted-foreground text-sm'>
                Reading label {data.labelsRead + 1} of {data.labelsTotal}. Cards appear as each one
                comes back.
              </p>
            )}

            {results !== null && <CommitResults results={results} groups={groups} />}

            {labels.map((label, index) => (
              <ReturnIntakeLabelCard
                key={label.id}
                label={label}
                draftId={draftId}
                index={index + 1}
                total={labels.length}
                orderOptions={
                  label.confirmedContactRecordId
                    ? (data.payload.orderOptions[label.confirmedContactRecordId] ?? [])
                    : []
                }
                isLoadingOrderOptions={
                  label.confirmedContactRecordId !== null &&
                  loadingOptionsFor === label.confirmedContactRecordId
                }
                isPending={
                  confirmLabel.isPending || commit.isPending || patchTranscription.isPending
                }
                onPatchTranscription={(patch) => void handlePatchTranscription(label.id, patch)}
                onConfirmContact={(contactRecordId) =>
                  void handleConfirm({ labelId: label.id, contactRecordId })
                }
                onConfirmUnidentified={() =>
                  void handleConfirm({ labelId: label.id, unidentified: true })
                }
                // 🛑 Change CLEARS the answer rather than only re-opening the
                // picker. `confirmLabel` accepts `{ contactRecordId: null,
                // unidentified: false }`, which is the undecided state — and a
                // worker who taps Change and then walks away must not leave a
                // match they had just called wrong standing in the summary.
                onReopen={() =>
                  void handleConfirm({
                    labelId: label.id,
                    contactRecordId: null,
                    unidentified: false,
                    orderRecordId: null,
                  })
                }
                onChooseOrder={(orderRecordId) => {
                  // The order is re-sent alongside the contact it belongs to:
                  // `confirmLabel` takes one whole answer per label, not a patch.
                  const contactRecordId = label.confirmedContactRecordId
                  if (contactRecordId === null) return
                  void handleConfirm({ labelId: label.id, contactRecordId, orderRecordId })
                }}
              />
            ))}

            {/* 🛑 §5.3: the split is visible BEFORE Create, and it is built from
                the answers above rather than from the ladder's guesses. */}
            <ReturnIntakeGroups
              labels={labels}
              groups={groups}
              committedGroupIds={succeededGroupIds}
            />

            {undecidedCount > 0 && (
              <p className='px-1 text-muted-foreground text-xs'>
                {undecidedCount} {undecidedCount === 1 ? 'label is' : 'labels are'} still undecided.
                Creating now leaves {undecidedCount === 1 ? 'it' : 'them'} in this draft, untouched.
              </p>
            )}

            <div className='h-8 shrink-0' />
          </div>
        )}
      </MainPageContent>
    </>
  )
}

/**
 * What actually happened, per group.
 *
 * 🛑 The whole point of this block (§6.3): "three groups where the second failed
 * means two real RMAs exist." Every created return is named and linked, and the
 * failures carry their own reason beside them rather than one toast standing in
 * for all of it.
 */
function CommitResults({
  results,
  groups,
}: {
  results: ReturnIntakeCommitResult[]
  groups: ReturnIntakeGroupView[]
}) {
  const created = results.filter((result) => result.error === null)
  const failed = results.filter((result) => result.error !== null)
  const nameOf = (groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return 'A return'
    if (group.contactRecordId === null) return 'Unidentified sender'
    return group.contactName ?? 'Selected customer'
  }

  return (
    <div className='flex flex-col gap-2 rounded-2xl border p-3' data-testid='commit-results'>
      <span className='font-medium text-sm'>
        {created.length} of {results.length} created
        {failed.length > 0 ? `, ${failed.length} refused` : ''}
      </span>

      <ul className='flex flex-col gap-1.5 text-sm'>
        {results.map((result) => (
          <li
            key={result.groupId}
            data-testid={`result-${result.groupId}`}
            className='flex flex-wrap items-center gap-2'>
            {result.error === null ? (
              <>
                <Check className='size-4 shrink-0 text-green-600' />
                <span className='min-w-0 truncate'>{nameOf(result.groupId)}</span>
                {result.returnRecordId ? (
                  <Link
                    href={`/app/returns?id=${parseRecordId(result.returnRecordId).entityInstanceId}`}
                    className='font-medium underline underline-offset-2'>
                    {result.returnNumber ?? 'Open the return'}
                  </Link>
                ) : (
                  <span className='font-medium'>{result.returnNumber ?? 'Created'}</span>
                )}
              </>
            ) : (
              <>
                <TriangleAlert className='size-4 shrink-0 text-amber-600' />
                <span className='min-w-0 truncate'>{nameOf(result.groupId)}</span>
                <span className='min-w-0 text-muted-foreground text-xs'>{result.error}</span>
              </>
            )}
          </li>
        ))}
      </ul>

      {failed.length > 0 && (
        <p className='text-muted-foreground text-xs'>
          The returns above that were created are real and keep their numbers. Only the refused ones
          are still in this draft; Retry sends just those.
        </p>
      )}
    </div>
  )
}
