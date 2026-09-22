// apps/web/src/components/accounting/hooks/use-journal-entry-draft.ts

'use client'

import type {
  JournalEntryKindValue,
  JournalEntryRecord,
} from '@auxx/lib/accounting/journals/client'
import type { EntryPreview, PostResult } from '@auxx/lib/accounting/ledger/client'
import { didLedgerAccept } from '@auxx/lib/accounting/ledger/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  draftRowsFromLines,
  type JournalLineDraft,
  linesFromDraftRows,
  withSavedLineIds,
} from '~/components/accounting/ui/journal/journal-lines'
import { api } from '~/trpc/react'

export interface UseJournalEntryDraftOptions {
  /** The record id once it exists server-side; `null` only before that. */
  journalEntryId: string | null
  /** True for `?je=new`, before the record has been created. */
  isNew: boolean
  /** `YYYY-MM-DD`. Only read while starting a brand-new entry. */
  defaultDate: string
  /** Fires once, when the first Save creates the record - lets the URL move to `?je=<id>`. */
  onCreated: (id: string) => void
  /** Fires when Post actually lands a `GlPosting`. */
  onPosted: (glPostingId: string) => void
  /** What a NEW record is created as. `journal_entry_kind` is `updatable: false`. */
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
  /** `'JNL-0007'` once the record exists; the Discard and Void confirms name it. */
  number: string | null
  /** The loaded record's kind, or the `kind` option before it exists. */
  kind: JournalEntryKindValue
  /** The document's own status: `draft` until Post, then its posting's. */
  status: 'draft' | 'posted' | 'reversed'
  /** The `GlPosting` this entry became, once posted. `null` while `draft`. */
  glPostingId: string | null
  /** A posted entry held open by `documentEdit`; its lines are editable until Save or Cancel. */
  editing: boolean
  isSaving: boolean
  /** Creates the record on the first press, updates it after. */
  save: () => void
  preview: EntryPreview | null
  isPreviewing: boolean
  /** True once an edit has happened since the last preview - Post stays disabled until this clears. */
  previewIsStale: boolean
  runPreview: () => void
  isPosting: boolean
  runPost: () => void
  isVoiding: boolean
  runVoid: () => void
  /** Open, save or cancel the edit-in-place lane on a posted manual entry. */
  openEdit: () => void
  saveEdit: () => void
  cancelEdit: () => void
  isEditPending: boolean
  /** The last Post or Void outcome; a refusal renders as a blockers card. */
  postResult: PostResult | null
}

