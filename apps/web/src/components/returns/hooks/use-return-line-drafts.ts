// apps/web/src/components/returns/hooks/use-return-line-drafts.ts
'use client'

// The small draft machinery behind a hand-added return line
// (plans/money/tasks/56-return-lines-on-the-line-grid.md §4.4), much smaller
// than the line-builder's (line-builder.tsx §"Draft lifecycle"), because a
// return carries one to four lines rather than thirty, and `return_line.part`
// is ALWAYS required: there is no `draftRequiresPart` gate to thread, every
// draft needs a part before it can become a record.
//
// A draft is local-only until its PART is picked (`pickPart`): that call
// fires the only `record.create` this hook ever makes, carrying every value
// the draft accumulated so far (`return_line_return` preset to the host,
// quantity, condition, liability). `record.create` runs the system pre-hook
// chain, so `checkReturnLineAgainstSoldLine` refuses an over-return here
// exactly as it does everywhere else: the refusal is a 422 this hook toasts,
// leaving the draft in place for another attempt.
//
// Deliberately NOT ported from `line-builder.tsx`: the in-flight edit flush,
// the seeded initial placeholders, and group explode. A four-line card can
// simply disable a draft's cells for the one round trip its create takes. An
// untouched draft is plain `useState` and vanishes on its own once the card
// unmounts, so nothing here has to clean it up.

import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { useCallback, useRef, useState } from 'react'
import {
  type CreatedRecordInstance,
  useSeedCreatedRecord,
} from '~/components/resources/hooks/use-seed-created-record'
import type { RecordId } from '~/components/resources/store'
import { api } from '~/trpc/react'

/** A local-only return line, before its part pick materializes the record. */
export interface ReturnLineDraft {
  draftId: string
  partRecordId: RecordId | null
  quantity: number
  conditionGrade: string | null
  liability: string | null
  /** True while the part pick's `record.create` is in flight (the row disables its cells). */
  creating: boolean
}

/** A fresh draft, matching plan §4.4's shape. */
export function freshReturnLineDraft(draftId: string): ReturnLineDraft {
  return {
    draftId,
    partRecordId: null,
    quantity: 1,
    conditionGrade: null,
    liability: null,
    creating: false,
  }
}

interface UseReturnLineDraftsOptions {
  /** `return_line`'s EntityDefinition id; undefined skips every create. */
  entityDefinitionId: string | undefined
  /** The host return, preset onto every draft's `return_line_return`. */
  returnRecordId: RecordId
  /** Seed the record + list caches once a draft's create resolves. */
  onCreated: (params: { recordId: RecordId; instance: CreatedRecordInstance }) => void
}

interface UseReturnLineDraftsResult {
  drafts: ReturnLineDraft[]
  /** The draft to autofocus on its part cell, set by {@link addLine}. */
  lastAddedDraftId: string | null
  /** Push a fresh draft: the header `+`, or nav past the last row. */
  addLine: () => void
  /** Local-only edit: accumulates on the draft until the part pick fires the create. */
  updateDraft: (draftId: string, patch: Partial<ReturnLineDraft>) => void
  /** The part pick: materializes the draft into a real `return_line`. */
  pickPart: (draftId: string, partRecordId: RecordId) => void
  /** Trash a draft locally: no network, nothing to undo. */
  deleteDraft: (draftId: string) => void
}

/**
 * Draft rows for the return lines card: local state until a part is picked,
 * then one `record.create` materializes the row. See the file doc for what
 * this deliberately does not carry over from the line-builder's own version.
 */
export function useReturnLineDrafts({
  entityDefinitionId,
  returnRecordId,
  onCreated,
}: UseReturnLineDraftsOptions): UseReturnLineDraftsResult {
  const [drafts, setDrafts] = useState<ReturnLineDraft[]>([])
  const [lastAddedDraftId, setLastAddedDraftId] = useState<string | null>(null)
  // Ref-guarded so a synchronous double-pick can never fire two creates for
  // the same draft before React re-renders (the money `createDraft` precedent).
  const creatingDraftIdsRef = useRef<Set<string>>(new Set())
  const draftsRef = useRef<ReturnLineDraft[]>([])
  draftsRef.current = drafts

  const { mutateAsync: createMutateAsync } = api.record.create.useMutation()
  const { seedCreatedRecord } = useSeedCreatedRecord()

  const addLine = useCallback(() => {
    const draft = freshReturnLineDraft(generateId())
    setLastAddedDraftId(draft.draftId)
    setDrafts((prev) => [...prev, draft])
  }, [])

  const updateDraft = useCallback((draftId: string, patch: Partial<ReturnLineDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, ...patch } : d)))
  }, [])

  const deleteDraft = useCallback((draftId: string) => {
    creatingDraftIdsRef.current.delete(draftId)
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
  }, [])

  const pickPart = useCallback(
    (draftId: string, partRecordId: RecordId) => {
      if (!entityDefinitionId || creatingDraftIdsRef.current.has(draftId)) return
      const draft = draftsRef.current.find((d) => d.draftId === draftId)
      if (!draft) return

      creatingDraftIdsRef.current.add(draftId)
      setDrafts((prev) =>
        prev.map((d) => (d.draftId === draftId ? { ...d, partRecordId, creating: true } : d))
      )

      const values: Record<string, unknown> = {
        return_line_return: returnRecordId,
        return_line_part: partRecordId,
        return_line_quantity: draft.quantity,
      }
      if (draft.conditionGrade) values.return_line_condition_grade = draft.conditionGrade
      if (draft.liability) values.return_line_liability = draft.liability

      createMutateAsync({ entityDefinitionId, values })
        .then((result) => {
          seedCreatedRecord({
            entityDefinitionId,
            recordId: result.recordId,
            instance: result.instance,
            values: [
              { fieldId: 'return_line_part', value: partRecordId },
              { fieldId: 'return_line_quantity', value: draft.quantity },
              ...(draft.conditionGrade
                ? [{ fieldId: 'return_line_condition_grade', value: draft.conditionGrade }]
                : []),
              ...(draft.liability
                ? [{ fieldId: 'return_line_liability', value: draft.liability }]
                : []),
            ],
          })
          creatingDraftIdsRef.current.delete(draftId)
          onCreated({ recordId: result.recordId, instance: result.instance })
          setDrafts((prev) => prev.filter((d) => d.draftId !== draftId))
        })
        .catch((error: unknown) => {
          creatingDraftIdsRef.current.delete(draftId)
          setDrafts((prev) =>
            prev.map((d) => (d.draftId === draftId ? { ...d, creating: false } : d))
          )
          toastError({
            title: 'Error adding line',
            description: error instanceof Error ? error.message : 'Could not add the line',
          })
        })
    },
    [entityDefinitionId, returnRecordId, createMutateAsync, seedCreatedRecord, onCreated]
  )

  return { drafts, lastAddedDraftId, addLine, updateDraft, pickPart, deleteDraft }
}
