// apps/web/src/components/manufacturing/builds/build-sheet-fields.tsx
'use client'

import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Input } from '@auxx/ui/components/input'
import type { KeyboardEvent, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api, type RouterOutputs } from '~/trpc/react'

type BuildSheetData = NonNullable<RouterOutputs['builds']['get']>

// The sheet's inline edits save on blur with an immediate `onChange`, not through
// `FieldInputAdapter`: its text input reports after a 300 ms debounce, so a blur could save stale text.

export function DetailText({ children }: { children: ReactNode }) {
  return <span className='block truncate px-2 py-1 text-sm'>{children}</span>
}

/** Enter commits by blurring, so a save has exactly one path. */
function blurOnEnter(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    event.currentTarget.blur()
  }
}

/** Blank notes are stored as null, as `updateBuildNotes` does. */
const toNotes = (value: string) => (value.trim() ? value : null)

export function BuildNotesRow({ build, canManage }: { build: BuildSheetData; canManage: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const saving = useRef(false)
  const utils = api.useUtils()
  const updateNotes = api.builds.updateNotes.useMutation({
    onSuccess: (saved, sent) => {
      utils.builds.get.setData({ buildId: build.buildId }, (prev) =>
        prev ? { ...prev, ...saved } : prev
      )
      // Keep anything typed while the save was in flight.
      setDraft((current) => (current !== null && toNotes(current) === sent.notes ? null : current))
    },
    onSettled: () => {
      saving.current = false
    },
  })

  const save = () => {
    if (draft === null || saving.current) return
    const notes = toNotes(draft)
    if (notes === (build.notes ?? null)) {
      setDraft(null)
      return
    }
    saving.current = true
    updateNotes.mutate({ buildId: build.buildId, notes })
  }

  return (
    <FieldPanelRow
      title='Notes'
      type={BaseType.STRING}
      showIcon
      validationError={updateNotes.error?.message}>
      {canManage ? (
        <AutosizeTextarea
          aria-label='Build notes'
          minHeight={1}
          value={draft ?? build.notes ?? ''}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={blurOnEnter}
          placeholder='Add a note'
          className='resize-none border-none bg-transparent px-2 py-1 dark:bg-transparent'
        />
      ) : (
        <DetailText>{build.notes || '—'}</DetailText>
      )}
    </FieldPanelRow>
  )
}

/** A planned build's quantity, edited in place; `amendPlannedBuildQuantity` refuses any other status. */
export function BuildQuantityRow({ build }: { build: BuildSheetData }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const saving = useRef(false)
  const utils = api.useUtils()
  const amend = api.builds.amendQuantity.useMutation({
    onSuccess: (saved, sent) => {
      utils.builds.get.setData({ buildId: build.buildId }, (prev) =>
        prev ? { ...prev, ...saved } : prev
      )
      setDraft((current) =>
        current !== null && Number(current) === sent.quantityPlanned ? null : current
      )
      void utils.builds.list.invalidate()
      void utils.mrp.partItem.invalidate()
    },
    onSettled: () => {
      saving.current = false
    },
  })

  const save = () => {
    if (draft === null || saving.current) return
    const quantity = Number(draft)
    if (!draft.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (quantity === build.quantityPlanned) {
      setDraft(null)
      return
    }
    saving.current = true
    amend.mutate({ buildId: build.buildId, quantityPlanned: quantity })
  }

  return (
    <FieldPanelRow
      title='Planned quantity'
      type={BaseType.NUMBER}
      showIcon
      validationError={invalid ? 'Enter a quantity above zero' : amend.error?.message}>
      <Input
        aria-label='Planned quantity'
        type='number'
        inputMode='decimal'
        min={0}
        step='any'
        value={draft ?? String(build.quantityPlanned ?? '')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={blurOnEnter}
        className='h-8 border-none bg-transparent px-2 py-1 shadow-none dark:bg-transparent'
      />
    </FieldPanelRow>
  )
}
