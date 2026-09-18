// apps/web/src/components/accounting/hooks/use-journal-entry-draft.ts

'use client'

import type { EntryPreview, PostResult, PostResultStatus } from '@auxx/lib/accounting/ledger/client'
import { didLedgerAccept } from '@auxx/lib/accounting/ledger/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  draftRowsFromLines,
  type JournalLineDraft,
  linesFromDraftRows,
} from '~/components/accounting/ui/journal/journal-lines'
import { api } from '~/trpc/react'

export interface UseJournalEntryDraftOptions {
  /** The record id once it exists server-side; `null` only before that. */
  journalEntryId: string | null
  /** True for `?je=new`, before the draft has been raised. */
  isNew: boolean
  /** `YYYY-MM-DD`. Only read while raising a brand-new draft. */
  defaultDate: string
  /** Fires once, the moment the draft is raised - lets the URL move from `?je=new` to `?je=<id>`. */
  onCreated: (id: string) => void
  /** Fires when Post (or Reverse) actually lands a `GlPosting`. */
  onPosted: (glPostingId: string) => void
  /**
   * What the record IS. Defaults to `manual`.
   *
   * 🛑 Set on CREATE and never afterwards - `journal_entry_kind` is
   * `updatable: false`, because the kind decides the posting type and
   * `doc-number.ts` keys each one differently. `recurring_template` is the
   * stencil the daily sweep copies; it posts nothing, so the drawer that
   * carries this hides Preview and Post rather than offering buttons the
   * server refuses by name.
   */
  kind?: 'manual' | 'recurring_template'
}

export interface JournalEntryDraftState {
  isLoading: boolean
  date: string
  memo: string
  lines: JournalLineDraft[]
  setDate: (date: string) => void
  setMemo: (memo: string) => void
  setLines: (lines: JournalLineDraft[]) => void
  /**
   * `'JNL-0007'` once the record exists. Null while `?je=new` has not minted one.
   *
   * Read-only, and the drawer's Discard confirm is the only reader: a person
   * about to throw a numbered entry away has to be told WHICH number, because
   * the number is what survives the discard.
   */
  number: string | null
  /** `journal_entry.status` of the loaded record, or `'draft'` before it exists. */
  status: 'draft' | 'posted' | 'reversed'
  /** The `GlPosting` this entry became, once posted. `null` while `draft`. */
  glPostingId: string | null
  isSaving: boolean
  saveDraft: () => void
  preview: EntryPreview | null
  isPreviewing: boolean
  /** True once an edit has happened since the last preview - Post stays disabled until this clears. */
  previewIsStale: boolean
  runPreview: () => void
  isPosting: boolean
  runPost: () => void
  postResult: PostResult | null
}

/**
 * Draft state, save, preview and post for the JE drawer - HANDOFF slot 1B item 4.
 *
 * ── When the record behind `?je=new` is raised ──
 *
 * `journalEntry.preview` and `.post` both act on a STORED record
 * (`requireJournalEntry` in `journal-entries/reads.ts`); there is no "preview
 * this thing that does not exist yet" path, by design - the entry's NUMBER is
 * issued on create and becomes the posting's `periodKey`. So `?je=new` must
 * eventually mint a record, and the caller is told the new id so it can replace
 * `new` in the URL.
 *
 * 🛑 But NOT on mount, and NOT on the first edit either any more (accounting
 * migration step 1b). Creating on mount meant every drawer somebody opened and
 * closed again left an "Untitled draft" for $0.00 in the Entries list, with no
 * delete affordance anywhere in the module to clear it up; creating on the
 * first keystroke meant a bare date or memo change - with no lines typed yet -
 * tried to raise a record `createJournalEntry` now refuses outright, since a
 * `GlPosting` cannot hold zero lines (`journal-entries/writes.ts`). The create
 * is therefore deferred to the first press of Save (`createDraft`, called from
 * `saveDraft`), which is also the first moment a refusal is a reasonable thing
 * to show: Preview and Post stay disabled until an id exists, and Save is what
 * produces one.
 *
 * ── Closing the drawer ──
 *
 * 🛑 Below the dock breakpoint the drawer is an overlay whose host keeps it
 * MOUNTED, so this hook has to clear itself: no id and not `new` means "nothing
 * is open", and everything - including `createRequestedRef` - goes back to its
 * initial value. Without that reset the second "New journal entry" of a session
 * showed the first entry's lines with Save, Preview and Post permanently
 * disabled, because the create guard had already been tripped.
 *
 * ── Preview vs Save ──
 *
 * `runPreview` sends the CURRENT unsaved values as overrides - `preview`
 * persists nothing, so it never needs a prior save. `runPost` saves first
 * (whatever is on screen) and then posts, so what gets posted is always
 * exactly what the drawer shows - never a stale save from three edits ago.
 * `previewIsStale` tracks whether an edit happened since the last preview, and
 * the drawer disables Post on it: a "clean" preview from before the bookkeeper
 * added a line is not evidence about the entry as it now stands.
 */
