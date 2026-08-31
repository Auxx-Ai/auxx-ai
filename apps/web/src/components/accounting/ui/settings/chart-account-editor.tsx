// apps/web/src/components/accounting/ui/settings/chart-account-editor.tsx
'use client'

// The right column of the Chart of accounts tab: the selected `gl_account`, as a
// form.
//
// 🛑 ONE FORM, TWO MODES - not a draft form and an editor form. An uncommitted
// draft and a saved account render the identical four rows off the identical
// local state; the only difference is where a commit GOES, which is one branch
// on `recordIdRef`. The products-services page (the pattern this copies) does
// split them, and it has to: its committed form binds to the field-value store
// through `useSaveFieldValue` while its draft binds to local state, so the two
// really are different data paths. Here both go through `ledger.chartAccount*`,
// so a split would be two copies of one layout drifting apart.
//
// 🛑 AUTOSAVES PER FIELD once the account exists, through
// `ledger.chartAccountUpdate` - NOT `useSaveFieldValue`, which routes to
// `fieldValue.set` and therefore to the generic RECORDS capability. The chart
// decides where real money lands, so its whole door is on `ledgerPost`; see the
// argument on `chartAccountCreate` in `routers/ledger.ts`.
//
// 🛑 CREATE FIRES ON A BUTTON, not on a commit. `ProductDraftEditorForm` creates
// implicitly the moment its ONE required field is non-empty. `gl_account` has
// THREE required fields and `accountType` has no honest default, so an implicit
// create would put a unique-code conflict on an act the person did not knowingly
// perform - they picked a type, and back comes "4000 is already in use". The
// button makes the create the thing they just did.
//
// This file was a READ-ONLY pane between #1982 and this change, and before #1982
// it was an autosaving form whose every commit wrote LOCAL REACT STATE. The
// read-only pane was the fix for that, not a placeholder for this: what makes the
// inputs honest now is that `chartAccountUpdate` exists, and nothing else.
//
// ── The provider account (task 19) ──────────────────────────────────────────
//
// The sixth row is the account map, which used to be a whole tab. It is here
// because it IS an attribute of this account - stored on the `gl_account`
// instance as a connection-scoped `qboAccountId`, exactly as its code and its
// type are stored on it.
//
// 🛑 It writes through `ledger.setAccountIdentity` (`ledgerPost`), NOT through
// `onUpdate`. `chartAccountUpdate` knows nothing about a provider, and the
// mapping write has its own job: it revalidates the target against the LIVE
// provider chart before writing, because a picker rendered five minutes ago may
// be offering an account somebody has since deactivated.
//
// 🛑 The row degrades, it never blocks. With no provider connected, while the
// map is loading, and when the provider round trip has FAILED, the row renders
// one muted line and the other five rows stay fully editable. A QuickBooks
// outage must not be able to stop somebody renaming an account.

import { FieldType } from '@auxx/database/enums'
import {
  ACCOUNT_ROLE_LABELS,
  type AccountIdentityRow,
  type AccountRole,
  type ChartAccountRow,
  type GlAccountTypeValue,
} from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Check, Landmark, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import {
  ACCOUNT_SUGGESTION_REASON_COPY,
  ACCOUNT_TYPE_OPTIONS,
  type ChartDraftHandle,
  type ChartMapView,
  formatProviderAccount,
  isMappingBroken,
} from './accounts-types'

/**
 * ⚠️ A `SINGLE_SELECT` hands its value back as an ARRAY - `['expense']` - because
 * the picker underneath is the multi-select one with `multi: false`
 * (`field-input-adapter.tsx`, which normalises `value` to `[value]` on the way
 * in and never un-wraps it on the way out). Passing that straight to the wire is
 * a Zod refusal reading "Invalid option: expected one of asset|liability|...",
 * which names the right values and gives no hint that the problem is the shape.
 *
 * Normalise at the boundary, exactly as the pre-#1982 version of this file did.
 */
function firstSelected(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) || null
}

/** Which field a refusal belongs to. Routed from the patch key that caused it. */
type FieldKey = 'code' | 'name' | 'accountType' | 'isActive' | 'mapping' | 'form'

