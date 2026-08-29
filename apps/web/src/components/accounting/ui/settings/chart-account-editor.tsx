// apps/web/src/components/accounting/ui/settings/chart-account-editor.tsx
'use client'

// The right column of the Chart of accounts tab: a `FieldPanel` form for the
// selected `gl_account` row.
//
// 🛑 AUTOSAVES PER FIELD. No submit button and no dialog, exactly like
// `ProductEditor` — `gl_account` stayed an `EntityInstance` under `G6` partly
// because a chart is "a record a person maintains", and `catalog_item` is the
// same kind of row, so the products pattern applies line for line.
//
// 🛑 PLACEHOLDER: every commit here writes LOCAL STATE. There is no procedure
// that reads or writes a `gl_account` through this surface yet. The real
// version routes a committed row through `useSaveFieldValue` (the same
// optimistic path record detail views use) and a draft's first commit through
// `record.create` on the `gl_account` definition. The shape of the code below
// is already that shape, so swapping the two callbacks is the whole change.

import { FieldType } from '@auxx/database/enums'
import type { GlAccountTypeValue } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { ACCOUNT_TYPE_OPTIONS, type ChartAccount, type ChartDraftHandle } from './accounts-types'

/**
 * ⚠️ Renumbering after postings exist does NOT rewrite history, and the code
 * field has to say so. A posting line names an account by CODE with no foreign
 * key, deliberately, so the ledger outlives the chart. That is a feature, and
 * it means a renumber silently detaches old lines from the row on screen.
 */
const RENUMBER_NOTE =
  'Renumbering does not rewrite history. A posted line stores the account code with no ' +
  'foreign key, on purpose, so the ledger outlives the chart. Lines already posted keep the ' +
  'old code and will no longer point at this row.'

const CODE_DESCRIPTION = 'The account number. Unique across the chart, and yours to change.'

/** `FocusableInputWrapper` autofocuses once `open` is truthy; a stable no-op
 *  keeps the effect from refiring every render. */
function noop() {}

/** SINGLE_SELECT hands back an array; normalize at the boundary. */
function firstSelected(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) || null
}

interface ChartAccountEditorProps {
  selectedId: string | null
  accounts: ChartAccount[]
  /** True once anything has posted, which is when the renumber note matters. */
  postingsExist: boolean
  /** Is this code already taken by a different row? Drives the on-field error. */
  isCodeTaken: (code: string, exceptId: string | null) => boolean
  onUpdate: (id: string, patch: Partial<Omit<ChartAccount, 'id'>>) => void
  /** Phantom draft for this tab, owned by `accounts-settings-page.tsx`. */
  draft: ChartDraftHandle | null
  /** List phantom-row preview sync, fired per debounced commit. */
  onDraftChange: (patch: { code?: string; name?: string }) => void
  /** Creates the row and returns its id. PLACEHOLDER for `record.create`. */
  onCreate: (values: Omit<ChartAccount, 'id'>) => Promise<string>
  /** First create resolved: swap `selectedId` to the real id, KEEPING the draft. */
  onDraftCommitted: (recordId: string) => void
}

export function ChartAccountEditor({
  selectedId,
  accounts,
  postingsExist,
  isCodeTaken,
  onUpdate,
  draft,
  onDraftChange,
  onCreate,
  onDraftCommitted,
}: ChartAccountEditorProps) {
  // The draft form also stays active while `selectedId` is the draft's
  // committed recordId. Swapping to the committed form would remount the inputs
  // mid-typing: replaced text and a cancelled debounce timer.
  const draftActive =
    !!draft && (selectedId === draft.draftId || (!!draft.recordId && selectedId === draft.recordId))

  if (draft && draftActive) {
    return (
      <ChartAccountDraftForm
        key={draft.draftId}
        postingsExist={postingsExist}
        isCodeTaken={isCodeTaken}
        onDraftChange={onDraftChange}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDraftCommitted={onDraftCommitted}
      />
    )
  }

  const account = selectedId ? accounts.find((row) => row.id === selectedId) : undefined

  if (!account) {
    return <div className='p-4 text-muted-foreground text-sm'>Select an account to edit.</div>
  }

  return (
    <ChartAccountForm
      key={account.id}
      account={account}
      postingsExist={postingsExist}
      isCodeTaken={isCodeTaken}
      onUpdate={onUpdate}
    />
  )
}