export function useJournalEntryDraft({
  journalEntryId,
  isNew,
  defaultDate,
  onCreated,
  onPosted,
  kind = 'manual',
}: UseJournalEntryDraftOptions): JournalEntryDraftState {
  const utils = api.useUtils()
  const createMutation = api.ledger.journalEntry.create.useMutation()
  const updateMutation = api.ledger.journalEntry.update.useMutation()
  const previewMutation = api.ledger.journalEntry.preview.useMutation()
  const postMutation = api.ledger.journalEntry.post.useMutation()

  const getQuery = api.ledger.journalEntry.get.useQuery(
    { id: journalEntryId ?? '' },
    { enabled: !!journalEntryId }
  )

  const [date, setDateState] = useState(defaultDate)
  const [memo, setMemoState] = useState('')
  const [lines, setLinesState] = useState<JournalLineDraft[]>([])
  const [number, setNumber] = useState<string | null>(null)
  const [status, setStatus] = useState<'draft' | 'posted' | 'reversed'>('draft')
  const [glPostingId, setGlPostingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<EntryPreview | null>(null)
  const [previewIsStale, setPreviewIsStale] = useState(false)
  const [postResult, setPostResult] = useState<PostResult | null>(null)

  // Guards so the load-from-server effect and the raise-a-new-draft path each
  // run at most once per id / per drawer-open. Both are cleared by the reset
  // effect below, which is what makes a SECOND drawer-open behave like the first.
  const loadedIdRef = useRef<string | null>(null)
  const createRequestedRef = useRef(false)

  // Latest props/state, readable from stable callbacks. `saveDraft` reads this
  // rather than closing over `date`/`memo`/`lines` directly, so it stays one
  // stable callback across every keystroke instead of being re-created per one.
  // The kind rides its own ref rather than `latestRef`: `createDraft` spreads
  // `latestRef.current` into its own argument shape, and a fourth key there
  // would have to be threaded through it too.
  const kindRef = useRef(kind)
  kindRef.current = kind

  const latestRef = useRef({ date, memo, lines, defaultDate, isNew, journalEntryId, onCreated })
  latestRef.current = { date, memo, lines, defaultDate, isNew, journalEntryId, onCreated }

  // `defaultDate` deliberately excluded below: it is only the seed for a NEW
  // record and must not re-trigger this load when the viewed period changes
  // under an already-open drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: defaultDate is a seed value, not a reactive dependency of this load
  useEffect(() => {
    const record = getQuery.data
    if (!journalEntryId || !record) return
    if (loadedIdRef.current === journalEntryId) return
    loadedIdRef.current = journalEntryId
    setDateState(record.date ?? defaultDate)
    setMemoState(record.memo ?? '')
    setLinesState(draftRowsFromLines(record.lines))
    setNumber(record.number)
    setStatus(record.status)
    setGlPostingId(record.glPostingId)
    setPreview(null)
    setPreviewIsStale(false)
    setPostResult(null)
  }, [journalEntryId, getQuery.data])

  // 🛑 Nothing unmounts this hook between two entries, so it clears itself.
  //
  // Two transitions mean "start over", and BOTH were broken: `?je=` going away
  // (below the dock breakpoint the overlay host keeps the drawer mounted), and
  // `?je=<id>` going straight back to `?je=new` (the docked panel is inside an
  // `AnimatePresence`, and the two clicks are one param write, so there is no
  // unmount in between either). Without this the second "New journal entry" of
  // a session opened onto the FIRST entry's memo and lines, with Save, Preview
  // and Post disabled for good because `createRequestedRef` was still set.
  useEffect(() => {
    const closed = !journalEntryId && !isNew
    const restarted = isNew && !journalEntryId && createRequestedRef.current
    if (!closed && !restarted) return
    loadedIdRef.current = null
    createRequestedRef.current = false
    setDateState(latestRef.current.defaultDate)
    setMemoState('')
    setLinesState([])
    setNumber(null)
    setStatus('draft')
    setGlPostingId(null)
    setPreview(null)
    setPreviewIsStale(false)
    setPostResult(null)
  }, [journalEntryId, isNew])

  const create = createMutation.mutate
  /**
   * Raise the record behind `?je=new`, on an explicit Save - never on mount
   * and never on the first keystroke (accounting migration step 1b).
   *
   * 🛑 It used to fire on the first edit of ANY field, including a bare date
   * or memo change with no lines at all. `createJournalEntry` now refuses
   * fewer than two balanced lines - `buildManualEntry` always did, and the
   * lib agreed to move that refusal earlier rather than allow a save-nothing
   * draft to exist (see `journal-entries/writes.ts`) - so that first keystroke
   * would toast a refusal before the bookkeeper had typed a single line.
   * Deferring the create to `saveDraft` is what makes "create on first save"
   * the actual first thing this hook attempts, so the refusal (still possible,
   * still a toast - there is no record yet for a blockers card to attach to)
   * lands on a press the bookkeeper made, not one they did not.
   */
  const createDraft = useCallback(
    (next: { date: string; memo: string; lines: JournalLineDraft[] }) => {
      const current = latestRef.current
      if (!current.isNew || current.journalEntryId || createRequestedRef.current) return
      createRequestedRef.current = true
      create(
        {
          date: next.date,
          ...(next.memo ? { memo: next.memo } : {}),
          lines: linesFromDraftRows(next.lines),
          // Only when it is not the default, so an ordinary drawer's create
          // payload is byte-for-byte what it always was.
          ...(kindRef.current === 'manual' ? {} : { kind: kindRef.current }),
        },
        {
          onSuccess: (record) => {
            // Claim the id before the URL moves, so the load-from-server effect
            // does not overwrite what is being typed with the record it just
            // wrote.
            loadedIdRef.current = record.id
            // ⚠️ Claiming the id is exactly why the number has to be taken HERE.
            // `setNumber` otherwise only ever runs in that load effect, which
            // this line has just disabled for this id, so a freshly minted draft
            // kept `number: null` for the life of the drawer and its Discard
            // confirm read "Discard this journal entry?" instead of naming
            // JNL-0011. The create response is the same record that effect would
            // have read.
            setNumber(record.number)
            void utils.ledger.journalEntry.list.invalidate()
            latestRef.current.onCreated(record.id)
          },
          onError: (error) => {
            createRequestedRef.current = false
            toastError({ title: 'Could not start a new journal entry', description: error.message })
          },
        }
      )
    },
    [create, utils]
  )

  // Local state only now - the create used to ride along here (see
  // `createDraft`'s own doc for why that moved to `saveDraft`).
  const setDate = useCallback((next: string) => {
    setDateState(next)
    setPreviewIsStale(true)
    setPostResult(null)
  }, [])
  const setMemo = useCallback((next: string) => {
    setMemoState(next)
    setPreviewIsStale(true)
    setPostResult(null)
  }, [])
  const setLines = useCallback((next: JournalLineDraft[]) => {
    setLinesState(next)
    setPreviewIsStale(true)
    setPostResult(null)
  }, [])

  const update = updateMutation.mutate
  /**
   * The one Save button, for both halves of this record's life: raises it on
   * the first press (`createDraft`), edits it on every press after
   * (`update`). Never both in the same call - `createDraft` is a no-op once
   * `journalEntryId` exists, and this branches on that before either mutation
   * ever fires.
   */
  const saveDraft = useCallback(() => {
    if (!journalEntryId) {
      createDraft(latestRef.current)
      return
    }
    update(
      { id: journalEntryId, date, memo, lines: linesFromDraftRows(lines) },
      {
        // The Entries list renders drafts off `journalEntry.list`, and the
        // drawer re-reads its own record from `.get` - both are stale the
        // instant this lands.
        onSuccess: () => {
          void utils.ledger.journalEntry.list.invalidate()
          void utils.ledger.journalEntry.get.invalidate({ id: journalEntryId })
        },
        onError: (error) =>
          toastError({ title: 'Could not save the draft', description: error.message }),
      }
    )
  }, [journalEntryId, date, memo, lines, update, utils, createDraft])

  const runPreviewMutate = previewMutation.mutate
  const runPreview = useCallback(() => {
    if (!journalEntryId) return
    runPreviewMutate(
      { id: journalEntryId, date, memo, lines: linesFromDraftRows(lines) },
      {
        onSuccess: (result) => {
          setPreview(result)
          setPreviewIsStale(false)
        },
        onError: (error) =>
          toastError({ title: 'Could not build the entry', description: error.message }),
      }
    )
  }, [journalEntryId, date, memo, lines, runPreviewMutate])

  // A dedicated flag rather than reading `updateMutation.isPending`: that
  // mutation is shared with `saveDraft`, and a plain "Save draft" click must
  // not make the Post button read as posting.
  const [isPostFlowPending, setIsPostFlowPending] = useState(false)

  const postMutate = postMutation.mutate
  const runPost = useCallback(() => {
    if (!journalEntryId) return
    setIsPostFlowPending(true)
    // Save whatever is on screen first, so Post always posts exactly what the
    // drawer shows - see this hook's own doc.
    update(
      { id: journalEntryId, date, memo, lines: linesFromDraftRows(lines) },
      {
        onSuccess: () => {
          postMutate(
            { id: journalEntryId },
            {
              onSuccess: (result) => {
                setIsPostFlowPending(false)
                setPostResult(result)
                if (didLedgerAccept(result) && result.glPostingId) {
                  setStatus('posted')
                  setGlPostingId(result.glPostingId)
                  void utils.ledger.listPostings.invalidate()
                  void utils.ledger.journalEntry.list.invalidate()
                  void utils.ledger.journalEntry.get.invalidate({ id: journalEntryId })
                  void utils.ledger.periods.invalidate()
                  onPosted(result.glPostingId)
                }
              },
              onError: (error) => {
                setIsPostFlowPending(false)
                toastError({ title: 'The post could not be sent', description: error.message })
              },
            }
          )
        },
        onError: (error) => {
          setIsPostFlowPending(false)
          toastError({ title: 'Could not save the draft', description: error.message })
        },
      }
    )
  }, [journalEntryId, date, memo, lines, update, postMutate, utils, onPosted])

  return {
    isLoading: !!journalEntryId && getQuery.isPending,
    date,
    memo,
    lines,
    setDate,
    setMemo,
    setLines,
    number,
    status,
    glPostingId,
    isSaving: updateMutation.isPending || createMutation.isPending,
    saveDraft,
    preview,
    isPreviewing: previewMutation.isPending,
    previewIsStale,
    runPreview,
    isPosting: isPostFlowPending,
    runPost,
    postResult,
  }
}
