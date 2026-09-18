// apps/web/src/components/accounting/ui/settings/payment-gateway-add-dialog.tsx
'use client'

// "Add gateway" - the only door that creates a `payment_gateway` record
// (task 13 §5.3). Copies `bank-account-manual-dialog.tsx`'s shape: a small
// `FieldPanel` in a dialog, extracted so the fields and the refusal handling
// live in one place.
//
// The clearing step (task 59 §3) offers a suggested `<Name> Clearing` account,
// minted through `mint-rail-accounts.ts` via `paymentGateway.createForRail` -
// or an existing account, through the plain `paymentGateway.create`. Fee
// account and fee treatment stay out of this dialog and go to the editor,
// since `netted`/no dedicated fee account are already the right defaults for
// most rails.

import { FieldType } from '@auxx/database/enums'
import type { PaymentGatewayRow } from '@auxx/lib/accounting/rails/client'
import { suggestRail } from '@auxx/lib/accounting/rails/rail-catalogue'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo, useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

type ClearingMode = 'new' | 'existing'

/** The dialog's fields, as it holds them before the write. */
interface AddDraft {
  name: string
  handles: string[]
  clearingMode: ClearingMode
  /** Edited from the suggestion the moment a handle is typed - `clearingMode: 'new'`. */
  clearingAccountName: string
  /** `clearingMode: 'existing'`. */
  clearingAccountId: string | null
}

const EMPTY_DRAFT: AddDraft = {
  name: '',
  handles: [],
  clearingMode: 'new',
  clearingAccountName: '',
  clearingAccountId: null,
}

export interface PaymentGatewayAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The gateway that was just written. `paymentGateway.list` is already
   * invalidated by the time this fires, so a caller only has to select it.
   */
  onCreated?: (gateway: PaymentGatewayRow) => void
}

/**
 * PaymentGatewayAddDialog
 *
 * Collects the fields `createPaymentGateway`/`createForRail` require - name,
 * at least one handle, and a clearing account, minted or picked - before
 * enabling Add.
 */