/**
 * Document state and actions for the JE drawer (91 D5). No record is created on
 * open: the first Save creates it (and issues the number Preview and Post need).
 * Every save sends the rows with their line ids and stamps the returned ids back,
 * so the server keeps, creates and deletes lines by id. `runPost` saves what is on
 * screen, then posts. The overlay host keeps this mounted, so it resets itself
 * when the drawer closes or restarts at `?je=new`.
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
  const reverseMutation = api.ledger.journalEntry.reverse.useMutation()
  const openEditMutation = api.documentEdit.open.useMutation()
  const saveEditMutation = api.documentEdit.save.useMutation()
  const cancelEditMutation = api.documentEdit.cancel.useMutation()

  const getQuery = api.ledger.journalEntry.get.useQuery(
    { id: journalEntryId ?? '' },
    { enabled: !!journalEntryId }
  )

  const [date, setDateState] = useState(defaultDate)
  const [memo, setMemoState] = useState('')
  const [lines, setLinesState] = useState<JournalLineDraft[]>([])
  const [number, setNumber] = useState<string | null>(null)
  const [recordKind, setRecordKind] = useState<JournalEntryKindValue>(kind)
  const [status, setStatus] = useState<'draft' | 'posted' | 'reversed'>('draft')
  const [glPostingId, setGlPostingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<EntryPreview | null>(null)
  const [previewIsStale, setPreviewIsStale] = useState(false)
  const [postResult, setPostResult] = useState<PostResult | null>(null)

  const editTarget = useMemo(
    () => ({ family: 'journal_entry' as const, recordId: journalEntryId ?? '' }),
    [journalEntryId]
  )
  // Only a posted manual entry can be held open; `spec.ts` refuses every other kind.
  const editStateQuery = api.documentEdit.readState.useQuery(editTarget, {
    enabled: !!journalEntryId && status === 'posted' && recordKind === 'manual',
  })
  const editing = status === 'posted' && !!editStateQuery.data?.edit

  // Once per id / per drawer-open; the reset effect clears both.
  const loadedIdRef = useRef<string | null>(null)
  const createRequestedRef = useRef(false)

  // Read by the stable save callbacks so they are not re-created per keystroke.
  const latestRef = useRef({
    date,
    memo,
    lines,
    defaultDate,
    isNew,
    journalEntryId,
    onCreated,
    kind,
  })
  latestRef.current = { date, memo, lines, defaultDate, isNew, journalEntryId, onCreated, kind }

  const applyRecord = useCallback((record: JournalEntryRecord) => {
    loadedIdRef.current = record.id
    setDateState(record.date ?? latestRef.current.defaultDate)
    setMemoState(record.memo ?? '')
    setLinesState(draftRowsFromLines(record.lines))
    setNumber(record.number)
    setRecordKind(record.kind)
    setStatus(record.status)
    setGlPostingId(record.glPostingId)
    setPreview(null)
    setPreviewIsStale(false)
    setPostResult(null)
  }, [])

  useEffect(() => {
    const record = getQuery.data
    if (!journalEntryId || !record) return
    if (loadedIdRef.current === journalEntryId) return
    applyRecord(record)
  }, [journalEntryId, getQuery.data, applyRecord])

  // The overlay host keeps this mounted across entries, and `?je=<id>` -> `?je=new`
  // is one param write with no unmount between, so both transitions start over here.
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
    setRecordKind(latestRef.current.kind)
    setStatus('draft')
    setGlPostingId(null)
    setPreview(null)
    setPreviewIsStale(false)
    setPostResult(null)
  }, [journalEntryId, isNew])

  /** Re-read the record from the server and replace what is on screen with it. */
  const reload = useCallback(async () => {
    if (!journalEntryId) return
    const record = await utils.ledger.journalEntry.get.fetch(
      { id: journalEntryId },
      { staleTime: 0 }
    )
    if (record) applyRecord(record)
  }, [journalEntryId, utils, applyRecord])

  /** Everything that reads the books moves when an entry posts, voids or reposts. */
  const refreshBooks = useCallback(() => {
    void utils.ledger.listPostings.invalidate()
    void utils.ledger.journalEntry.list.invalidate()
    void utils.ledger.periods.invalidate()
    void utils.ledger.verifyBalance.invalidate()
    void utils.ledgerReports.invalidate()
  }, [utils])

  const create = createMutation.mutate
  /** Create the record behind `?je=new`, on the first Save only. */
  const createEntry = useCallback(() => {
    const current = latestRef.current
    if (!current.isNew || current.journalEntryId || createRequestedRef.current) return
    createRequestedRef.current = true
    const sent = current.lines
    create(
      {
        date: current.date,
        ...(current.memo ? { memo: current.memo } : {}),
        lines: linesFromDraftRows(sent),
        ...(current.kind === 'manual' ? {} : { kind: current.kind }),
      },
      {
        onSuccess: (record) => {
          // Claimed before the URL moves, so the load effect does not overwrite what is being typed.
          loadedIdRef.current = record.id
          setNumber(record.number)
          setRecordKind(record.kind)
          setLinesState((prev) => withSavedLineIds(prev, sent, record.lines))
          utils.ledger.journalEntry.get.setData({ id: record.id }, record)
          void utils.ledger.journalEntry.list.invalidate()
          latestRef.current.onCreated(record.id)
        },
        onError: (error) => {
          createRequestedRef.current = false
          toastError({ title: 'Could not create the journal entry', description: error.message })
        },
      }
    )
  }, [create, utils])

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
  /** Write what is on screen, then stamp the returned line ids onto the rows that were sent. */
  const saveCurrent = useCallback(
    (id: string, onSaved?: () => void, onFailed?: () => void) => {
      const { date: sentDate, memo: sentMemo, lines: sent } = latestRef.current
      update(
        { id, date: sentDate, memo: sentMemo, lines: linesFromDraftRows(sent) },
        {
          onSuccess: (record) => {
            setLinesState((prev) => withSavedLineIds(prev, sent, record.lines))
            utils.ledger.journalEntry.get.setData({ id }, record)
            void utils.ledger.journalEntry.list.invalidate()
            onSaved?.()
          },
          onError: (error) => {
            onFailed?.()
            toastError({ title: 'Could not save the journal entry', description: error.message })
          },
        }
      )
    },
    [update, utils]
  )

  const save = useCallback(() => {
    if (journalEntryId) saveCurrent(journalEntryId)
    else createEntry()
  }, [journalEntryId, saveCurrent, createEntry])

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

  // Its own flag: `update` is shared with Save, and Save must not read as posting.
  const [isPostFlowPending, setIsPostFlowPending] = useState(false)

  const postMutate = postMutation.mutate
  const runPost = useCallback(() => {
    if (!journalEntryId) return
    setIsPostFlowPending(true)
    const failed = () => setIsPostFlowPending(false)
    saveCurrent(
      journalEntryId,
      () =>
        postMutate(
          { id: journalEntryId },
          {
            onSuccess: (result) => {
              setIsPostFlowPending(false)
              setPostResult(result)
              if (didLedgerAccept(result) && result.glPostingId) {
                setStatus('posted')
                setGlPostingId(result.glPostingId)
                void utils.ledger.journalEntry.get.invalidate({ id: journalEntryId })
                refreshBooks()
                onPosted(result.glPostingId)
              }
            },
            onError: (error) => {
              failed()
              toastError({ title: 'The entry was not posted', description: error.message })
            },
          }
        ),
      failed
    )
  }, [journalEntryId, saveCurrent, postMutate, utils, refreshBooks, onPosted])

  const reverseMutate = reverseMutation.mutate
  /** A refused Void is a `PostResult`, rendered as a blockers card rather than thrown. */
  const runVoid = useCallback(() => {
    if (!journalEntryId) return
    reverseMutate(
      { id: journalEntryId },
      {
        onSuccess: (result) => {
          setPostResult(result)
          if (!didLedgerAccept(result)) return
          setStatus('reversed')
          void utils.ledger.journalEntry.get.invalidate({ id: journalEntryId })
          refreshBooks()
        },
        onError: (error) =>
          toastError({ title: 'The entry was not voided', description: error.message }),
      }
    )
  }, [journalEntryId, reverseMutate, utils, refreshBooks])

  const setEditStamp = useCallback(
    (edit: NonNullable<typeof editStateQuery.data>['edit']) =>
      utils.documentEdit.readState.setData(editTarget, (prev) => prev && { ...prev, edit }),
    [utils, editTarget]
  )

  const openEditMutate = openEditMutation.mutate
  const openEdit = useCallback(() => {
    if (!journalEntryId) return
    openEditMutate(editTarget, {
      onSuccess: (edit) => setEditStamp(edit),
      onError: (error) =>
        toastError({ title: 'Could not open the entry for editing', description: error.message }),
    })
  }, [journalEntryId, editTarget, openEditMutate, setEditStamp])

  const saveEditMutate = saveEditMutation.mutate
  /** Save the lines, then let the lane reverse and repost if they changed the entry. */
  const saveEdit = useCallback(() => {
    if (!journalEntryId) return
    saveCurrent(journalEntryId, () =>
      saveEditMutate(editTarget, {
        onSuccess: () => {
          setEditStamp(null)
          void reload()
          refreshBooks()
        },
        onError: (error) =>
          toastError({ title: 'Could not save the change', description: error.message }),
      })
    )
  }, [journalEntryId, editTarget, saveCurrent, saveEditMutate, setEditStamp, reload, refreshBooks])

  const cancelEditMutate = cancelEditMutation.mutate
  /** Restore the snapshot taken at Edit; the ledger was never touched. */
  const cancelEdit = useCallback(() => {
    if (!journalEntryId) return
    cancelEditMutate(editTarget, {
      onSuccess: () => {
        setEditStamp(null)
        void reload()
        void utils.ledger.journalEntry.list.invalidate()
      },
      onError: (error) =>
        toastError({ title: 'Could not cancel the edit', description: error.message }),
    })
  }, [journalEntryId, editTarget, cancelEditMutate, setEditStamp, reload, utils])

  return {
    isLoading: !!journalEntryId && getQuery.isPending,
    date,
    memo,
    lines,
    setDate,
    setMemo,
    setLines,
    number,
    kind: recordKind,
    status,
    glPostingId,
    editing,
    isSaving: updateMutation.isPending || createMutation.isPending,
    save,
    preview,
    isPreviewing: previewMutation.isPending,
    previewIsStale,
    runPreview,
    isPosting: isPostFlowPending,
    runPost,
    isVoiding: reverseMutation.isPending,
    runVoid,
    openEdit,
    saveEdit,
    cancelEdit,
    isEditPending:
      openEditMutation.isPending || saveEditMutation.isPending || cancelEditMutation.isPending,
    postResult,
  }
}