/** The four writable attributes, as the form holds them. */
interface AccountValues {
  code: string
  name: string
  /** `null` only in draft mode - "not chosen yet" never reaches a write. */
  accountType: GlAccountTypeValue | null
  isActive: boolean
}

/** One create's payload. Every field is settled by the time this is built. */
export interface NewChartAccount {
  code: string
  name: string
  accountType: GlAccountTypeValue
  isActive: boolean
}

interface ChartAccountEditorProps {
  selectedId: string | null
  accounts: ChartAccountRow[]
  /** Posting roles currently pointed at the selected account. */
  roles: AccountRole[]
  /** Posted lines per account CODE, from `ledger.chartAccountUsage`. */
  usage: Record<string, number>
  /** Phantom draft for this tab, owned by `accounts-settings-page.tsx`. */
  draft: ChartDraftHandle | null
  /** List phantom-row preview sync, fired per debounced commit. */
  onDraftChange: (patch: { code?: string; name?: string }) => void
  /** Creates the account. Rejects with the server's message. */
  onCreate: (values: NewChartAccount) => Promise<ChartAccountRow>
  /** First create resolved: swap `selectedId` to the real id, KEEPING the draft. */
  onDraftCommitted: (recordId: string) => void
  /** Writes one attribute. Rejects with the server's message. */
  onUpdate: (id: string, patch: Partial<AccountValues>) => Promise<ChartAccountRow>
  /** Confirms, then archives. Rejects with the server's message. */
  onRemove: (id: string) => Promise<void>
  /** The account map. Decorates this pane; never gates the rest of it. */
  map: ChartMapView
  /** Pairs this account with a provider account, or clears it with `null`. */
  onSetIdentity: (glAccountId: string, providerAccountId: string | null) => Promise<void>
}

/**
 * ⚠️ Renumbering does NOT rewrite history, and this pane says so because a person
 * reading a code here is the person who would go and change it. A posting line
 * names an account by CODE with no foreign key, deliberately, so the ledger
 * outlives the chart - which means a renumber leaves every line already posted
 * holding the old code.
 *
 * Stated with a COUNT (`ledger.chartAccountUsage`): "142 posted lines carry 1310"
 * is a fact about this account, where a general caution is something to scroll
 * past.
 */
function codeDescription(code: string, postedLines: number): string {
  if (postedLines === 0) {
    return 'The account number. Unique across the chart, and yours to change. Nothing has posted to this code yet, so renumbering costs nothing today.'
  }
  return `${postedLines} posted ${postedLines === 1 ? 'line carries' : 'lines carry'} ${code}. A posted line stores the account code with no foreign key, on purpose, so the ledger outlives the chart - renumbering leaves every one of them holding the old code.`
}

export function ChartAccountEditor({
  selectedId,
  accounts,
  roles,
  usage,
  draft,
  onDraftChange,
  onCreate,
  onDraftCommitted,
  onUpdate,
  onRemove,
  map,
  onSetIdentity,
}: ChartAccountEditorProps) {
  // The draft stays active while `selectedId` is its COMMITTED id too - swapping
  // to a query-bound instance would remount the inputs mid-typing (replaced text,
  // cancelled debounce timer).
  const draftActive =
    !!draft && (selectedId === draft.draftId || (!!draft.recordId && selectedId === draft.recordId))

  if (draft && draftActive) {
    return (
      <ChartAccountForm
        key={draft.draftId}
        account={null}
        roles={[]}
        postedLines={0}
        onDraftChange={onDraftChange}
        onCreate={onCreate}
        onDraftCommitted={onDraftCommitted}
        onUpdate={onUpdate}
        onRemove={onRemove}
        map={map}
        onSetIdentity={onSetIdentity}
      />
    )
  }

  const account = selectedId ? accounts.find((row) => row.id === selectedId) : undefined

  if (!account) {
    return (
      <div className='p-3'>
        <EmptySection
          orientation='horizontal'
          icon={<Landmark />}
          title='Select an account'
          description='Or add one to the chart.'
        />
      </div>
    )
  }

  return (
    <ChartAccountForm
      key={account.id}
      account={account}
      roles={roles}
      postedLines={usage[account.code] ?? 0}
      onDraftChange={onDraftChange}
      onCreate={onCreate}
      onDraftCommitted={onDraftCommitted}
      onUpdate={onUpdate}
      onRemove={onRemove}
      map={map}
      onSetIdentity={onSetIdentity}
    />
  )
}