export function PaymentGatewayAddDialog({
  open,
  onOpenChange,
  onCreated,
}: PaymentGatewayAddDialogProps) {
  const utils = api.useUtils()
  const [draft, setDraft] = useState<AddDraft>(EMPTY_DRAFT)
  const [nameTouched, setNameTouched] = useState(false)
  const [clearingNameTouched, setClearingNameTouched] = useState(false)

  const onSuccess = async (gateway: PaymentGatewayRow) => {
    await utils.paymentGateway.list.invalidate()
    onOpenChange(false)
    setDraft(EMPTY_DRAFT)
    setNameTouched(false)
    setClearingNameTouched(false)
    onCreated?.(gateway)
  }
  const onError = (error: { message: string }) => {
    toastError({ title: 'Error adding the gateway', description: error.message })
  }

  const create = api.paymentGateway.create.useMutation({
    onSuccess,
    onError,
  })
  const createForRail = api.paymentGateway.createForRail.useMutation({
    onSuccess: (result) => onSuccess(result.gateway),
    onError,
  })
  const pending = create.isPending || createForRail.isPending

  // The handles actually seen on this org's orders. Only the UNCLAIMED ones are
  // offered: a handle another gateway already holds would be refused by
  // `assertHandlesAvailable` at write time, so suggesting it is an invitation
  // to a guaranteed error. Typing it by hand still gets that refusal, verbatim.
  const observed = api.paymentGateway.observedHandles.useQuery(undefined, { enabled: open })
  const suggestions = useMemo(
    () => (observed.data ?? []).filter((row) => !row.claimedBy).map((row) => row.handle),
    [observed.data]
  )

  const handleOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { label: string; value: string }[] = []
    for (const handle of [...suggestions, ...draft.handles]) {
      const key = handle.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push({ label: handle, value: handle })
    }
    return options
  }, [suggestions, draft.handles])

  // The rail catalogue's guess, from the first handle - a name and a suggested
  // `<Name> Clearing` account name, both editable fields a person may overwrite.
  const suggestion = useMemo(() => suggestRail(draft.handles[0] ?? ''), [draft.handles])

  function updateDraft(patch: Partial<AddDraft>) {
    setDraft((prev) => {
      const next = { ...prev, ...patch }
      // Re-suggest the name and clearing account name from the first handle,
      // unless a person has already typed one of their own.
      const nextSuggestion = suggestRail(next.handles[0] ?? '')
      if (!nameTouched && patch.name === undefined) next.name = nextSuggestion.name
      if (!clearingNameTouched && patch.clearingAccountName === undefined) {
        next.clearingAccountName = nextSuggestion.clearingAccountName
      }
      return next
    })
  }

  const canSubmit =
    draft.name.trim() &&
    draft.handles.length > 0 &&
    (draft.clearingMode === 'new' ? draft.clearingAccountName.trim() : draft.clearingAccountId)

  function submit() {
    if (draft.clearingMode === 'existing') {
      create.mutate({
        name: draft.name.trim(),
        handles: draft.handles,
        clearingAccountId: draft.clearingAccountId as string,
      })
      return
    }
    createForRail.mutate({
      name: draft.name.trim(),
      handles: draft.handles,
      clearingAccountName: draft.clearingAccountName.trim(),
      mintFeeAccount: false,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setDraft(EMPTY_DRAFT)
          setNameTouched(false)
          setClearingNameTouched(false)
        }
      }}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Add a payment gateway</DialogTitle>
          <DialogDescription>
            The rail that takes money for an order. Its clearing account is mapped below - minted
            fresh, or an existing one you pick.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='accounting-payment-gateway-add'
          defaultLabelWidth={140}
          className='p-0'>
          <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={draft.name}
              placeholder='Authorize.Net'
              disabled={pending}
              onChange={(value) => {
                setNameTouched(true)
                updateDraft({ name: (value as string) ?? '' })
              }}
            />
          </FieldPanelRow>
          <FieldPanelRow
            title='Gateway handles'
            type={BaseType.STRING}
            showIcon
            isRequired
            description={
              observed.isPending
                ? 'Every stored value this rail is seen under.'
                : suggestions.length > 0
                  ? 'Every stored value this rail is seen under. The list offers the handles on your orders that no gateway routes yet.'
                  : 'Every stored value this rail is seen under, exactly as it appears on the order.'
            }>
            <FieldInputAdapter
              fieldType={FieldType.TAGS}
              fieldOptions={{ options: handleOptions }}
              useValueAsLabel
              value={draft.handles}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              placeholder='Add a handle'
              disabled={pending}
              onChange={(value) =>
                updateDraft({ handles: Array.isArray(value) ? (value as string[]) : [] })
              }
            />
          </FieldPanelRow>
          <FieldPanelRow title='Clearing account' type={BaseType.STRING} showIcon isRequired>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center gap-1'>
                <Button
                  type='button'
                  variant={draft.clearingMode === 'new' ? 'secondary' : 'ghost'}
                  size='xs'
                  disabled={pending}
                  onClick={() => setDraft((prev) => ({ ...prev, clearingMode: 'new' }))}>
                  Create new
                </Button>
                <Button
                  type='button'
                  variant={draft.clearingMode === 'existing' ? 'secondary' : 'ghost'}
                  size='xs'
                  disabled={pending}
                  onClick={() => setDraft((prev) => ({ ...prev, clearingMode: 'existing' }))}>
                  Use existing
                </Button>
              </div>
              {draft.clearingMode === 'new' ? (
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={draft.clearingAccountName}
                  placeholder={suggestion.clearingAccountName}
                  disabled={pending}
                  onChange={(value) => {
                    setClearingNameTouched(true)
                    updateDraft({ clearingAccountName: (value as string) ?? '' })
                  }}
                />
              ) : (
                <GlAccountPicker
                  value={draft.clearingAccountId}
                  selectBy='id'
                  filterTypes={['asset']}
                  placeholder='Select account…'
                  disabled={pending}
                  onChange={(id) => setDraft((prev) => ({ ...prev, clearingAccountId: id }))}
                />
              )}
              <p className='text-muted-foreground text-xs'>
                {draft.clearingMode === 'new'
                  ? 'A new asset account, minted with the next free code in the clearing band - reached by id, through this record, and pointed at by nothing else.'
                  : 'Two rails can share one clearing account - this only says which account, it never mints a new one.'}
              </p>
            </div>
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={pending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={pending}
            loadingText='Adding...'
            disabled={!canSubmit}
            onClick={submit}
            data-dialog-submit>
            Add gateway <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