function ChartAccountForm({
  account,
  postingsExist,
  isCodeTaken,
  onUpdate,
}: {
  account: ChartAccount
  postingsExist: boolean
  isCodeTaken: (code: string, exceptId: string | null) => boolean
  onUpdate: (id: string, patch: Partial<Omit<ChartAccount, 'id'>>) => void
}) {
  const [code, setCode] = useState(account.code)
  const [name, setName] = useState(account.name)
  const [codeError, setCodeError] = useState<string | undefined>(undefined)

  const commitCode = useDebouncedCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      setCodeError('An account needs a number.')
      return
    }
    // 🛑 `gl_account.code` is `isUnique: true`, enforced by a query-then-write
    // application check. A conflict surfaces HERE, on the code field, because
    // "4000 is already in use" is the whole of what the person needs. A generic
    // toast would make them hunt for which field went wrong.
    if (isCodeTaken(trimmed, account.id)) {
      setCodeError(`${trimmed} is already in use.`)
      return
    }
    setCodeError(undefined)
    onUpdate(account.id, { code: trimmed })
  }, 500)

  const commitName = useDebouncedCallback((value: string) => {
    if (!value.trim()) return
    onUpdate(account.id, { name: value.trim() })
  }, 500)

  return (
    // `min-h-0` + `ScrollArea`: this editor sits inside a sticky pane capped at
    // the viewport height (`accounts-settings-page.tsx`), so a form taller than
    // that must scroll ITSELF. Without this it is clipped with no indication
    // there is anything below.
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <FieldPanel
          orientation='horizontal'
          breakpoint='md'
          resizeId='gl-account-form'
          defaultLabelWidth={160}
          className='p-0'>
          <FieldPanelRow
            title='Code'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={codeError}
            description={postingsExist ? `${CODE_DESCRIPTION} ${RENUMBER_NOTE}` : CODE_DESCRIPTION}>
            <div className='w-full'>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={code}
                onChange={(value) => {
                  setCode(value as string)
                  commitCode(value as string)
                }}
                placeholder='1310'
              />
              {postingsExist && (
                <p className='px-2 pb-1 text-muted-foreground text-xs'>{RENUMBER_NOTE}</p>
              )}
            </div>
          </FieldPanelRow>

          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              onChange={(value) => {
                setName(value as string)
                commitName(value as string)
              }}
              placeholder='Inventory'
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Type'
            type={BaseType.ENUM}
            showIcon
            description='The statement classification. A role can only be mapped to an account of the type it declares.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: ACCOUNT_TYPE_OPTIONS }}
              value={[account.accountType]}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              onChange={(value) => {
                const next = firstSelected(value)
                if (next) onUpdate(account.id, { accountType: next as GlAccountTypeValue })
              }}
              placeholder='Select type'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Active' type={BaseType.BOOLEAN} showIcon>
            <div className='flex flex-1 items-center gap-2'>
              <FieldInputAdapter
                fieldType={FieldType.CHECKBOX}
                fieldOptions={{ variant: 'switch' }}
                value={account.isActive}
                onChange={(value) => onUpdate(account.id, { isActive: value as boolean })}
              />
              {!account.isActive && (
                <Badge variant='outline' size='xs' className='shrink-0'>
                  Inactive
                </Badge>
              )}
            </div>
          </FieldPanelRow>
        </FieldPanel>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft (phantom) editor: same layout, local state instead of the row.
// ─────────────────────────────────────────────────────────────────────────────

interface ChartDraftValues {
  code: string
  name: string
  accountType: GlAccountTypeValue
  isActive: boolean
}

function freshDraftValues(): ChartDraftValues {
  return { code: '', name: '', accountType: 'asset', isActive: true }
}

/**
 * Draft-mode form.
 *
 * Creation is GATED on both `code` and `name` being non-empty: a chart row with
 * no number is meaningless and the number is the unique key, so a placeholder
 * must never be persisted. Edits before then merge into local state at zero
 * network cost.
 */
function ChartAccountDraftForm({
  postingsExist,
  isCodeTaken,
  onDraftChange,
  onCreate,
  onUpdate,
  onDraftCommitted,
}: {
  postingsExist: boolean
  isCodeTaken: (code: string, exceptId: string | null) => boolean
  onDraftChange: (patch: { code?: string; name?: string }) => void
  onCreate: (values: Omit<ChartAccount, 'id'>) => Promise<string>
  onUpdate: (id: string, patch: Partial<Omit<ChartAccount, 'id'>>) => void
  onDraftCommitted: (recordId: string) => void
}) {
  const valuesRef = useRef<ChartDraftValues>(freshDraftValues())
  const [values, setValues] = useState<ChartDraftValues>(valuesRef.current)

  // 🛑 Guard one: a SYNCHRONOUS ref, not state-derived. Two commits landing
  // before a re-render (a debounced name flushing while the type select fires,
  // say) would both read the same stale state and race two creates for one
  // draft, leaving a duplicate row that then loses the unique-code race.
  const creatingRef = useRef(false)

  // 🛑 Guard two: set the moment the create resolves. This form STAYS MOUNTED
  // afterwards (the page keeps the draft alive, see `onDraftCommitted`) and
  // every later commit routes straight to the committed row through this id.
  // A remount here would replace the input's text with the create snapshot and
  // cancel the pending debounce timer, losing whatever was typed during the
  // round trip.
  const recordIdRef = useRef<string | null>(null)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>(undefined)

  const createNow = useCallback(
    async (snapshot: ChartDraftValues) => {
      try {
        const recordId = await onCreate({
          code: snapshot.code.trim(),
          name: snapshot.name.trim(),
          accountType: snapshot.accountType,
          isActive: snapshot.isActive,
        })

        // Flip the commit target FIRST: a keystroke landing while the diff
        // flush below runs must route to the real row, not the buffered path.
        recordIdRef.current = recordId

        // Whatever landed locally while the create was in flight.
        const latest = valuesRef.current
        const patch: Partial<Omit<ChartAccount, 'id'>> = {}
        if (latest.code.trim() !== snapshot.code.trim()) patch.code = latest.code.trim()
        if (latest.name.trim() !== snapshot.name.trim()) patch.name = latest.name.trim()
        if (latest.accountType !== snapshot.accountType) patch.accountType = latest.accountType
        if (latest.isActive !== snapshot.isActive) patch.isActive = latest.isActive
        if (Object.keys(patch).length > 0) onUpdate(recordId, patch)

        onDraftCommitted(recordId)
      } catch (error) {
        creatingRef.current = false
        toastError({
          title: 'Error creating account',
          description: error instanceof Error ? error.message : 'Could not create the account',
        })
      }
    },
    [onCreate, onUpdate, onDraftCommitted]
  )

  const commitDraft = useCallback(
    (patch: Partial<ChartDraftValues>) => {
      const merged = { ...valuesRef.current, ...patch }
      valuesRef.current = merged
      setValues(merged)

      if (patch.code !== undefined || patch.name !== undefined) {
        onDraftChange({ code: merged.code, name: merged.name })
      }

      const trimmedCode = merged.code.trim()
      if (trimmedCode && isCodeTaken(trimmedCode, recordIdRef.current)) {
        setCodeError(`${trimmedCode} is already in use.`)
        return
      }
      setCodeError(undefined)

      // Already created: plain field updates, exactly like the committed form.
      const recordId = recordIdRef.current
      if (recordId) {
        const update: Partial<Omit<ChartAccount, 'id'>> = {}
        if (patch.code !== undefined) update.code = trimmedCode
        if (patch.name !== undefined) update.name = merged.name.trim()
        if (patch.accountType !== undefined) update.accountType = merged.accountType
        if (patch.isActive !== undefined) update.isActive = merged.isActive
        if (Object.keys(update).length > 0) onUpdate(recordId, update)
        return
      }

      if (creatingRef.current) return // create in flight; the diff flush picks this up
      if (!trimmedCode || !merged.name.trim()) return // buffering: both are required

      creatingRef.current = true
      void createNow(merged)
    },
    [createNow, isCodeTaken, onDraftChange, onUpdate]
  )

  const commitCode = useDebouncedCallback((value: string) => commitDraft({ code: value }), 500)
  const commitName = useDebouncedCallback((value: string) => commitDraft({ name: value }), 500)

  return (
    // `min-h-0` + `ScrollArea`: this editor sits inside a sticky pane capped at
    // the viewport height (`accounts-settings-page.tsx`), so a form taller than
    // that must scroll ITSELF. Without this it is clipped with no indication
    // there is anything below.
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <FieldPanel
          orientation='horizontal'
          breakpoint='md'
          resizeId='gl-account-form'
          defaultLabelWidth={160}
          className='p-0'>
          <FieldPanelRow
            title='Code'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={codeError}
            description={CODE_DESCRIPTION}>
            <div className='w-full'>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={code}
                open
                onOpenChange={noop}
                onChange={(value) => {
                  setCode(value as string)
                  commitCode(value as string)
                }}
                placeholder='1310'
              />
              {postingsExist && (
                <p className='px-2 pb-1 text-muted-foreground text-xs'>{RENUMBER_NOTE}</p>
              )}
            </div>
          </FieldPanelRow>

          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              onChange={(value) => {
                setName(value as string)
                commitName(value as string)
              }}
              placeholder='Inventory'
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Type'
            type={BaseType.ENUM}
            showIcon
            description='The statement classification. A role can only be mapped to an account of the type it declares.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: ACCOUNT_TYPE_OPTIONS }}
              value={[values.accountType]}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              onChange={(value) => {
                const next = firstSelected(value)
                if (next) commitDraft({ accountType: next as GlAccountTypeValue })
              }}
              placeholder='Select type'
            />
          </FieldPanelRow>

          <FieldPanelRow title='Active' type={BaseType.BOOLEAN} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              fieldOptions={{ variant: 'switch' }}
              value={values.isActive}
              onChange={(value) => commitDraft({ isActive: value as boolean })}
            />
          </FieldPanelRow>
        </FieldPanel>

        <p className='px-1 pt-2 text-muted-foreground text-xs'>
          Saved as soon as it has a number and a name. Nothing is written before then, so an
          abandoned draft never leaves a placeholder in the chart.
        </p>
      </ScrollArea>
    </div>
  )
}