/**
 * The four rows, in both modes.
 *
 * `account: null` is the draft: commits buffer locally and the Create button
 * appears. A non-null `account` seeds the same state and `recordIdRef`, so every
 * commit writes immediately and Remove appears instead. **A draft that has just
 * been created is the first case turning into the second WITHOUT a remount** -
 * that is what `recordIdRef` is for, and it is why the page keeps the draft alive
 * after `onDraftCommitted`.
 *
 * ⚠️ Values are local state seeded once, not bound to the query row, in both
 * modes. This pane is the only writer, `key` remounts it on selection change, and
 * local state is what keeps a `SINGLE_SELECT` from flickering back to its old
 * value while its mutation is in flight.
 */
function ChartAccountForm({
  account,
  roles,
  postedLines,
  onDraftChange,
  onCreate,
  onDraftCommitted,
  onUpdate,
  onRemove,
  map,
  onSetIdentity,
}: {
  account: ChartAccountRow | null
  roles: AccountRole[]
  postedLines: number
} & Pick<
  ChartAccountEditorProps,
  | 'onDraftChange'
  | 'onCreate'
  | 'onDraftCommitted'
  | 'onUpdate'
  | 'onRemove'
  | 'map'
  | 'onSetIdentity'
>) {
  const valuesRef = useRef<AccountValues>({
    code: account?.code ?? '',
    name: account?.name ?? '',
    accountType: account?.accountType ?? null,
    isActive: account?.isActive ?? true,
  })
  const [values, setValues] = useState<AccountValues>(valuesRef.current)
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [mapping, setMapping] = useState(false)

  // 🛑 Synchronous, NOT state-derived: a `disabled` prop driven by `creating` is
  // not enough, because two clicks landing before a re-render both pass it. In
  // products a double create is two catalog items; here the second collides on
  // the unique `code`, so the person sees an error for an account that was in
  // fact created fine.
  const creatingRef = useRef(false)
  // Null while the draft is uncommitted; set the moment the create resolves, and
  // seeded for an existing account. THE branch this whole component turns on.
  const recordIdRef = useRef<string | null>(account?.id ?? null)
  const [committed, setCommitted] = useState(!!account)

  /**
   * Merge one attribute, then route it.
   *
   * 🛑 A refusal is rendered VERBATIM on the row that caused it. The role map
   * made this call first and wrote down why: replacing "'grni' must be mapped to
   * a liability account, but 4000 Sales is a revenue account" with "Could not
   * save" throws away the only sentence that says what to do next. Nothing is
   * re-validated here - a second client-side authority drifts from the server's.
   */
  const commit = useCallback(
    (key: FieldKey, patch: Partial<AccountValues>) => {
      const merged = { ...valuesRef.current, ...patch }
      valuesRef.current = merged
      setValues(merged)

      const recordId = recordIdRef.current
      if (!recordId) {
        // Buffering. The phantom row is the only feedback there is until the
        // Create button lights up, so keep it in step.
        if (patch.code !== undefined || patch.name !== undefined) {
          onDraftChange({ code: merged.code, name: merged.name })
        }
        return
      }

      setErrors((prev) => ({ ...prev, [key]: undefined }))
      void onUpdate(recordId, patch).catch((error: unknown) => {
        setErrors((prev) => ({
          ...prev,
          [key]: error instanceof Error ? error.message : 'Could not save the change.',
        }))
      })
    },
    [onDraftChange, onUpdate]
  )

  const commitCode = useDebouncedCallback((value: string) => commit('code', { code: value }), 500)
  const commitName = useDebouncedCallback((value: string) => commit('name', { name: value }), 500)

  const canCreate =
    values.code.trim().length > 0 && values.name.trim().length > 0 && values.accountType !== null

  const handleCreate = useCallback(async () => {
    if (creatingRef.current || recordIdRef.current) return
    const snapshot = valuesRef.current
    if (!snapshot.code.trim() || !snapshot.name.trim() || !snapshot.accountType) return

    creatingRef.current = true
    setCreating(true)
    setErrors({})

    try {
      const created = await onCreate({
        code: snapshot.code.trim(),
        name: snapshot.name.trim(),
        accountType: snapshot.accountType,
        isActive: snapshot.isActive,
      })

      // Flip the commit target FIRST - a keystroke landing while we settle below
      // must route to the real account, not back into the buffered branch.
      recordIdRef.current = created.id
      setCommitted(true)

      // Whatever was typed while the create was in flight, against the now-real
      // account. One call, because a create carries the whole snapshot.
      const latest = valuesRef.current
      const changed: Partial<AccountValues> = {}
      if (latest.code.trim() !== snapshot.code.trim()) changed.code = latest.code.trim()
      if (latest.name.trim() !== snapshot.name.trim()) changed.name = latest.name.trim()
      if (latest.accountType && latest.accountType !== snapshot.accountType) {
        changed.accountType = latest.accountType
      }
      if (latest.isActive !== snapshot.isActive) changed.isActive = latest.isActive
      if (Object.keys(changed).length > 0) await onUpdate(created.id, changed)

      onDraftCommitted(created.id)
    } catch (error) {
      creatingRef.current = false
      // A unique-code collision is a 409, and on `gl_account` it is always the
      // code - the only unique field. Everything else is a form-level refusal.
      const message = error instanceof Error ? error.message : 'Could not create the account.'
      const isConflict =
        typeof error === 'object' &&
        error !== null &&
        (error as { data?: { code?: string } }).data?.code === 'CONFLICT'
      setErrors(isConflict ? { code: message } : { form: message })
    } finally {
      setCreating(false)
    }
  }, [onCreate, onDraftCommitted, onUpdate])

  /**
   * Pair this account with a provider account, or clear the pairing with `null`.
   *
   * 🛑 Nothing is re-validated here. `setAccountIdentity` re-checks existence,
   * active status and classification against the LIVE provider chart before
   * writing, and its refusal names the account and the problem; a second
   * client-side authority would drift from it and "Could not save" would throw
   * away the only sentence that says what to do next.
   */
  const handleSetIdentity = useCallback(
    async (providerAccountId: string | null) => {
      const recordId = recordIdRef.current
      if (!recordId) return
      setErrors((prev) => ({ ...prev, mapping: undefined }))
      setMapping(true)
      try {
        await onSetIdentity(recordId, providerAccountId)
      } catch (error) {
        setErrors((prev) => ({
          ...prev,
          mapping: error instanceof Error ? error.message : 'Could not save the mapping.',
        }))
      } finally {
        setMapping(false)
      }
    },
    [onSetIdentity]
  )

  const handleRemove = useCallback(async () => {
    const recordId = recordIdRef.current
    if (!recordId) return
    setRemoving(true)
    setErrors((prev) => ({ ...prev, form: undefined }))
    try {
      await onRemove(recordId)
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        form: error instanceof Error ? error.message : 'Could not remove the account.',
      }))
    } finally {
      setRemoving(false)
    }
  }, [onRemove])

  return (
    // `min-h-0` + `ScrollArea`: this pane sits inside a sticky container capped
    // at the viewport height (`accounts-settings-page.tsx`), so content taller
    // than that must scroll ITSELF. Without this it is clipped with no
    // indication there is anything below.
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <FieldPanel
          orientation='horizontal'
          breakpoint='md'
          resizeId='gl-account-detail'
          defaultLabelWidth={160}
          className='shrink-0 grow-0 p-0'>
          <FieldPanelRow
            title='Code'
            type={BaseType.STRING}
            showIcon
            isRequired
            description={codeDescription(values.code, postedLines)}>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.code}
              onChange={(value) => {
                valuesRef.current = { ...valuesRef.current, code: value as string }
                setValues(valuesRef.current)
                commitCode(value as string)
              }}
              placeholder='1310'
            />
            <FieldError message={errors.code} />
          </FieldPanelRow>

          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.name}
              onChange={(value) => {
                valuesRef.current = { ...valuesRef.current, name: value as string }
                setValues(valuesRef.current)
                commitName(value as string)
              }}
              placeholder='Raw Materials'
            />
            <FieldError message={errors.name} />
          </FieldPanelRow>

          <FieldPanelRow
            title='Type'
            type={BaseType.ENUM}
            showIcon
            isRequired
            description='The statement classification. A role can only be mapped to an account of the type it declares.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: ACCOUNT_TYPE_OPTIONS }}
              value={values.accountType}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              onChange={(value) => {
                const next = firstSelected(value)
                if (next) commit('accountType', { accountType: next as GlAccountTypeValue })
              }}
              placeholder='Select account type'
            />
            <FieldError message={errors.accountType} />
          </FieldPanelRow>

          <FieldPanelRow
            title='Active'
            type={BaseType.BOOLEAN}
            showIcon
            description='An inactive account stays in the chart but cannot be mapped to a posting role.'>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              // The binary `switch` variant, not the default tri-state button
              // group: `gl_account_is_active` is `nullable: false` with
              // `defaultValue: true`, so a third "not set" state would be a value
              // the column cannot hold.
              fieldOptions={{ variant: 'switch' }}
              value={values.isActive}
              onChange={(value) => commit('isActive', { isActive: value as boolean })}
            />
            <FieldError message={errors.isActive} />
          </FieldPanelRow>

          {committed && (
            <FieldPanelRow
              title={map.providerLabel ?? 'Accounting system'}
              type={BaseType.STRING}
              showIcon
              description={PROVIDER_ROW_DESCRIPTION}>
              <ProviderAccountField
                map={map}
                accountType={values.accountType}
                identity={
                  recordIdRef.current ? map.byAccountId.get(recordIdRef.current) : undefined
                }
                pending={mapping}
                onSet={handleSetIdentity}
              />
              <FieldError message={errors.mapping} />
            </FieldPanelRow>
          )}

          {committed && (
            <FieldPanelRow
              title='Roles'
              type={BaseType.STRING}
              showIcon
              description='Posting roles that resolve to this account. Change them on the Roles tab.'>
              <div className='flex min-h-8 items-center text-sm'>
                {roles.length === 0 ? (
                  <span className='text-muted-foreground'>No role posts here</span>
                ) : (
                  <span>{roles.map((role) => ACCOUNT_ROLE_LABELS[role]).join(', ')}</span>
                )}
              </div>
            </FieldPanelRow>
          )}
        </FieldPanel>

        <div className='mt-3 flex flex-col gap-2'>
          {committed ? (
            <>
              <Button
                variant='outline'
                size='sm'
                className='self-start text-destructive'
                loading={removing}
                loadingText='Removing...'
                onClick={() => void handleRemove()}>
                <Trash2 />
                Remove account
              </Button>
              <FieldError message={errors.form} />
              <p className='text-muted-foreground text-xs'>
                Changes save as you make them. Removing takes the account out of the chart; entries
                already posted keep the code and the name they were written with.
              </p>
            </>
          ) : (
            <>
              <Button
                variant='outline'
                size='sm'
                className='self-start'
                disabled={!canCreate}
                loading={creating}
                loadingText='Creating...'
                onClick={() => void handleCreate()}>
                Create account
              </Button>
              <FieldError message={errors.form} />
              <p className='text-muted-foreground text-xs'>
                A code, a name and a type are all required. Nothing is written until you create it.
              </p>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * ⚠️ Says CONFIRM, not "pick". `G19` stores a human confirmation rather than a
 * match, and the sentence has to carry why: without it, a later rename or
 * renumber on either side silently moves where a role posts.
 */
const PROVIDER_ROW_DESCRIPTION =
  'The account over there that this one corresponds to. Confirming it once is what stops a later rename or renumber on either side from quietly moving where a role posts.'

/**
 * The provider account for one `gl_account`: a picker, the matcher's suggestion
 * with its reason, and the unmap control.
 *
 * 🛑 Four states, and three of them are NOT errors. Nothing connected, a map
 * still loading, and a map that failed to load all render one muted line - never
 * an alert, never a blocked pane. `P1` makes "nothing connected" a first-class
 * outcome: the entry is still built, balanced and stored here.
 */
function ProviderAccountField({
  map,
  accountType,
  identity,
  pending,
  onSet,
}: {
  map: ChartMapView
  /** The LIVE local value, not the saved one - see the filter below. */
  accountType: GlAccountTypeValue | null
  identity: AccountIdentityRow | undefined
  pending: boolean
  onSet: (providerAccountId: string | null) => Promise<void>
}) {
  // 🛑 LOADING is checked before "nothing connected", not after. `connected` is
  // false for the whole of the provider round trip, so testing it first would
  // tell every reader their accounting system is disconnected for as long as it
  // takes to answer - a CLAIM about the org, made false by the render order.
  if (map.isPending) {
    return (
      <p className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Reading the account map...
      </p>
    )
  }

  if (map.isError) {
    return (
      <p className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Could not read the account map. Everything else about this account is unaffected.
      </p>
    )
  }

  if (!map.connected) {
    return (
      <p className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Nothing connected. Entries are still built, balanced and stored here.
      </p>
    )
  }

  // Live in the chart but not yet in the map: an account created moments ago,
  // before the invalidated `accountMap` came back.
  if (!identity) {
    return (
      <p className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Not in the account map yet.
      </p>
    )
  }

  // 🛑 Filtered by the LIVE `accountType`, not by `identity.account.accountType`.
  // Somebody who has just changed this account's type is picking for what it is
  // NOW; offering candidates for the type it used to be would hand them a
  // mapping the server is about to refuse.
  //
  // ⚠️ Type compatibility is a FILTER, not a tiebreak. A candidate in the wrong
  // statement section is never offered at any confidence: mapping a liability to
  // a revenue account balances AND misstates the P&L, and the number somebody
  // recognises gives them no way to tell.
  const options = map.providerAccounts
    .filter((account) => account.active && account.classification === accountType)
    .map((account) => ({ value: account.id, label: formatProviderAccount(account) }))

  const suggestion = identity.suggestion
  const broken = isMappingBroken(identity)

  // The confirmed target, as it should READ. `liveProviderAccount` is the truth
  // when there is one; the recorded name is the fallback that keeps a BROKEN row
  // able to say what it used to point at, which is the only clue to what it
  // should point at now.
  const selectedLabel = identity.liveProviderAccount
    ? formatProviderAccount(identity.liveProviderAccount)
    : identity.providerAccountNumber
      ? `${identity.providerAccountNumber} · ${identity.providerAccountName ?? 'Unknown account'}`
      : (identity.providerAccountName ?? 'Unknown account')

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {/* 🛑 `PickerTrigger`, not the Combobox's own default button. Every other
          picker in a `FieldPanelRow` is a transparent full-width trigger with the
          chevron at the end - the Type row directly above this one included - and
          an outline button here would read as the one control on the pane that
          came from somewhere else.

          Its clear affordance IS the unmap: `onClear` writes `null`, which is
          what `setAccountIdentity` takes to mean "this pairing is off". A
          separate Unmap button would be a second control for one act. */}
      <Combobox
        placeholder='Select account'
        emptyText='No compatible account'
        value={identity.providerAccountId ?? undefined}
        options={options}
        disabled={pending}
        onChangeValue={(value) => void onSet(value)}
        trigger={
          <PickerTrigger
            asCombobox
            disabled={pending}
            className='w-full ps-0 pe-1'
            hasValue={!!identity.providerAccountId}
            placeholder='Select account'
            showClear
            onClear={() => void onSet(null)}>
            <span className='truncate text-sm'>{selectedLabel}</span>
          </PickerTrigger>
        }
      />

      {suggestion && (
        <div className='flex min-w-0 items-center gap-1.5'>
          <Button
            variant='outline'
            size='xs'
            className='min-w-0'
            disabled={pending}
            onClick={() => void onSet(suggestion.account.id)}>
            <Check />
            <span className='truncate'>Confirm {formatProviderAccount(suggestion.account)}</span>
          </Button>
          <span className='shrink-0 text-muted-foreground text-xs'>
            {ACCOUNT_SUGGESTION_REASON_COPY[suggestion.reason]}
          </span>
        </div>
      )}

      {broken && (
        <p className='text-destructive text-xs'>
          The account this points at has been removed, deactivated or moved to a different section.
          Every close refuses until it is re-mapped.
        </p>
      )}
    </div>
  )
}

/** One server refusal, on the row that caused it. Rendered verbatim. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className='mt-1 text-destructive text-xs'>{message}</p>
}
